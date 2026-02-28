# Vibe Trainer Spec

Use this spec when a coding agent is asked to "train a new vibe".

## Objective

Design and ship an image transform that achieves a target aesthetic and is production-ready in this app.

A vibe implementation is complete only when all of these exist:
1. A Python development implementation that can iterate on local dataset inputs and emit `_pred` outputs.
2. A CPU JavaScript implementation used by export/render paths.
3. A GPU/WebGL implementation for interactive preview where needed.
4. Wiring into Vibes UI with consistent params/defaults and without branching churn.
5. Visual parity checks on train/val examples and app preview/export behavior.

## Non-Negotiable Constraints

1. Support both CPU and GPU paths for final shipped vibes.
2. Do not rely on CSS-only render hacks for editor preview correctness.
3. Keep preview and export behavior aligned, including JPEG output behavior.
4. Assume coordinate/sign differences can exist across CPU vs GPU math:
- Angle direction can invert.
- Y-axis orientation can differ.
- Pixel center sampling can differ.
Treat parity checks as required.
5. Keep algorithms deterministic enough for iterative evaluation.

## Dataset Contract

Use a folder: `vibe_trainer/<VIBE_NAME>/`

Accepted image extensions: `.jpg`, `.jpeg`, `.png`, `.webp`

Naming:
- `*_in.*`: input/test image
- `*_out.*`: desired target output (optional for some examples)
- `*_pred.jpg`: generated prediction (produced by runner)
- `val_*`: validation sample prefix; never used for fitting, only review

Examples:
- Paired train: `portrait_in.jpg` + `portrait_out.jpg`
- Paired val: `val_street_in.jpg` + `val_street_out.jpg`
- Unpaired style refs: `look1_out.jpg`, `look2_out.jpg` with no `_in`
- Mixed/mismatched sets: any combination of paired samples plus extra standalone `_out` references.

Rules:
1. Non-`val_` files are train/dev files.
2. `val_` files are validation-only.
3. Paired samples share same stem besides `_in`/`_out`, but pairing is optional.
4. Input/output counts can differ; do not assume one-to-one coverage.
5. Extra `_out` files without matching `_in` are style references and should be used for fitting/style guidance.
6. If no train pairs exist, use unpaired strategy and judge by visual outcome on `_pred`.

## Runner

Use:
```bash
uv run vibe_trainer/run.py vibe_trainer/<VIBE_NAME>
```

Runner behavior:
1. Discovers dataset by naming rules.
2. Trains/loads algorithm.
3. Writes `_pred` for each `*_in` sample (train and val).
4. Writes `vibe_model.json` and `vibe_metrics.json`.

Algorithm modes:
- Built-in `poly_map` (paired mapping; LUT-like polynomial fit)
- Built-in `cdf_match` (unpaired distribution style matching)
- `custom` via `vibe_trainer/<VIBE_NAME>/algorithm.py`

`custom` contract:
- `train(context) -> model`
- `predict(image_rgb01, model, intensity, sample) -> image_rgb01`

Copy starter template from `vibe_trainer/template/algorithm.py`.

## Agent Workflow

1. Inspect target references first:
- Read all train `_out` images.
- Compare with train `_in` images if paired.
- Note palette, contrast curve, highlight/shadow behavior, edge treatment, spatial artifacts (ghosting, scanlines, blur, swirl, etc.).

2. Choose transform family:
- Start from a simple hypothesis (tone curve/LUT, palette map, blur+offset, edge-aware stylization, etc.).
- Escalate complexity only if visual mismatch remains.

3. Implement Python loop first:
- Implement or update algorithm.
- Run `uv run vibe_trainer/run.py ...` to regenerate `_pred`.
- Iterate until visually satisfactory against train/val references.

4. Freeze algorithm contract:
- Document parameters and expected ranges.
- Record important invariants (e.g., angle sign convention, intensity mix behavior).

5. Port to app:
- Add CPU implementation in JS export/render path.
- Add GPU implementation for interactive preview as needed.
- Register defaults and controls in app metadata maps.
- Ensure UI extensibility by adding metadata, not control-flow branches.

6. Validate parity:
- Compare Python `_pred` vs JS CPU output.
- Compare CPU output vs GPU preview output.
- Validate on both train and `val_` examples.
- Confirm final exported JPEG matches expected vibe character.

## Definition Of Done

1. `_pred` outputs look correct on train and `val_` inputs.
2. App preview and export are visually consistent.
3. CPU and GPU differences are handled and documented.
4. New vibe requires minimal app wiring changes (metadata + implementation, no ad-hoc branch explosion).
