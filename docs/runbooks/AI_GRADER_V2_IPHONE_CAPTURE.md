# AI-Grader V2 iPhone Capture

## Result

The mounted iPhone uses the native Camera app. One Shortcut sends the newest Front and Back photos to one tiny Cloudflare Worker. The Worker computes each exact file's SHA-256 and byte size, submits that manifest to Speedster PLAN, performs the two private checksum-bound Spaces PUTs, and submits the unchanged manifest to COMPLETE. COMPLETE verifies both stored objects before publishing readiness. The Worker stores no state or secrets.

## Worker

Source: `workers/speedster-iphone-capture/src/index.mjs`

```bash
node --test workers/speedster-iphone-capture/test/index.test.mjs
npx wrangler login
npx wrangler deploy --config workers/speedster-iphone-capture/wrangler.toml
```

Use Cloudflare Workers Paid so native multipart parsing is not constrained by the Free plan CPU allowance. No Worker secret, storage binding, queue, retry system, custom domain, or streaming parser is needed.

The Vercel API migration and Worker source are one protocol release. Apply `20260818191500_speedster_iphone_capture_integrity_manifest` before serving the new API, then deploy the exact reviewed Worker immediately with the matching web release. Do not deploy either half against the old counterpart. The API must return exact `frontUploadHeaders` and `backUploadHeaders` containing `Content-Type`, `x-amz-acl: private`, and `x-amz-checksum-sha256`; the Worker must send those headers unchanged.

## One-time Shortcut

Create one Shortcut named `Ten Kings Speedster Capture` in this exact order:

1. **Text** — this admin grader's permanent Speedster capture-device ID.
2. **Find Photos** — Date Taken, Latest First, limit 2, `Is a Screenshot = No`.
3. **Get Item from List** — Item at Index 2. This is Front, photographed first.
4. **Convert Image** — JPEG, maximum quality.
5. **Set Variable** — `Front JPEG`.
6. **Get Item from List** — First Item from the photos found in step 2. This is Back, photographed last.
7. **Convert Image** — JPEG, maximum quality.
8. **Set Variable** — `Back JPEG`.
9. **Get Contents of URL** — POST to the deployed Worker URL with a Form body:
   - `deviceId`: Text field using step 1.
   - `front`: File field using `Front JPEG`.
   - `back`: File field using `Back JPEG`.
10. **Show Notification** — `Speedster: ` followed by Contents of URL from step 9.

For the already-paired iPhone, copy the one-line ID from `iCloud Drive/Shortcuts/ten-kings-speedster-device.txt` into step 1. Once the new Shortcut passes a real-photo test, that file and the old Shortcut are obsolete.

## Capture each card

1. Photograph Front with the native Camera app.
2. Flip the card and photograph Back.
3. Run `Ten Kings Speedster Capture`.
4. Both photos appear together on the open Speedster photo screen. Use **Swap front / back** only when their order is reversed.

Running the Shortcut again replaces only that grader's current draft photos. The page polls only while the photo step is open.

## Acceptance cleanup

A real Front/Back pair and one complete Production grading flow passed on 2026-08-02 under the historical flat contract. As of the 2026-08-18 hardening release, PLAN and COMPLETE both require exact nested `front` and `back` manifest objects with `byteSize` and lowercase `checksumSha256`. PLAN returns `uploadVersion`, both upload URLs, and the exact required per-side headers; COMPLETE publishes `readyVersion` only after both objects match the stored plan.

The remaining device-local cleanup can happen independently when the operator confirms those setup aids are no longer needed:

1. Delete the old iPhone Shortcut and its saved pairing file.
2. Remove the old QR pairing UI and replace its one-time setup role with the smallest copy-device-ID control needed for additional admin graders.

Keep the existing PLAN/COMPLETE endpoint, capture-device row, admin polling, and shared geometry/grading path. New Spaces keys are upload-versioned and content-addressed; never restore mutable stable keys or HEAD-only readiness checks.
