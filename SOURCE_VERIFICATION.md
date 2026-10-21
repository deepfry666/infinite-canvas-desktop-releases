# Public Source Snapshot Verification

## Scope

This is a reviewed source import, not a new desktop release. `SOURCE_SNAPSHOT.json` identifies the beta.4 source baseline; historical public tags and installers remain unchanged and do not identify this imported source tree.

## Evidence

- The original test commands pass on Node.js 24.17.0: 109 desktop tests and 250 TypeScript tests, with zero failures. Test files and assertions are unchanged.
- `npm run web:typecheck` and `npm run web:build` pass. The existing large-chunk and mixed static/dynamic-import warnings remain; this task does not optimize the application bundle.
- An isolated local preview of the built desktop renderer opens Home and Settings / System & about, shows the full beta.4 version and MIT upstream-source notice, and renders the existing system font stack without horizontal document overflow in the checked viewport. This browser-only smoke check is not an Electron package acceptance test. No user workspace, API key, or model request is used.
- All desktop `.mjs` files, including application identity, workspace, storage, and update implementations, are byte-identical to the baseline. Runtime edits are limited to removing bundled MiSans font declarations/preload and updating the two localized source-license notices.
- The retained Noto Serif SC and PT Serif binaries match the baseline and include their OFL texts. MiSans binaries, the optional separately licensed external plugin, copied third-party protocol prose, and local agent skill metadata are excluded or replaced as documented in `THIRD_PARTY_NOTICES.md`.
- Public-file disclosure checks and a redacted Gitleaks scan cover the exported source set; dependency trees, build caches, private Git history, and local verification records are not imported. Independent review checks the actual staged file set before publication.

## Not Verified

- Windows installation, packaged Electron startup, font wrapping/sharpness, stable/preview upgrades, workspace preservation, or signed/reproducible installer builds.
- Real model output quality or live provider behavior. Existing offline tests do not establish either.
- Unpushed work on another computer, or unmerged historical branches. Those remain separate from this reviewed snapshot.

Use `OPEN_SOURCE.md` for developer-machine migration. A future installer release requires its own authorization and platform checks.
