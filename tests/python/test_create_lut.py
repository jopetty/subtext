from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np
import pytest


def load_create_lut_module():
  root = Path(__file__).resolve().parents[2]
  module_path = root / "lut_trainer" / "create_lut.py"
  spec = importlib.util.spec_from_file_location("create_lut", module_path)
  assert spec is not None
  assert spec.loader is not None
  module = importlib.util.module_from_spec(spec)
  sys.modules[spec.name] = module
  spec.loader.exec_module(module)
  return module


def test_build_exponents_degree_2_shape():
  mod = load_create_lut_module()
  exps = mod.build_exponents(2)
  assert len(exps) == 10
  assert (0, 0, 0) in exps
  assert (2, 0, 0) in exps
  assert (0, 1, 1) in exps


def test_parse_lambdas_valid_and_empty():
  mod = load_create_lut_module()
  assert mod.parse_lambdas("1e-4, 0.05 ,1") == [1e-4, 0.05, 1.0]
  assert mod.parse_lambdas(" , ") is None
  assert mod.parse_lambdas(None) is None


def test_maybe_subsample_is_deterministic():
  mod = load_create_lut_module()
  x = np.arange(300, dtype=np.float32).reshape(100, 3)
  y = x.copy()
  x1, y1 = mod.maybe_subsample(x, y, sample_size=15, seed=42)
  x2, y2 = mod.maybe_subsample(x, y, sample_size=15, seed=42)
  assert x1.shape == (15, 3)
  assert np.array_equal(x1, x2)
  assert np.array_equal(y1, y2)


def test_crop_inner_region_keeps_center():
  mod = load_create_lut_module()
  img = np.arange(6 * 8 * 3, dtype=np.float32).reshape(6, 8, 3)
  cropped = mod.crop_inner_region(img, frac=0.5)
  assert cropped.shape[:2] == (3, 4)
  expected = img[1:4, 2:6]
  assert np.array_equal(cropped, expected)


def test_apply_poly_identity_mapping():
  mod = load_create_lut_module()
  exps = [(1, 0, 0), (0, 1, 0), (0, 0, 1)]
  coefs = np.eye(3, dtype=np.float32)
  img = np.array([[[0.1, 0.2, 0.3], [0.8, 0.7, 0.6]]], dtype=np.float32)
  out = mod.apply_poly(img, coefs, exps, intensity=1.0)
  assert np.allclose(out, img, atol=1e-6)


def test_find_pairs_detects_train_val_and_missing_output(tmp_path: Path):
  mod = load_create_lut_module()

  (tmp_path / "train_a_in.jpg").write_bytes(b"x")
  (tmp_path / "train_a_out.jpg").write_bytes(b"x")
  (tmp_path / "val_b_in.jpeg").write_bytes(b"x")
  (tmp_path / "val_b_out.jpeg").write_bytes(b"x")
  pairs = mod.find_pairs(tmp_path)

  keys = {pair.key for pair in pairs}
  splits = {pair.key: pair.split for pair in pairs}
  assert keys == {"train_a", "val_b"}
  assert splits["train_a"] == "train"
  assert splits["val_b"] == "val"

  (tmp_path / "broken_in.jpg").write_bytes(b"x")
  with pytest.raises(FileNotFoundError):
    mod.find_pairs(tmp_path)
