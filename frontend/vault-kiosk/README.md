# Ten Kings Vault kiosk

Owner update, 2026-09-07: Vault is a configurable machine family, currently targeting
up to 125 doors and an approximately 72-door concept, with one SER mini-PC and an
OS-free ViewSonic touchscreen per machine. The exact physical layout, dimensions,
controller mapping and display model/orientation/resolution remain qualification
inputs. The supplied 72- and 125-door simulator profiles are explicitly synthetic.

This React application is the local presentation client for the independent Vault
machine service. The product authority is
[`docs/vault-v1/authority`](../../docs/vault-v1/authority/README.md); current implementation
and production gaps are tracked in the Vault review traceability and handoff documents.

The kiosk has no hardware, payment-provider, cloud-credential, or database authority.
Its built static files are served by `vault-machine` on the same loopback origin as
the local API. Configure that service's `VAULT_KIOSK_STATIC_ROOT` to this package's
`dist` directory. Local API mutation requests carry the contract version, protected
browser session, and current durable state version. Lost responses reload machine
state; payment and retry intents are never blindly recreated or replayed.

Version 2 configuration supplies ordered stable door IDs, separate printed labels,
mixed-size display rectangles and reserved control/display cutouts. Filtering and
selection preserve these positions. The map scrolls within its frame when needed to
preserve touch targets of at least 44 CSS pixels. Historical version 1 configuration
alone uses the X K I N G S / 01–25 map; missing or unknown profile data blocks shopping
visibly. Display geometry never supplies a controller mapping. Paid receipts,
restocking and certification retain the labels and profile belonging to their
original durable work.

Staff work uses individual PIN grants, durable restock/certification commands,
explicit observations and a safe-exit checklist. Filling a compartment requires an
operator's confirmation that the actual packaged product fits and the door closes
safely. The existing service workflow can activate an exact pending profile only
after separate empty-machine and closed-door confirmations plus machine-service
validation. Mock adapters always show TEST MODE. Simulated purchase and restock
certification cycles call the canonical local business workflows; they do not
establish physical fit, coverage or production revenue.

Customer support stays in the appliance shell. Email/text/call taps render a QR for
the customer's phone, and the configured support page receives only an opaque short
reference and reported door IDs. The hosted `/vault/support/[machineId]` route exposes
only the published contact projection; it neither looks up a sale nor treats a URL
reference as payment proof. Actual support destinations are deployment inputs.

## Disposable local simulator

From the repository root, with Node 20 and workspace dependencies installed:

```sh
pnpm vault:demo -- --doors 72
# Or exercise the current maximum cabinet concept:
pnpm vault:demo -- --doors 125
```

The command builds the Vault packages and prints its loopback browser URL. Tap the
top-left staff corner ten times within six seconds, then sign in as
`simulator-tech` with PIN `123456`. Restock a compartment, record the simulated fit
confirmation, finalize and complete safe exit before shopping. Payments, controller
responses, dimensions and cloud responses are mocks. State is stored in a disposable
temporary directory, removed when the simulator stops with Ctrl+C. These credentials
and profiles belong only to this local test session.

## Software validation

Use the repository-required Node 20 toolchain and installed workspace dependencies:

```sh
pnpm --filter @tenkings/vault-kiosk test
pnpm --filter @tenkings/vault-kiosk build
pnpm --filter @tenkings/vault-kiosk exec playwright install chromium
pnpm --filter @tenkings/vault-kiosk test:browser
```

The browser regression runs built assets against a disposable loopback fixture and
blocks all external requests. On macOS it uses the installed Chrome channel; Linux CI
uses the pinned Playwright Chromium build. It measures 720, 768, 864 and 1080 CSS-pixel
portrait layouts with device-scale proxies for historical 150-door and synthetic
mixed-size 7-, 72- and 125-door profiles, plus a maximum-length label stress case.
The 17 scenarios check minimum-size door targets, invariant geometry and cutouts,
stable IDs distinct from labels, visible checkout, contained scrolling, media
fallback, cart focus and modal focus containment. They also exercise uncertain-payment
support, a single paid retry and Done. Unit tests cover pinned historical identities,
lost checkout/retry responses, staff reauthentication, fit confirmation, observed-door
certification outcomes and exact pending-profile activation. Set
`VAULT_SCREENSHOT_DIR` to an explicit local evidence directory to retain screenshots.

These tests prove software rendering/flow behavior, not installed Windows touch,
physical scaling, reach, glare, enclosure, assigned-access, power-cut or hardware
acceptance. The final Windows runtime/native SQLite/service/credential package,
official payment/controller adapters, installation validation, migration/deployment,
physical certification and pilot remain separately required and unauthorized here.
