# 3D Converter

Free, bulk STEP/IGES to STL converter that runs entirely in the browser.
Live at https://3dconverter.bnap.dev

Plain HTML, CSS and JavaScript. No framework, and no build step on deploy.

## Pages

`index.html`, `stp-to-stl.html` and `iges-to-stl.html` are generated from
`templates/page.html`. The per-page text and FAQs live in `tools/build.mjs`.
After editing either, regenerate the pages and the sitemap:

    node tools/build.mjs

Commit the generated files. Vercel serves them as-is.

## Run locally

    python3 tools/serve.py 4173

Then open http://localhost:4173. This dev server handles clean URLs
(`/stp-to-stl`) and the 404 page the same way Vercel does.

## Deploy

Vercel, Framework Preset "Other", no build command. Caching and headers are in
`vercel.json`. Files in `vendor/` and `fonts/` are cached forever, so when you
upgrade a library, put it in a new versioned folder (e.g. `three@0.187.0/`) and
update the paths.

## Credits

STEP/IGES import: occt-import-js and OpenCascade (LGPL-2.1). three.js (MIT),
fflate (MIT), Geist fonts (OFL), Phosphor icons (MIT).
