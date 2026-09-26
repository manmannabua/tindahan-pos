# Generic POS branding

Generated with built-in image_gen. Exact generation and refinement prompts are in
[prompts.json](prompts.json). The terminal and checkmark represent checkout completion.

- `pos-symbol-master.png`: original square app symbol.
- `pos-logo-master.png`: original transparent horizontal POS wordmark.
- `previous/`: preserved previous app icon artwork.
- `../../frontend/public/brand/`: optimized logo and symbol used in the interface.
- `../../frontend/public/icons/pos-*.png`: 16, 32, 48, 192, 512 and maskable 512 px exports.
- `../../frontend/app/favicon.ico`: multi-resolution 16/32/48 px browser favicon.
- `../../frontend/app/icon.png`: 32 px browser icon.
- `../../frontend/app/apple-icon.png`: 180 px Apple home-screen icon.

Run `pnpm gen:icons` from `frontend/` to reproduce the exports using the saved masters.
The exporter preserves the logo's transparent background. The maskable icon includes
extra padding to keep the terminal inside circular masks.

The older `generate-icons.py` and `generate-icons.mjs` scripts are legacy artwork
generators; use `pnpm gen:icons` for the current branding.
