#!/usr/bin/env -S uv run --script
# /// script
# dependencies = [
#   "numpy>=1.26",
#   "pillow>=10.0",
# ]
# ///

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Pair:
  key: str
  split: str  # "train" | "val"
  in_path: Path
  out_path: Path


COMPLEXITY_PRESETS: dict[str, dict[str, object]] = {
  "low": {
    "max_degree": 2,
    "sample_size": 200_000,
    "lambdas": [1e-3, 1e-2, 5e-2],
  },
  "medium": {
    "max_degree": 3,
    "sample_size": 500_000,
    "lambdas": [1e-4, 1e-3, 1e-2, 5e-2],
  },
  "high": {
    "max_degree": 5,
    "sample_size": 1_000_000,
    "lambdas": [1e-5, 1e-4, 1e-3, 1e-2, 5e-2],
  },
}


def build_exponents(max_degree: int) -> list[tuple[int, int, int]]:
  exps: list[tuple[int, int, int]] = []
  for deg in range(0, max_degree + 1):
    for a in range(deg, -1, -1):
      for b in range(deg - a, -1, -1):
        c = deg - a - b
        exps.append((a, b, c))
  return exps


def poly_features(rgb: np.ndarray, exps: list[tuple[int, int, int]]) -> np.ndarray:
  r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
  cols = [(r ** a) * (g ** bb) * (b ** c) for (a, bb, c) in exps]
  return np.column_stack(cols).astype(np.float32)


def fit_ridge(
  x: np.ndarray,
  y: np.ndarray,
  exps: list[tuple[int, int, int]],
  lam: float,
) -> np.ndarray:
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
  return np.stack(coefs, axis=1).astype(np.float32)


def apply_poly(
  img_rgb01: np.ndarray,
  coefs: np.ndarray,
  exps: list[tuple[int, int, int]],
  intensity: float,
) -> np.ndarray:
  t = float(np.clip(intensity, 0.0, 1.0))
  flat = img_rgb01.reshape(-1, 3)
  phi = poly_features(flat, exps)
  graded = np.clip(phi @ coefs, 0.0, 1.0)
  out = flat * (1.0 - t) + graded * t
  return np.clip(out.reshape(img_rgb01.shape), 0.0, 1.0)


def mae_rmse(pred_rgb01: np.ndarray, tgt_rgb01: np.ndarray) -> tuple[float, float]:
  d = (pred_rgb01 - tgt_rgb01) * 255.0
  mae = float(np.mean(np.abs(d)))
  rmse = float(np.sqrt(np.mean(d * d)))
  return mae, rmse


def load_rgb(path: Path) -> np.ndarray:
  return np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


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


def crop_inner_region(img: np.ndarray, frac: float = 0.90) -> np.ndarray:
  h, w = img.shape[:2]
  inner_h = max(1, int(round(h * frac)))
  inner_w = max(1, int(round(w * frac)))
  y0 = max(0, (h - inner_h) // 2)
  x0 = max(0, (w - inner_w) // 2)
  return img[y0:y0 + inner_h, x0:x0 + inner_w]


def find_pairs(dataset_dir: Path) -> list[Pair]:
  pairs: list[Pair] = []
  in_files = sorted(dataset_dir.glob("*_in.jpg")) + sorted(dataset_dir.glob("*_in.jpeg"))
  for in_path in in_files:
    stem = in_path.stem
    if not stem.endswith("_in"):
      continue
    key = stem[:-3]
    split = "val" if key.startswith("val_") else "train"
    out_jpg = in_path.with_name(f"{key}_out.jpg")
    out_jpeg = in_path.with_name(f"{key}_out.jpeg")
    out_path = out_jpg if out_jpg.exists() else out_jpeg
    if not out_path.exists():
      raise FileNotFoundError(f"Missing paired output image for {in_path.name}: expected {out_jpg.name} or {out_jpeg.name}")
    pairs.append(Pair(key=key, split=split, in_path=in_path, out_path=out_path))
  if not pairs:
    raise FileNotFoundError(f"No *_in.jpg or *_in.jpeg files found in {dataset_dir}")
  return pairs


def flatten_pairs(samples: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
  x = np.concatenate([s.reshape(-1, 3) for s, _ in samples], axis=0)
  y = np.concatenate([t.reshape(-1, 3) for _, t in samples], axis=0)
  return x, y


def maybe_subsample(x: np.ndarray, y: np.ndarray, sample_size: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
  if sample_size <= 0 or x.shape[0] <= sample_size:
    return x, y
  rng = np.random.default_rng(seed)
  idx = rng.choice(x.shape[0], size=sample_size, replace=False)
  return x[idx], y[idx]


def save_rgb01(img_rgb01: np.ndarray, out_path: Path, quality: int = 95) -> None:
  out_u8 = np.clip(img_rgb01 * 255.0 + 0.5, 0, 255).astype(np.uint8)
  Image.fromarray(out_u8, mode="RGB").save(out_path, quality=quality)


def parse_lambdas(raw: str | None) -> list[float] | None:
  if raw is None:
    return None
  vals = [float(x.strip()) for x in raw.split(",") if x.strip()]
  return vals or None


def main() -> None:
  parser = argparse.ArgumentParser(
    description=(
      "Train a polynomial LUT from *_in.jpg -> *_out.jpg pairs in a sibling dataset dir.\n"
      "Files prefixed with val_ are validation examples."
    )
  )
  parser.add_argument(
    "dataset",
    help="Dataset directory name (sibling of this script), e.g. 'twilight' or 'mexico'",
  )
  parser.add_argument(
    "--complexity",
    choices=sorted(COMPLEXITY_PRESETS.keys()),
    default="medium",
    help="Model complexity/cost preset",
  )
  parser.add_argument("--max-degree", type=int, default=None, help="Override max polynomial degree")
  parser.add_argument("--sample-size", type=int, default=None, help="Override training sample cap (pixels)")
  parser.add_argument("--lambdas", type=str, default=None, help="Comma list of ridge lambdas")
  parser.add_argument("--intensity", type=float, default=1.0, help="Blend intensity used for *_pred.jpg generation")
  parser.add_argument("--quality", type=int, default=95, help="JPEG quality for prediction images")
  parser.add_argument("--seed", type=int, default=0, help="RNG seed for subsampling")
  args = parser.parse_args()

  script_dir = Path(__file__).resolve().parent
  dataset_dir = script_dir / args.dataset
  if not dataset_dir.exists() or not dataset_dir.is_dir():
    raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

  preset = COMPLEXITY_PRESETS[args.complexity]
  max_degree = int(args.max_degree if args.max_degree is not None else preset["max_degree"])
  sample_size = int(args.sample_size if args.sample_size is not None else preset["sample_size"])
  lambdas = parse_lambdas(args.lambdas) or list(preset["lambdas"])  # type: ignore[arg-type]

  pairs = find_pairs(dataset_dir)
  train_pairs = [p for p in pairs if p.split == "train"]
  val_pairs = [p for p in pairs if p.split == "val"]
  if not train_pairs:
    raise ValueError("No training pairs found. Add at least one non-val *_in/out pair.")

  train_samples: list[tuple[np.ndarray, np.ndarray]] = []
  for pair in train_pairs:
    src = load_rgb(pair.in_path)
    tgt = load_rgb(pair.out_path)
    src, tgt = center_crop_pair(src, tgt)
    src = crop_inner_region(src, frac=0.90)
    tgt = crop_inner_region(tgt, frac=0.90)
    train_samples.append((src, tgt))
  x_train, y_train = flatten_pairs(train_samples)
  x_fit, y_fit = maybe_subsample(x_train, y_train, sample_size=sample_size, seed=args.seed)

  val_loaded: list[tuple[Pair, np.ndarray, np.ndarray]] = []
  for pair in val_pairs:
    src = load_rgb(pair.in_path)
    tgt = load_rgb(pair.out_path)
    src, tgt = center_crop_pair(src, tgt)
    src = crop_inner_region(src, frac=0.90)
    tgt = crop_inner_region(tgt, frac=0.90)
    val_loaded.append((pair, src, tgt))

  best: tuple[float, float, int, float] | None = None
  best_payload: dict[str, object] | None = None

  for degree in range(1, max_degree + 1):
    exps = build_exponents(degree)
    for lam in lambdas:
      coefs = fit_ridge(x_fit, y_fit, exps, lam)
      train_pred = apply_poly(x_fit.reshape(-1, 1, 3), coefs, exps, 1.0).reshape(-1, 3)
      train_mae, train_rmse = mae_rmse(train_pred, y_fit)

      if val_loaded:
        v_mae_sum = 0.0
        v_rmse_sum = 0.0
        for _, v_src, v_tgt in val_loaded:
          pred = apply_poly(v_src, coefs, exps, 1.0)
          m1, m2 = mae_rmse(pred, v_tgt)
          v_mae_sum += m1
          v_rmse_sum += m2
        val_mae = v_mae_sum / len(val_loaded)
        val_rmse = v_rmse_sum / len(val_loaded)
        score = (val_rmse, val_mae, len(exps), lam)
      else:
        val_mae = train_mae
        val_rmse = train_rmse
        score = (train_rmse, train_mae, len(exps), lam)

      if best is None or score < best:
        best = score
        best_payload = {
          "degree": degree,
          "lambda": lam,
          "exps": exps,
          "coefs": coefs,
          "train_mae": train_mae,
          "train_rmse": train_rmse,
          "val_mae": val_mae,
          "val_rmse": val_rmse,
          "num_features": len(exps),
        }

  assert best_payload is not None

  exps = best_payload["exps"]  # type: ignore[assignment]
  coefs = best_payload["coefs"]  # type: ignore[assignment]
  degree = int(best_payload["degree"])  # type: ignore[arg-type]
  lam = float(best_payload["lambda"])  # type: ignore[arg-type]

  per_image_metrics: list[dict[str, object]] = []
  for pair in pairs:
    src_full = load_rgb(pair.in_path)
    tgt = load_rgb(pair.out_path)
    src_full, tgt = center_crop_pair(src_full, tgt)
    pred_full = apply_poly(src_full, coefs, exps, args.intensity)  # type: ignore[arg-type]
    pred_path = dataset_dir / f"{pair.key}_pred.jpg"
    save_rgb01(pred_full, pred_path, quality=args.quality)

    # Metrics ignore the outer 5% border on each side.
    pred_eval = crop_inner_region(pred_full, frac=0.90)
    tgt_eval = crop_inner_region(tgt, frac=0.90)
    mae, rmse = mae_rmse(pred_eval, tgt_eval)
    per_image_metrics.append({
      "key": pair.key,
      "split": pair.split,
      "in": pair.in_path.name,
      "out": pair.out_path.name,
      "pred": pred_path.name,
      "mae": mae,
      "rmse": rmse,
    })

  train_metrics = [m for m in per_image_metrics if m["split"] == "train"]
  val_metrics = [m for m in per_image_metrics if m["split"] == "val"]

  def split_avg(items: list[dict[str, object]], field: str) -> float | None:
    if not items:
      return None
    return float(np.mean([float(x[field]) for x in items]))

  model_npz_path = dataset_dir / "lut_model.npz"
  np.savez(model_npz_path, coefs=coefs, exps=np.array(exps, dtype=np.int16))  # type: ignore[arg-type]

  model_json_path = dataset_dir / "lut_model.json"
  model_json = {
    "dataset": args.dataset,
    "complexity": args.complexity,
    "max_degree": max_degree,
    "selected_degree": degree,
    "selected_lambda": lam,
    "sample_size": sample_size,
    "lambdas": lambdas,
    "num_features": int(best_payload["num_features"]),  # type: ignore[arg-type]
    "intensity_for_preds": args.intensity,
    "train_pairs": [p.key for p in train_pairs],
    "val_pairs": [p.key for p in val_pairs],
    "train_fit_mae": float(best_payload["train_mae"]),  # type: ignore[arg-type]
    "train_fit_rmse": float(best_payload["train_rmse"]),  # type: ignore[arg-type]
    "val_select_mae": float(best_payload["val_mae"]),  # type: ignore[arg-type]
    "val_select_rmse": float(best_payload["val_rmse"]),  # type: ignore[arg-type]
    "exps": exps,
  }
  model_json_path.write_text(json.dumps(model_json, indent=2))

  metrics_json_path = dataset_dir / "metrics.json"
  metrics_json = {
    "train_avg_mae": split_avg(train_metrics, "mae"),
    "train_avg_rmse": split_avg(train_metrics, "rmse"),
    "val_avg_mae": split_avg(val_metrics, "mae"),
    "val_avg_rmse": split_avg(val_metrics, "rmse"),
    "per_image": per_image_metrics,
  }
  metrics_json_path.write_text(json.dumps(metrics_json, indent=2))

  print(f"dataset: {dataset_dir}")
  print(f"complexity: {args.complexity} | selected degree={degree} lambda={lam}")
  print(f"features: {int(best_payload['num_features'])}")  # type: ignore[index]
  print(f"wrote {model_npz_path}")
  print(f"wrote {model_json_path}")
  print(f"wrote {metrics_json_path}")
  print("wrote prediction images:")
  for m in per_image_metrics:
    print(f"  - {m['pred']} ({m['split']}) mae={float(m['mae']):.3f} rmse={float(m['rmse']):.3f}")


if __name__ == "__main__":
  main()
