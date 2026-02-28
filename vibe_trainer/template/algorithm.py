"""Custom vibe algorithm contract for vibe_trainer/run.py.

Implement any transform family you want (LUT, blur/ghost, edge-aware stylization,
palette quantization, etc.). Keep training/prediction deterministic.
"""

from __future__ import annotations

from typing import Any

import numpy as np


def train(context: dict[str, Any]) -> dict[str, Any]:
  """Return a JSON-serializable model object.

  context keys:
  - dataset_dir: absolute path string
  - samples: list[{key, split, in_path, out_path}]
  """
  # Replace with your own fitting logic.
  return {"note": "identity template"}


def predict(
  image_rgb01: np.ndarray,
  model: dict[str, Any],
  intensity: float,
  sample: dict[str, Any],
) -> np.ndarray:
  """Return predicted RGB image in [0,1] with same shape as input."""
  _ = model, sample
  t = float(np.clip(intensity, 0.0, 1.0))
  # Identity baseline: replace with your transform.
  return np.clip(image_rgb01 * (1.0 - 0.0 * t), 0.0, 1.0)
