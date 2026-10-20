# ATLAS experience source

This directory preserves the current ATLAS marketing experience: interactive card hero, report and fingerprint chapters, conceptual NFC anatomy, fictional VEX story, current submission routes, and weekly capacity.

The October 20 showcase uses four newly approved cards selected by the owner: Black Diamond Michael Jordan (8) in the hero, Fleer Michael Jordan #273 (7) in Beyond the Grade, red-border Michael Jordan (7) for the fingerprint, and Jalen Hurts Purple X-Refractor (9) for the connected report. The headline, identity, grade, findings, photos and fingerprint load from each section’s bound approved report.

## Swapping a card, including Pokémon

Edit only `frontend/atlas-public/lib/showcase-selections.mjs`: change that section’s `publicToken`, `approvalVersion`, and `publicHash` together to the desired current approved publication. Use the public projection hash, not the internal report hash. The API verifies the entire binding on every read. Preview and verify both sides, the saved grade, finding count, report link and full inspection before publishing. Different sections can hold different approved cards; a missing or retired report displays unavailable rather than a historical fallback.

The API returns only the public approved projection. No report packet or card image is frozen into the marketing assets. Original images are verified against their approved SHA-256. Card faces use the exact original-photo crop, so saved masks and centering remain registered; illustrative scene lighting never replaces the untouched inspection photo. Masks and fingerprints derive from the current report’s saved traces. A side without recorded defects says so. Unqualified card profiles retain original-photo inspection rather than invented dimensions.

`files.json` is the complete marketing asset allowlist. Build with `node frontend/atlas-public/scripts/build-homepage.mjs`. The packager binds all source assets and its recipe to one content digest, rejects retired report paths and local filesystem paths, and writes the active package plus `frontend/atlas-public/public/homepage/release.json`. Keep source and generated package in the same commit. The packager removes only superseded generated digest directories after completing the replacement.

The prior Maye physical-card sample and its derivatives remain retired. The Alakazam reference and authored sample label belong to the explicitly illustrative first-look concept; their fictional measurements are not observations of a graded physical card. VEX is fictional artwork and its story labels the card and record accordingly. The NFC GLB is generic tag anatomy with no embedded card image. No unused older NFC scene or montage is restored.

Capacity reads only `/api/capacity`, displays verified aggregate card counts, and clears unavailable or stale values. Checkout remains authoritative. The account workflow stays in `frontend/atlas-customer`; live reports use `packages/atlas-manual-workspace`. Building this source does not itself deploy the site, publish/regrade cards, or write NFC tags.
