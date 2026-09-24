# Customer commerce configuration

These [private service](config/private-service.env.example), [customer web](config/customer-web.env.example) and [public web](config/public-web.env.example) and [staff web](config/staff-web.env.example) files are cold templates. They contain no credential values. The private file is separate from the existing manual service environment; the web templates supplement existing customer authentication and public report settings.

Populate a copy only in protected secret custody. Do not commit populated files or send credentials in chat. The server receives Stripe, FedEx and receipt-provider credentials; the customer web app receives only its own signed transport key and upload origin, and the public web app receives only its directory key. Keep every activation flag false until deployment controls and real providers are qualified.

Run the static checker with Node20 or newer using a protected environment file:

```sh
node --env-file=/absolute/protected/private-service.env packages/atlas-commerce/scripts/check-configuration.mjs
```

The checker makes no network request and prints only fixed status labels and missing/invalid key names. `COLD` means dispatch is disabled; missing keys are expected. `INCOMPLETE` means enabled settings cannot qualify. `READY_FOR_PROVIDER_QUALIFICATION` means the full mail-and-kiosk configuration passes local shape and mode checks only. It does not authenticate accounts, validate tax registration or classifications, confirm receipt-sender approval, measure a package, verify the database binding, or qualify a kiosk. Missing webhook configuration is reported even though provider construction alone permits a cold webhook.

The mail clock start and charged shipping legs remain unset until the owner selects them. Tax codes, sender identities, merchant IDs, measured package plans, kiosk addresses/routes and device IDs must come from real account and operational information. Test mode cannot be mixed with production FedEx. Existing SMS verification credentials do not imply an approved receipt messaging service.

Each private `CommerceControl.shippingPlans` entry now uses `version: "atlas-measured-shipping-plan-v1"` and must contain a `packingPresetId`, `shippingServiceCode`, an exact integer `cardCount` from1–100, and a nonempty sourced `measurementReference`. The measurement reference attests to the configured plan; the application does not independently verify a physical measurement. Measure and configure each supported count and each charged direction independently. A larger count never inherits a smaller package's weight. Duplicate preset/service/count choices are refused.

`validFrom` and `validUntil` are explicit canonical UTC timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`) permitting new quotes for at most24 hours. These are configuration admission limits, not carrier-rate validity or customer turnaround promises. The rate provider and saved quote keep their own expiry, and a quote cannot outlive the plan. Expired or mismatched plans disappear from customer options and are refused by both service and SQL. No environment-file checker alone qualifies these database records.

Each required `legs.INBOUND` / `legs.RETURN` carries a `shipDateTimeZone` with a qualified IANA origin timezone and the exact FedEx `requestedShipment`. That request contains a real calendar `shipDatestamp` which has not passed in that timezone, the selected matching `serviceType`, configured pickup/packaging/billing, and exactly one package with positive measured weight and positive integer dimensions with their units. Supply the actual ATLAS recipient for inbound and actual ATLAS shipper for return; omit the unknown customer party, which is derived only from the confirmed checkout profile. Neither a future return date nor a mailing destination is invented. Actual FedEx service/date acceptance is still required.

The complete selected plan and final customer-bound carrier requests stay in the immutable internal quote; customer responses expose only the existing option/display fields. SQL rejects a changed plan, count, measurement, weight, date, service or customer party even if a caller recomputes its content hashes. Label creation checks the original date again before claiming a pending effect. A date that has passed leaves that effect pending with `SHIPPING_DATE_EXPIRED` for operational resolution; it never silently changes a paid shipment, creates another effect or repeats an uncertain provider call.

Follow the source-bound deployment, least-privilege database and real-provider checks in [customer release readiness](../../docs/atlas/audits/2026-09-24/customer-release-readiness.md). Credentials alone never enable paid checkout: the exact immutable merchant binding, deployment-bound customer controls and measured shipping plans must also match.

The staff web display switch must be explicitly enabled alongside the separately qualified private dealer service and schema. While false, Customer operations is hidden and its page returns the existing unavailable view; it cannot grant authority or activate the backend. This permits a staff-only release while retaining the existing customer application until the complete new funnel is ready.

The public web switch `ATLAS_PUBLIC_CUSTOMER_FUNNEL_ENABLED=false` preserves the previous service text and contact directory and makes no private kiosk-directory request. Enable the new price/checkout marketing and kiosk directory only after the new customer deployment is promoted and the complete flow is qualified. This display flag never enables private provider dispatch.
