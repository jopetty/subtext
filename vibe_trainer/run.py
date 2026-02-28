#!/usr/bin/env -S uv run --script
# /// script
# dependencies = [
#   "numpy>=1.26",
#   "pillow>=10.0",
# ]
# ///

from __future__ import annotations

import argparse
import importlib.util
import json
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class Sample:
  key: str
  split: str  # train | val
  in_path: Path
  out_path: Path | None


def load_rgb01(path: Path) -> np.ndarray:
  return np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def save_rgb01(path: Path, rgb01: np.ndarray, quality: int = 95) -> None:
  out = np.clip(rgb01 * 255.0 + 0.5, 0, 255).astype(np.uint8)
  Image.fromarray(out, mode="RGB").save(path, quality=quality)


def center_crop_pair(a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
  if a.shape == b.shape:
    return a, b
  h = min(a.shape[0], b.shape[0])
  w = min(a.shape[1], b.shape[1])
  ay = (a.shape[0] - h) // 2
  ax = (a.shape[1] - w) // 2
  by = (b.shape[0] - h) // 2
  bx = (b.shape[1] - w) // 2
  return a[ay:ay + h, ax:ax + w], b[by:by + h, bx:bx + w]


def mae_rmse(pred: np.ndarray, tgt: np.ndarray) -> tuple[float, float]:
  pred, tgt = center_crop_pair(pred, tgt)
  d = (pred - tgt) * 255.0
  mae = float(np.mean(np.abs(d)))
  rmse = float(np.sqrt(np.mean(d * d)))
  return mae, rmse


def parse_dataset(dataset_dir: Path) -> tuple[list[Sample], list[Path], list[Path]]:
  ins: dict[tuple[str, str], Path] = {}
  outs: dict[tuple[str, str], Path] = {}
  ignored: list[Path] = []

  for path in sorted(dataset_dir.iterdir()):
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
      continue
    stem = path.stem
    split = "val" if stem.startswith("val_") else "train"
    key_stem = stem[4:] if split == "val" else stem

    if key_stem.endswith("_pred"):
      continue
    if key_stem.endswith("_in"):
      key = key_stem[:-3]
      ins[(split, key)] = path
    elif key_stem.endswith("_out"):
      key = key_stem[:-4]
      outs[(split, key)] = path
    else:
      ignored.append(path)

  samples: list[Sample] = []
  for (split, key), in_path in sorted(ins.items()):
    samples.append(Sample(key=key, split=split, in_path=in_path, out_path=outs.get((split, key))))

  if not samples:
    raise FileNotFoundError(f"No *_in images found in {dataset_dir}")
  standalone_out_refs = [path for pair, path in sorted(outs.items()) if pair not in ins]
  return samples, ignored, standalone_out_refs


def build_exponents(max_degree: int) -> list[tuple[int, int, int]]:
  exps: list[tuple[int, int, int]] = []
  for deg in range(max_degree + 1):
    for a in range(deg, -1, -1):
      for b in range(deg - a, -1, -1):
        c = deg - a - b
        exps.append((a, b, c))
  return exps


def poly_features(x: np.ndarray, exps: list[tuple[int, int, int]]) -> np.ndarray:
  r, g, b = x[:, 0], x[:, 1], x[:, 2]
  cols = [(r ** a) * (g ** bb) * (b ** c) for (a, bb, c) in exps]
  return np.column_stack(cols).astype(np.float32)


def train_poly_map(paired_train: list[tuple[np.ndarray, np.ndarray]], max_degree: int, lam: float) -> dict[str, Any]:
  x = np.concatenate([src.reshape(-1, 3) for src, _ in paired_train], axis=0)
  y = np.concatenate([tgt.reshape(-1, 3) for _, tgt in paired_train], axis=0)
  exps = build_exponents(max_degree)
  phi = poly_features(x, exps)
  p = phi.shape[1]
  reg = np.eye(p, dtype=np.float32)
  reg[0, 0] = 0.0
  a = phi.T @ phi + lam * reg
  coefs = []
  for c in range(3):
    rhs = phi.T @ y[:, c]
    w = np.linalg.solve(a, rhs)
    coefs.append(w)
  return {
    "algorithm": "poly_map",
    "max_degree": max_degree,
    "lambda": lam,
    "exps": exps,
    "coefs": np.stack(coefs, axis=1),
  }


def apply_poly_map(img: np.ndarray, model: dict[str, Any], intensity: float) -> np.ndarray:
  exps = [tuple(x) for x in model["exps"]]
  coefs = np.array(model["coefs"], dtype=np.float32)
  t = float(np.clip(intensity, 0.0, 1.0))
  flat = img.reshape(-1, 3)
  phi = poly_features(flat, exps)
  graded = np.clip(phi @ coefs, 0.0, 1.0)
  out = flat * (1.0 - t) + graded * t
  return np.clip(out.reshape(img.shape), 0.0, 1.0)


def train_cdf_match(inputs: list[np.ndarray], refs: list[np.ndarray]) -> dict[str, Any]:
  if not refs:
    raise ValueError("cdf_match requires at least one *_out style reference image")
  x = np.concatenate([im.reshape(-1, 3) for im in inputs], axis=0)
  y = np.concatenate([im.reshape(-1, 3) for im in refs], axis=0)

  lut = np.zeros((3, 256), dtype=np.float32)
  q = np.linspace(0.0, 1.0, 256)
  for c in range(3):
    src_q = np.quantile(x[:, c], q)
    tgt_q = np.quantile(y[:, c], q)
    lut[c, :] = np.interp(np.linspace(0.0, 1.0, 256), src_q, tgt_q, left=tgt_q[0], right=tgt_q[-1])

  return {
    "algorithm": "cdf_match",
    "lut": lut,
  }


def apply_cdf_match(img: np.ndarray, model: dict[str, Any], intensity: float) -> np.ndarray:
  lut = np.array(model["lut"], dtype=np.float32)
  idx = np.clip((img * 255.0 + 0.5).astype(np.int16), 0, 255)
  mapped = np.empty_like(img)
  for c in range(3):
    mapped[:, :, c] = lut[c][idx[:, :, c]]
  t = float(np.clip(intensity, 0.0, 1.0))
  return np.clip(img * (1.0 - t) + mapped * t, 0.0, 1.0)


def load_algorithm_module(path: Path) -> ModuleType:
  spec = importlib.util.spec_from_file_location("vibe_algorithm", path)
  if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load algorithm module at {path}")
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


def to_jsonable(value: Any) -> Any:
  if isinstance(value, np.ndarray):
    return value.tolist()
  if isinstance(value, dict):
    return {str(k): to_jsonable(v) for k, v in value.items()}
  if isinstance(value, (list, tuple)):
    return [to_jsonable(v) for v in value]
  if isinstance(value, (np.floating, np.integer)):
    return value.item()
  return value


def main() -> None:
  parser = argparse.ArgumentParser(
    description=(
      "Run an algorithm-agnostic vibe training loop over <dataset_dir>. "
      "Dataset format: *_in, optional paired *_out, optional val_* split."
    )
  )
  parser.add_argument("dataset", help="Path to vibe dataset folder, e.g. vibe_trainer/vaporwave")
  parser.add_argument("--algorithm", choices=["auto", "poly_map", "cdf_match", "custom"], default="auto")
  parser.add_argument("--intensity", type=float, default=1.0)
  parser.add_argument("--quality", type=int, default=95)
  parser.add_argument("--max-degree", type=int, default=2)
  parser.add_argument("--lambda", dest="ridge_lambda", type=float, default=1e-3)
  args = parser.parse_args()

  dataset_dir = Path(args.dataset).resolve()
  if not dataset_dir.exists() or not dataset_dir.is_dir():
    raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

  samples, ignored, standalone_out_refs = parse_dataset(dataset_dir)
  train_samples = [s for s in samples if s.split == "train"]
  val_samples = [s for s in samples if s.split == "val"]
  paired_train = [s for s in train_samples if s.out_path is not None]

  train_inputs = [load_rgb01(s.in_path) for s in train_samples]
  style_refs = [load_rgb01(s.out_path) for s in train_samples if s.out_path is not None]
  style_refs.extend(load_rgb01(path) for path in standalone_out_refs)

  custom_algorithm_path = dataset_dir / "algorithm.py"
  custom_module: ModuleType | None = None

  selected_algorithm = args.algorithm
  if selected_algorithm == "auto":
    if custom_algorithm_path.exists():
      selected_algorithm = "custom"
    elif paired_train:
      selected_algorithm = "poly_map"
    else:
      selected_algorithm = "cdf_match"

  model: dict[str, Any]
  if selected_algorithm == "custom":
    if not custom_algorithm_path.exists():
      raise FileNotFoundError(f"Expected custom algorithm at {custom_algorithm_path}")
    custom_module = load_algorithm_module(custom_algorithm_path)
    if not hasattr(custom_module, "train") or not hasattr(custom_module, "predict"):
      raise AttributeError("Custom algorithm.py must expose train(context) and predict(image_rgb01, model, intensity, sample)")
    context = {
      "dataset_dir": str(dataset_dir),
      "samples": [
        {
          "key": s.key,
          "split": s.split,
          "in_path": str(s.in_path),
          "out_path": str(s.out_path) if s.out_path else None,
        }
        for s in samples
      ],
    }
    model = custom_module.train(context)
  elif selected_algorithm == "poly_map":
    paired_train_arrays: list[tuple[np.ndarray, np.ndarray]] = []
    for s in paired_train:
      src = load_rgb01(s.in_path)
      tgt = load_rgb01(s.out_path)  # type: ignore[arg-type]
      src, tgt = center_crop_pair(src, tgt)
      paired_train_arrays.append((src, tgt))
    if not paired_train_arrays:
      raise ValueError("poly_map requires at least one paired train *_in/_out example")
    model = train_poly_map(paired_train_arrays, max_degree=args.max_degree, lam=args.ridge_lambda)
  elif selected_algorithm == "cdf_match":
    model = train_cdf_match(inputs=train_inputs, refs=style_refs)
  else:
    raise ValueError(f"Unsupported algorithm: {selected_algorithm}")

  per_image_metrics: list[dict[str, Any]] = []
  for s in samples:
    src = load_rgb01(s.in_path)
    if selected_algorithm == "custom":
      assert custom_module is not None
      pred = custom_module.predict(src, model, args.intensity, {
        "key": s.key,
        "split": s.split,
        "in_path": str(s.in_path),
        "out_path": str(s.out_path) if s.out_path else None,
      })
    elif selected_algorithm == "poly_map":
      pred = apply_poly_map(src, model, args.intensity)
    else:
      pred = apply_cdf_match(src, model, args.intensity)

    if pred.shape != src.shape:
      raise ValueError(f"Prediction shape mismatch for {s.in_path.name}: expected {src.shape}, got {pred.shape}")

    out_prefix = "val_" if s.split == "val" else ""
    pred_path = dataset_dir / f"{out_prefix}{s.key}_pred.jpg"
    save_rgb01(pred_path, pred, quality=args.quality)

    item: dict[str, Any] = {
      "key": s.key,
      "split": s.split,
      "in": s.in_path.name,
      "out": s.out_path.name if s.out_path else None,
      "pred": pred_path.name,
    }
    if s.out_path is not None:
      tgt = load_rgb01(s.out_path)
      mae, rmse = mae_rmse(pred, tgt)
      item["mae"] = mae
      item["rmse"] = rmse
    per_image_metrics.append(item)

  def split_avg(split: str, field: str) -> float | None:
    vals = [float(m[field]) for m in per_image_metrics if m["split"] == split and field in m]
    if not vals:
      return None
    return float(np.mean(vals))

  report = {
    "dataset": dataset_dir.name,
    "dataset_path": str(dataset_dir),
    "algorithm": selected_algorithm,
    "intensity_for_preds": args.intensity,
    "quality_for_preds": args.quality,
    "num_inputs": len(samples),
    "num_train_inputs": len(train_samples),
    "num_val_inputs": len(val_samples),
    "num_train_pairs": len(paired_train),
    "ignored_files": [p.name for p in ignored],
    "standalone_style_refs": [p.name for p in standalone_out_refs],
    "train_avg_mae": split_avg("train", "mae"),
    "train_avg_rmse": split_avg("train", "rmse"),
    "val_avg_mae": split_avg("val", "mae"),
    "val_avg_rmse": split_avg("val", "rmse"),
    "per_image": per_image_metrics,
  }

  model_path = dataset_dir / "vibe_model.json"
  report_path = dataset_dir / "vibe_metrics.json"
  model_path.write_text(json.dumps({"algorithm": selected_algorithm, "model": to_jsonable(model)}, indent=2))
  report_path.write_text(json.dumps(report, indent=2))

  print(f"dataset: {dataset_dir}")
  print(f"algorithm: {selected_algorithm}")
  print(f"wrote {model_path}")
  print(f"wrote {report_path}")
  print("wrote prediction images:")
  for m in per_image_metrics:
    suffix = ""
    if "mae" in m and "rmse" in m:
      suffix = f" mae={float(m['mae']):.3f} rmse={float(m['rmse']):.3f}"
    print(f"  - {m['pred']} ({m['split']}){suffix}")


if __name__ == "__main__":
  main()
