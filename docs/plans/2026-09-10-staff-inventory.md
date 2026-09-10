# Staff inventory — September 10, 2026

Mark explicitly requests immediate implementation and activation of a simple, premium staff inventory system: obvious current/new stock entry, batch and individual cards, names/categories/photos, acquisition cost, expected selling price/profit/margin, location management, and automatic Financial Story updates. This written continuation authorizes the necessary inventory product/model work. Existing grading, customer commerce, vendor hardware, unrelated ATLAS deployment and financial confirmations remain outside this task.

## Product

Replace the default technical journal workspace with a focused Inventory home: warm neutral surfaces, black typography, Ten Kings gold, generous spacing, a persistent Add inventory action, search and location/category filters. Empty state explains the first action. A short form asks whether stock is already owned or newly received, batch/single card, name, category, quantity, photo, actual location, acquisition cost and expected selling price. Dates use local controls converted to exact UTC; IDs, roster creation and evidence envelopes are server-owned. A total batch cost explicitly chooses equal per-card allocation; unknown stays unknown. Expected gross profit excludes other business expenses and never becomes actual revenue.

One reusable item drawer supports names/photos/prices, individual roster details, partial selection, actual moves, planned destination and stock processing. Technical event history remains expandable. Existing exact-card and advanced batch evidence controls remain accessible without occupying the default screen. Stock at stores/kiosks is included in operational holdings; no machine identity or sale is fabricated.

## Persistence and integration

Use the existing append-only InventoryWorkflowEventV2 journal and cardPlatformV2.ts sole writer. Add a strict item-described event containing selected receipt-unit IDs and a bounded descriptive snapshot (name/category/notes/photo storage key); it neither changes grade identity nor quantity/cost/custody. Mirror the same event in the financial consumer before source activation. No new counter or inventory table. New simple commands compose existing receipt/opening, explicit cost assignment, price and descriptive events atomically, preserving exact request identity on retry. Update/edit uses current server stock and normal causal validation. Reuse existing authentication, locations and private storage. Inventory-specific staff access must not grant financial access or general administrator authority; do not invent staff membership or HQ address.

The local financial service continuously pulls the two pinned first-party journals with bounded, serialized requests and visible freshness/failure state. Reads refresh inventory/Story when imported source state changes. All financial persistence stays in ledger-core/write.ts. Staff source evidence can report provisional inventory cost and expected proceeds; confirmed ledger cash, manual financial attributions, coverage proofs and immutable closes remain authoritative. Expected sale prices cannot fill missing actual sales.

## Acceptance and release

Test empty-to-first-item, single and bulk cost conservation, unknown/zero cost and price, metadata persistence, individual editing, partial moves, invalid/stale selections, atomic failure/retry, photo validation, employee/anonymous permissions, financial source compatibility and automatic refresh on isolated databases. Visually inspect desktop and phone layouts and keyboard/focus/error recovery. Run the normal build and applicable tests. Self-review against the principles and model before each commit; record verdict. Coordinate source publication with the current legacy main deployment hold and preserve ATLAS. Activate the compatible financial consumer first, then the verified source UI; no fake real inventory or financial record is entered. Record observed release state and remaining user-supplied setup honestly.

## Owner setup facts

Mark provided the HQ name **Ten Kings HQ** and a private address for activation. He explicitly directs reusing existing Ten Kings mobile sign-in and the current Vercel admin-phone allowlist. No separate inventory role or new auth system is needed. Configure that exact HQ through the existing Location path; do not infer any other location or staff identity. New received purchases may enter actual HQ/store/kiosk custody, with the same existing Location requirement and immutable evidence.

## Scoped live release

Read-only Vercel evidence confirms collect.tenkings.co still serves bf70940849ea9746969d70a25c733c5370d23211. Build and release only the staff inventory changes on that accepted legacy source. Preserve the current main:false Git deployment hold. Submit this additive inventory branch for the normal main PR checks; a manual production artifact from the reviewed inventory branch must keep the currently serving grading protocol. No ATLAS/CPU/worker cutover, provider settings, migrations, keys, or unrelated app release is included.

## API and privacy verification

Reuse the mobile admin session and deny financial bearer/operator credentials before all inventory and location writes. Keep HQ private across public lists, detail, Kings Hunt, location-photo and live-status lookups; check visibility before geocoding, vendor calls or cached reads, and refuse edits that would publish an internal location. Exercise concurrent exact location retries through the existing Location primary-key constraint, with changed requests and slug collisions rejected. Decode and strip uploaded photo metadata, explicitly write private storage, and verify the exact stored key, MIME type, bounded size and native/server-stream SHA-256 before returning or recording a photo. All affected HTTP responses remain no-store. Validation uses mocks or disposable fixtures only; this API assignment creates no real rows and performs no release operation.
