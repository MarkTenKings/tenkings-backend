# Photo-informed label styling

Status: implemented and qualified locally on six retained approval/photo fixtures. Production deployment and live qualification remain pending the coordinated technical release checks; the owner has authorized integration and production testing. This document describes the implemented contract, not a promise of exact font identification or exclusive rights in generated lettering.

## Source and identity contract

A claimed label job loads its approved public packet and private approved-media manifest. It verifies the front/back image hashes, byte counts and decoded dimensions before analysis. The request binds those photos, the full approved identity, approval action/version/public/report hashes, the renderer’s exact display rows and the packaged font catalog hashes. Identity and grade remain approved facts; a model cannot alter them.

The model receives exact text plus bounded styleable and protected offsets. Serial fractions remain protected. Product text such as Black Diamond may be styled in place; it is not moved into a different factual field. A deterministic display rule can omit the trailing word Refractor when a specific multiword parallel remains, such as Blue Mini Diamond. The canonical identity retains the full parallel; bare Refractor remains visible. Existing label copies retain their original artwork, snapshot and fractional grade. Newly rendered labels accept whole-number final grades only.

## General inference and deterministic rendering

`label-style-provider.mjs` asks Astra to inspect both approved photos and select visual features for the supplied rows. Unknown cards follow the same process; there is no card-name or certificate switch for choosing a style. The bounded response selects one catalog face per row, hexadecimal colors, exact paint offsets, emphasis, optical scaling and NONE/DIAMOND/SHIMMER/STRIPES patterns. Every observed feature cites a normalized region of a supplied image and its hash. The compiler validates the response before rendering.

A distinctive complete variant caption may request ORIGINAL_WORDMARK with finite generic morphology traits. Protected serials and partially styleable rows cannot use this path. Other rows use packaged fonts and optional photo-derived material textures. Original generation receives the literal caption and generic traits, not a named font or a request to copy a logo. A separate blind vision request transcribes the returned image without receiving the expected phrase. Local checks require exact spelling, order, punctuation, confidence, word boxes and pixel coverage before producing a mask. Each word can be scaled uniformly to equal visible ink height while preserving its own proportions. There is no catalog substitution presented as successful original generation.

Raster policy `atlas-label-wordmark-near-monochrome-v1` admits only tightly bounded near-gray sampling noise: channel spread at most 16, no more than 0.1% of pixels above spread 8, and average spread at most 2. Opaque white margins, meaningful dark ink, fixed dimensions and image hashes remain required. Grayscale conversion and a near-white background threshold are recorded in artifact provenance; the provider’s raw bytes remain intact.

Texture policy `atlas-label-source-texture-v2` crops only validated card-field or card-border regions into bounded tiles. It records the original photo/crop and untouched tile hash. Neutral-base shimmer retains 12% source chroma and mixes 12% white for a silver reading. Very dark diamond fills receive at most 1.2× channel gain; brighter diamonds and stripes retain their source colors. These deterministic adjustments use pattern, color and measured pixels, never card identity, grade or category. Processing parameters and output hashes remain explicit.

Grades 1–9 share the same black-field contrast policy for Sports and Pokémon. Exact 10 uses black primary text on the category’s gold/holographic material, with dark edges preserving colored style accents. The physical renderer fits the text and enforces geometry independently of model choices.

## Reviewed feedback and provenance

A small trusted preference file preserves specifically reviewed examples. Each record matches both exact photo hashes, row role and exact caption; it includes proof/source-label hashes and the reviewed changes. It is not a general card-name preset. Applying a record produces a separate effective spec with REVIEWED_STYLE_FEEDBACK provenance, the base model-spec hash and matched preference hashes. Validation recomputes that projection against the trusted records. Raw observations and model specs remain unchanged. Unknown or changed photos/captions do not inherit those preferences.

Packaged faces carry pinned font hashes and license receipts. Their use is an approximation, not a measured font match. Generated artifacts retain model, request, image, verification, normalization and mask hashes; provenance explicitly declines exact source-font reproduction, match-percentage and ownership claims. No proprietary font binary is embedded or claimed.

## Reservations, reuse and latency

Each paid stage has its own durable request → permanent reservation → raw response → validated result journal. The private S3 adapter uses conditional create-if-absent under `keyPrefix/label-styles`. Only the worker that observes a successful reservation creation may dispatch. Repeated jobs replay the retained raw responses, revalidate the result and reuse the artwork without another paid call. No schema migration is needed for this cache.

Style analysis normally needs one Responses request. A caption requiring original lettering adds one image generation and one independent Responses verification. Each provider call has a five-minute deadline and no HTTP retry. The label style operation has an 18-minute deadline inside a 20-minute job lease. Pending jobs defer without consuming render attempts; a stale reservation does not authorize another request. The wordmark resolver reports an unknown outcome after 330 seconds, and later retained raw evidence may still reconcile it. Cold runs can take several minutes; cached runs avoid model latency.

Malformed or unsupported style observations produce an explicitly marked deterministic fallback. An unavailable or unverified required original wordmark does not silently become a successful catalog rendering. Transport uncertainty or missing paid responses never authorize automatic redispatch. The external six-card qualification’s single replacement attempt after a definite missing-scope 401 used a separate explicit permit and journal; that mechanism is not exposed as a production operator API.

## Private configuration and release checks

`ATLAS_LABEL_PHOTO_STYLE_ENABLED=true` enables the path only where label storage/jobs are available. With the flag absent the credential path stays cold. `ATLAS_MANUAL_OPENAI_KEY` supplies style analysis and blind verification; `ATLAS_LABEL_WORDMARK_OPENAI_KEY` supplies only image generation. Enabled runtime configuration requires both. Generation never falls back to the manual key, and the dedicated image key belongs only to the private main runtime, not the variant worker or public browser.

Source approval is rechecked after style work before committing label artwork. Serving pages and historical copies cannot initiate model calls. Release qualification must retain raw provider evidence, source/proposal separation, reviewed-preference receipts, deterministic texture receipts, original spelling verification, whole-grade/physical-fit checks and the actual renderer profile. Local preview serials or CASE HIT proposals are not production identity updates.

Automatic label discovery, layout recovery, render claims and export claims honor the existing release admission locks inside their transactions. A held release admits no new label work; completion stays available so already admitted work can drain before the held baseline is captured. Generated-letter outlines use their actual fitted scale to preserve the requested physical edge thickness, including nonnormalized and width-constrained assets. Historical renderer profiles remain recognized for immutable COPY exports.
