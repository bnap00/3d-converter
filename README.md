# 3D Converter

Free, bulk STEP/IGES to STL converter that runs entirely in the browser, plus a
stabilizer fins tool for tall, thin prints.
Live at https://3d-converter.bnap.dev

Plain HTML, CSS and JavaScript. No framework, and no build step on deploy.

## Pages

`index.html`, `stp-to-stl.html` and `iges-to-stl.html` are generated from
`templates/page.html`, and `stabilizer-fins.html` from `templates/fins.html`.
Both share the head, header and footer in `templates/_*.html`. The per-page
text and FAQs live in `tools/build.mjs`. After editing any of them, regenerate
the pages and the sitemap:

    node tools/build.mjs

Commit the generated files. Vercel serves them as-is.

## Stabilizer fins

`/stabilizer-fins` adds breakaway fins to both sides of a tall, thin part so it
cannot be knocked over mid-print. It takes STL, STEP or IGES (STEP and IGES go
through the converter worker first) and downloads one STL with the fins
included.

Each fin is a vertical plate standing edge-on to a side of the part, tapering
from a deep foot at the bed to a flat top. Its inner edge follows the part at a
0.2 mm gap and never steps in faster than 45 degrees, and one-layer horizontal
tines bridge that gap into the part, so the fin holds the part both ways. A
thin flange and a round pad keep the fin on the bed. The idea and the gap and
tine sizes come from designed-in support fins (Slant3D, and
[Support Fins](https://github.com/gittrahan/support-fins), which builds them
under overhangs).

The tool measures height against the width of the part's footprint on the
bed and, for a part at least 2.5 times taller than its base is wide, suggests
fins in pairs on both thin sides (and on both ends when the part is thin both
ways). You can move, resize and delete fins, or click the part to add one.

- `assets/fins-geometry.js`: analysis and fin geometry. No DOM, no three.js.
- `assets/fins-view.js`: the three.js view, lazy-loaded with the first part.
- `assets/fins-app.js`: the page.

The geometry has tests that run in Node with no dependencies:

    node tools/test-fins.mjs

## Run locally

    python3 tools/serve.py 4173

Then open http://localhost:4173. This dev server handles clean URLs
(`/stp-to-stl`) and the 404 page the same way Vercel does.

## Analytics

Rybbit (self-hosted at r.bnap.dev) records page views and outbound clicks on
its own. `assets/app.js` adds these custom events. They never include file
names or file contents.

| Event | Properties |
| --- | --- |
| `files_added` | `source` (picker, drop, folder), `files`, `skipped`, `formats` |
| `engine_ready` | `seconds` to load the converter engine |
| `conversion_done` | `format`, `quality`, `split_bodies`, `size` bucket, `rerun`, `seconds`, `bodies`, `stl_files`, `triangles` |
| `conversion_failed` | same as above minus the output counts, plus `reason` (unreadable, no_geometry, out_of_memory, crashed, disk_read, other) |
| `batch_finished` | `files`, `done`, `failed` |
| `download` | `scope` (single, all), `kind` (stl, zip), `stl_files` |
| `preview_opened` / `preview_failed` | `format`, `bodies` |
| `quality_changed`, `split_bodies_changed`, `reconvert`, `queue_cleared` | the new setting or file count |
| `faq_opened` | `question` |
| `github_star_click` | none (the "Star it on GitHub" link shown after a conversion) |

The stabilizer fins page sends its own events, with the same rule:

| Event | Properties |
| --- | --- |
| `fins_file_loaded` | `source` (picker, drop), `format`, `size` bucket, `seconds`, `triangles`, `risk` (low, medium, high) |
| `fins_file_failed` | `format` |
| `fins_turned` | `axis` |
| `fins_suggested` | `fins`, `risk` |
| `fin_added`, `fin_removed` | `fins` (the new count) |
| `fins_setting_changed` | `setting`, `value` |
| `fins_download` | `fins`, `tines`, `risk`, `layer_height` |

## Deploy

Vercel, Framework Preset "Other", no build command. Caching and headers are in
`vercel.json`. Files in `vendor/` and `fonts/` are cached forever, so when you
upgrade a library, put it in a new versioned folder (e.g. `three@0.187.0/`) and
update the paths. The icon sprite is cached forever too: to add an icon, copy
it to the next version (`icons-v3.svg`) and update the references.

## Credits

STEP/IGES import: occt-import-js and OpenCascade (LGPL-2.1). three.js (MIT),
fflate (MIT), Geist fonts (OFL), Phosphor icons (MIT).
