# CreatorJobs Brand Assets

All assets in this directory are transparent-background, flat off-white (`#F2F2F2`) marks optimized for dark UI surfaces.

## Recommended usage

- Header / navigation brand mark:
  - `logo-mark-primary.svg`
  - fallback PNGs: `logo-mark-primary-128.png`, `logo-mark-primary-256.png`, `logo-mark-primary-512.png`
- Favicon / tiny contexts:
  - `favicon.svg`
  - `favicon.ico` (multi-size)
  - `logo-mark-micro.svg` for very small icon contexts
- Wordmark lockup:
  - `logo-lockup.svg`
  - PNG fallbacks: `logo-lockup-256.png`, `logo-lockup-512.png`

## Generation

Run:

```bash
python3 assets/brand/generate_brand_assets.py
```

This regenerates:

- primary and micro SVG + PNG sets
- lockup SVG + PNG sets
- `favicon.svg` and multi-size `favicon.ico`
- size-legibility preview at `logo-preview.png`

## Notes

- SVGs are emitted as compact/minified markup by the generator.
- `svgo` install was not available in this environment (offline registry access), so no external svgo CLI pass was run.
