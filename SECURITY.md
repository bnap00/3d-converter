# Security Policy

3D Converter is a static site. Files are converted in your browser and are
never uploaded, so the main risks are in the page itself and the libraries it
ships in `vendor/` (occt-import-js, three.js, fflate).

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
[Report a vulnerability](https://github.com/bnap00/3d-converter/security/advisories/new).
Don't open a public issue for security problems.

Include what you found, how to reproduce it, and the page or file involved.
You should get a reply within a week. Fixes go out on the live site
(https://3d-converter.bnap.dev) as soon as they're ready.

## Supported versions

Only the live site and the `main` branch are supported.
