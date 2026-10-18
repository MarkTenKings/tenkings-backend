# Foil artwork delivery repair — October 17, 2026

## Observed failure

The owner’s paired production screenshots show original-format previews loading and black/transparent foil previews failing. Actual Chrome inspection confirms `artwork?mode=preview-foil` returns HTTP 502 with `MANUAL_SERVICE_RESPONSE_INVALID`. A retained layout-retry request for an earlier card also receives 502, keeping the browser’s request journal unresolved and disabling new exports. Current production has three approved labels across Sports and Pokémon sheets. Jaxson Dart’s approved label displays **8**, confirming the current whole-number award is present.

## Cause and scope

Live inspection found that the inner link proxy admits both foil modes and layout retries, but the outer host Caddy gateway still omits them. The outer gateway rejects these requests before they reach the application. The transport correctly refuses its non-JSON response; the browser correctly retains an uncertain write instead of inventing success.

The applied correction changes exactly three outer gateway matcher values: the artwork query allowlist and the layout-retry path/raw-URI allowlists. It preserves authentication, signatures, ownership checks, other routes, upstreams, limits and timeouts. No application rebuild, scoring change, card edit, approval, migration, or native worker restart is needed.

## Qualification

- Browser client/component: 50/50 passed, including exact saved-journal retention on 502 and cleanup on definitive deleted-source responses.
- Renderer/backend: 38/38 passed, including Sports/Pokémon black/transparent artwork, individual/sheet PNGs, stored profile integrity, and signed routes.
- Local real HTTP signed transport passed all four artwork modes.
- Installed-Caddy validation, six exact-scope regression groups, 28 baseline and 28 post-change inner/outer route probes passed.
- Independent plan and applied-receipt reviews passed.
- Actual owner Chrome preview/recovery/download flow passed for all three labels and both sheets.

Evidence root: `~/.codex/atlas-handoffs/atlas-label-foil-delivery-20261017/`.

Individual target: 68.342 × 20.082 mm, 6458 × 1898 pixels. Jig target: 310 × 400 mm, 9764 × 12598 pixels. Black/transparent PNG acceptance requires every pixel to have RGB zero and alpha either zero or 255, valid density metadata, and substantial ink and transparent content. Physical E1 scale/origin, coverage and adhesion still require actual printed samples on both materials.

## Applied and authenticated evidence

Applied at2026-10-18T00:24:48.836022+00:00 (October17 Pacific), exact plan612b67e3d453828d8f217d28a5eee65967ba6ee4515c4903924501c41d43a22d. One-use result3195c050aead3201102f3acde1797ab819c79048aadf72ebb72eb339dae3f38b records one config write, one graceful reload, zero restarts/DB/provider calls, unchanged process/file identity/network/security and exact three-value adapted configuration. Independent plan reviewd64accde7c5dac2009674232afb01ec4fce9d24e1df0daa61c51ec1509cf4154 and applied review79f262f566e3a86a9267b968c510d7a91c0c26862953d7bde584f0eaf82fb828 passed. Original bytes are preserved; no automatic replay or rollback occurred.

The existing browser request was reconciled through the normal Check connection action. After a page reload there is no saved-request warning, both preview modes load, and exports are enabled. The agent prepared/downloaded existing approved artwork only. Sheet005 and Sheet006 are now frozen export snapshots; future approvals fill a new compatible sheet. Physical printing remains unrecorded.

Actual downloaded-file receipt SHA256 `66aee41ad6cd8260bb41c3f651e19392c557dc6dbd16fbbc29bc1e047496e963` is `acceptance/downloaded-files-verification.json`. Files are saved under `~/Downloads/ATLAS_Verified_Foil_Labels_2026-10-17/` alongside exact import instructions and a preview-only HTML viewer. The viewer displays the unmodified downloaded PNGs on a checkerboard; the checkerboard is not in the print files.

| Download | SHA256 | Black / transparent pixels |
|---|---|---|
| Pokemon_Alakazam_ex_grade_9_BLACK_TRANSPARENT.png | `3f520d12b60c2dc64f2638038e1d2708ff2867d3643247ce02d4efeb522c5471` | 8120071 / 4137213 |
| Pokemon_Sylveon_ex_grade_9_BLACK_TRANSPARENT.png | `1b59e653ded4b403fcee3d8ece34ddfd65220f82da9d78320beae588f227305a` | 7962038 / 4295246 |
| Sheet_005_Sports_310x400mm_BLACK_TRANSPARENT.png | `b6ad7df781dc3495a1d5ee5ceb9f04a6dc4e8b45df44cbd5e7dcffbbf44faf77` | 882571 / 122124301 |
| Sheet_006_Pokemon_310x400mm_BLACK_TRANSPARENT.png | `fa7c9a2bef795f2c6b5778727da8ce2186d6c5ee7ec4a1cfd331879886a5fe49` | 1783859 / 121223013 |
| Sports_Jaxson_Dart_grade_8_BLACK_TRANSPARENT.png | `323fdead4d1eab47f1d0a60722e5ed981747638e55268ad65c24b2f6b6f420c1` | 7959080 / 4298204 |

Proof screenshots: `acceptance/pokemon-print-preview-live.png`, `acceptance/downloaded-pngs-checkerboard-all.png`, and `acceptance/live-labels-final.png`. All five files have zero nonblack RGB values and zero partial-alpha pixels; CRCs and physical metadata passed. No physical E1 output was generated or claimed.
