# AI-Grader V2 iPhone Capture

## Result

The iPhone stays on its mount and uses the native Camera app. The Shortcut sends the newest two photos directly to the existing Speedster original-image keys. The grading page polls only while its photo step is open.

## One-time Shortcut

Create and share one iPhone Shortcut named exactly `Ten Kings Speedster Capture`:

1. If **Shortcut Input** has text, save that text to `Shortcuts/ten-kings-speedster-device.txt` with overwrite enabled, show `Speedster paired`, and stop.
2. Otherwise read `Shortcuts/ten-kings-speedster-device.txt` as `deviceId`.
3. Find the two latest photos, sorted newest first. The newest is **Back**; the second-newest is **Front**.
4. Convert both images to JPEG.
5. POST JSON to `https://collect.tenkings.co/api/ai-grader-v2/iphone-capture`:

   ```json
   { "action": "PLAN", "deviceId": "<saved deviceId>" }
   ```

6. PUT the Front JPEG to `front.uploadUrl` and the Back JPEG to `back.uploadUrl`. Set `Content-Type: image/jpeg` on both requests.
7. POST JSON to the same endpoint:

   ```json
   {
     "action": "COMPLETE",
     "deviceId": "<saved deviceId>",
     "uploadVersion": <PLAN uploadVersion>
   }
   ```

8. Show `Speedster photos ready`.

Share the Shortcut through its iCloud share link and install that single shared copy on each capture iPhone.

## Pair once

1. Open a Speedster draft on the Mac.
2. Scan its **Pair iPhone once** QR code after installing the Shortcut.
3. The QR runs the installed Shortcut with this grader's permanent capture-device ID and saves it on the iPhone.

## Capture each card

1. Take the Front photo in the native Camera app.
2. Flip the card and take the Back photo.
3. Run `Ten Kings Speedster Capture`.
4. Both images appear together on the open Speedster photo screen. Use **Swap front / back** only when their order is reversed.

Running the Shortcut again overwrites only that grader's current draft photos and increments its capture version. Leaving the photo step stops browser polling immediately.
