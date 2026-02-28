# vibe_trainer

See [SPEC.md](./SPEC.md) for the full agent workflow.

Quick start:
```bash
# Auto-select algorithm (custom -> poly_map -> cdf_match)
uv run vibe_trainer/run.py vibe_trainer/<VIBE_NAME>

# Force algorithm
uv run vibe_trainer/run.py vibe_trainer/<VIBE_NAME> --algorithm custom
uv run vibe_trainer/run.py vibe_trainer/<VIBE_NAME> --algorithm poly_map --max-degree 2 --lambda 1e-3
uv run vibe_trainer/run.py vibe_trainer/<VIBE_NAME> --algorithm cdf_match
```

Custom algorithm template:
```bash
cp vibe_trainer/template/algorithm.py vibe_trainer/<VIBE_NAME>/algorithm.py
```

Dataset note:
- Pairing is optional. You can provide matched `*_in/*_out` samples, unpaired style refs (`*_out` only), or a mix.
- `val_*` files are validation-only.
