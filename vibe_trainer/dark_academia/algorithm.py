from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


def _load_rgb01(path: str | Path) -> np.ndarray:
  return np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def _safe_pct(arr: np.ndarray, p: float) -> float:
  return float(np.percentile(arr, p))


def _luma(rgb: np.ndarray) -> np.ndarray:
  return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def _sat(rgb: np.ndarray) -> np.ndarray:
  return np.max(rgb, axis=2) - np.min(rgb, axis=2)


def _channel_balance(rgb: np.ndarray) -> list[float]:
  flat = rgb.reshape(-1, 3)
  mean = flat.mean(axis=0)
  g = max(1e-6, float(mean[1]))
  return [float(mean[0] / g), 1.0, float(mean[2] / g)]


def train(context: dict[str, Any]) -> dict[str, Any]:
  samples = context["samples"]
  dataset_dir = Path(context["dataset_dir"])

  in_images = [_load_rgb01(s["in_path"]) for s in samples if s["split"] == "train"]

  ref_paths: list[Path] = []
  for s in samples:
    if s["split"] == "train" and s.get("out_path"):
      ref_paths.append(Path(s["out_path"]))
  # Include standalone style refs (e.g. *_out with no matching *_in)
  for path in sorted(dataset_dir.iterdir()):
    if not path.is_file():
      continue
    if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
      continue
    stem = path.stem[4:] if path.stem.startswith("val_") else path.stem
    if stem.endswith("_out") and path not in ref_paths:
      ref_paths.append(path)

  if not in_images:
    raise ValueError("Need at least one training input image")
  if not ref_paths:
    raise ValueError("Need at least one *_out style reference image")

  refs = [_load_rgb01(path) for path in ref_paths]

  in_l = np.concatenate([_luma(im).reshape(-1) for im in in_images], axis=0)
  in_s = np.concatenate([_sat(im).reshape(-1) for im in in_images], axis=0)
  ref_l = np.concatenate([_luma(im).reshape(-1) for im in refs], axis=0)
  ref_s = np.concatenate([_sat(im).reshape(-1) for im in refs], axis=0)

  in_mid = _safe_pct(in_l, 50)
  ref_mid = _safe_pct(ref_l, 50)
  in_p10 = _safe_pct(in_l, 10)
  ref_p10 = _safe_pct(ref_l, 10)
  in_p90 = _safe_pct(in_l, 90)
  ref_p90 = _safe_pct(ref_l, 90)

  # Dark-academia target anchors.
  target_shadow = max(0.02, min(0.20, ref_p10 + 0.01))
  target_midtone = max(target_shadow + 0.05, min(0.48, ref_mid + 0.02))
  target_high = max(target_midtone + 0.08, min(0.86, ref_p90 - 0.02))

  sat_scale = max(0.45, min(0.95, (float(ref_s.mean()) + 1e-6) / (float(in_s.mean()) + 1e-6)))

  ref_balances = np.array([_channel_balance(im) for im in refs], dtype=np.float32)
  target_balance = ref_balances.mean(axis=0)

  # Warm split-tone leaning red/brown in highlights and olive in shadows.
  warm = [0.055, -0.005, -0.05]
  cool = [-0.028, 0.005, 0.038]

  return {
    "anchors_in": [in_p10, in_mid, in_p90],
    "anchors_out": [target_shadow, target_midtone, target_high],
    "sat_scale": float(sat_scale),
    "target_balance": [float(x) for x in target_balance],
    "warm_tone": warm,
    "cool_tone": cool,
    "cyan_suppression": 0.22,
    "vignette_strength": 0.33,
    "matte_lift": 0.05,
    "grain_strength": 0.022,
  }


def _tone_map(l: np.ndarray, xin: list[float], xout: list[float]) -> np.ndarray:
  x0, x1, x2 = xin
  y0, y1, y2 = xout
  x = np.array([0.0, x0, x1, x2, 1.0], dtype=np.float32)
  y = np.array([max(0.0, y0 * 0.3), y0, y1, y2, min(1.0, y2 * 1.05)], dtype=np.float32)
  return np.interp(l, x, y)


def _coord_hash(h: int, w: int) -> np.ndarray:
  yy, xx = np.mgrid[0:h, 0:w]
  phase = xx * 12.9898 + yy * 78.233
  return np.mod(np.sin(phase) * 43758.5453, 1.0).astype(np.float32)


def predict(
  image_rgb01: np.ndarray,
  model: dict[str, Any],
  intensity: float,
  sample: dict[str, Any],
) -> np.ndarray:
  _ = sample
  src = image_rgb01.astype(np.float32)
  h, w = src.shape[:2]
  t = float(np.clip(intensity, 0.0, 1.0))

  xin = [float(v) for v in model["anchors_in"]]
  xout = [float(v) for v in model["anchors_out"]]
  sat_scale = float(model["sat_scale"])
  target_balance = np.array(model["target_balance"], dtype=np.float32)
  warm = np.array(model["warm_tone"], dtype=np.float32)
  cool = np.array(model["cool_tone"], dtype=np.float32)
  cyan_suppression = float(model.get("cyan_suppression", 0.0))
  vignette_strength = float(model["vignette_strength"])
  matte_lift = float(model["matte_lift"])
  grain_strength = float(model["grain_strength"])

  l = _luma(src)
  lm = _tone_map(l, xin, xout)

  # Preserve scene structure while remapping tonality.
  ratio = lm / np.maximum(l, 1e-4)
  base = np.clip(src * ratio[..., None], 0.0, 1.0)

  # Desaturate toward luma with reference-driven saturation target.
  base_l = _luma(base)
  base = np.clip(base_l[..., None] + (base - base_l[..., None]) * sat_scale, 0.0, 1.0)

  # Match reference color balance.
  cur_balance = np.array(_channel_balance(base), dtype=np.float32)
  balance_gain = np.clip(target_balance / np.maximum(cur_balance, 1e-4), 0.75, 1.25)
  base = np.clip(base * balance_gain[None, None, :], 0.0, 1.0)

  # Split-toning: warm highs, slightly cool/olive shadows.
  l2 = _luma(base)
  hi_w = np.clip((l2 - 0.50) / 0.50, 0.0, 1.0)
  sh_w = np.clip((0.55 - l2) / 0.55, 0.0, 1.0)
  tone = hi_w[..., None] * warm[None, None, :] + sh_w[..., None] * cool[None, None, :]
  graded = np.clip(base + tone, 0.0, 1.0)

  # Reduce cyan/teal dominance to land closer to muted olive/sepia grades.
  cyan = np.clip(graded[..., 2] - np.maximum(graded[..., 0], graded[..., 1]), 0.0, 1.0)
  cyan_w = cyan[..., None] * cyan_suppression
  graded[..., 0] = np.clip(graded[..., 0] + cyan_w[..., 0] * 0.65, 0.0, 1.0)
  graded[..., 1] = np.clip(graded[..., 1] + cyan_w[..., 0] * 0.28, 0.0, 1.0)
  graded[..., 2] = np.clip(graded[..., 2] - cyan_w[..., 0] * 1.00, 0.0, 1.0)

  # Matte curve + gentle shoulder.
  graded = np.clip(graded * (1.0 - matte_lift) + matte_lift, 0.0, 1.0)
  graded = np.clip(graded - np.maximum(0.0, graded - 0.88) * 0.28, 0.0, 1.0)

  # Vignette for mood.
  yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
  nx = (xx / max(1.0, float(w - 1))) * 2.0 - 1.0
  ny = (yy / max(1.0, float(h - 1))) * 2.0 - 1.0
  r2 = nx * nx + ny * ny
  vignette = 1.0 - vignette_strength * np.clip(r2, 0.0, 1.0)
  graded = np.clip(graded * vignette[..., None], 0.0, 1.0)

  # Deterministic grain with subtle channel variation.
  noise = (_coord_hash(h, w) - 0.5) * (grain_strength * 2.0)
  graded[..., 0] = np.clip(graded[..., 0] + noise * 0.95, 0.0, 1.0)
  graded[..., 1] = np.clip(graded[..., 1] + noise * 0.80, 0.0, 1.0)
  graded[..., 2] = np.clip(graded[..., 2] + noise * 0.65, 0.0, 1.0)

  return np.clip(src * (1.0 - t) + graded * t, 0.0, 1.0)
