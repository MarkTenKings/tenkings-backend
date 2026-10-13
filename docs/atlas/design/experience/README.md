# ATLAS experience source

This directory is the portable source of the ATLAS marketing experience. It contains the brand introduction, report and fingerprint explanations, conceptual NFC anatomy, fictional VEX story, submission routes, and weekly capacity. No historical physical card, approved report packet, saved finding, card fingerprint, or archived report screenshot is packaged.

The owner directed all prior ATLAS card remnants to be retired on October 12, superseding the earlier archived-sample exception. The Maye sample and its photographic/presentation/mask/fingerprint derivatives were removed. The existing brand and service layout remain; a real report showcase can be added only when a new owner-approved example exists. No replacement grade or finding was invented.

`files.json` is the complete marketing asset allowlist. Build with `node frontend/atlas-public/scripts/build-homepage.mjs`. The packager binds all source assets and its recipe to one content digest, rejects retired report paths and local filesystem paths, and writes the active package plus `frontend/atlas-public/public/homepage/release.json`. Keep source and generated package in the same commit; retire superseded generated directories so old card URLs are no longer served.

The Alakazam reference and authored sample label originate from the explicitly illustrative first-look concept; their fictional measurements are not observations of a physical graded card. VEX is fictional artwork and its story identifies the card and record as fictional. The NFC GLB contains generic geometry and no embedded images or textures; its poster illustrates tag anatomy, not a card or verified manufacturing specification. The actual archived report screenshot and its loader were removed.

Capacity reads only `/api/capacity`, displays verified aggregate card counts, and clears unavailable or stale values. Checkout remains authoritative. The account workflow remains in `frontend/atlas-customer`; current live report rendering remains in `packages/atlas-manual-workspace`. This source change does not itself deploy the site or publish any report.
