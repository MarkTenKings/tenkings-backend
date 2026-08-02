# AI-Grader V2 iPhone Capture

## Result

The mounted iPhone uses the native Camera app. One Shortcut sends the newest Front and Back photos to one tiny Cloudflare Worker. The Worker reuses the existing Speedster PLAN, direct Spaces uploads, and COMPLETE contract. It stores no state or secrets.

## Worker

Source: `workers/speedster-iphone-capture/src/index.mjs`

```bash
node --test workers/speedster-iphone-capture/test/index.test.mjs
npx wrangler login
npx wrangler deploy --config workers/speedster-iphone-capture/wrangler.toml
```

Use Cloudflare Workers Paid so native multipart parsing is not constrained by the Free plan CPU allowance. No Worker secret, storage binding, queue, retry system, custom domain, or streaming parser is needed.

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

Only after one real Front/Back pair arrives successfully through the Worker:

1. Delete the old iPhone Shortcut and its saved pairing file.
2. Remove the nested `front` and `back` compatibility objects from the PLAN response; keep only `uploadVersion`, `contentType`, `frontUploadUrl`, and `backUploadUrl`.
3. Remove the old QR pairing UI and replace its one-time setup role with the smallest copy-device-ID control needed for additional admin graders.

Keep the existing PLAN/COMPLETE endpoint, capture-device row, stable Spaces keys, admin polling, and shared geometry/grading path. Those are the working core, not baggage.
