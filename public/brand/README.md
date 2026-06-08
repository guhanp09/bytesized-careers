# CreatorJobs canonical logo assets

`logo-reference-raw.png` is the canonical uploaded reference binary and should never be edited manually.

Header rendering uses only extracted transparent raster variants:

- `logo-mark-32.png` (base)
- `logo-mark-64.png` (2x)
- `logo-mark-96.png` (3x)

All are produced from `logo-reference-raw.png` by `scripts/extract_logo_mark.py`.

## Regenerate extracted logo variants

```bash
npm run extract:logo
```

This runs:

```bash
python scripts/extract_logo_mark.py
```

and rewrites:

- `logo-mark.png`
- `logo-mark-32.png`
- `logo-mark-64.png`
- `logo-mark-96.png`
