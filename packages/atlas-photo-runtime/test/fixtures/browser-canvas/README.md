# Browser canvas regression images

These synthetic images were generated locally with Playwright WebKit 26.5
(`manifest.json` records the exact engine user agent, context and byte hashes).
They contain a 48 × 64 three-stop Display-P3 gradient, with no external image.
Both browser-produced PNGs have RGBA color type 6, including the opaque context.
This reproduces Safari's encoding behavior independently of mocked canvas APIs.

Generation in a fresh WebKit page:

```js
const canvas = document.createElement('canvas');
canvas.width = 48; canvas.height = 64;
const context = canvas.getContext('2d', {
  colorSpace: 'display-p3', alpha: translucent,
});
const gradient = context.createLinearGradient(0, 0, 48, 64);
gradient.addColorStop(0, 'color(display-p3 0.85 0.12 0.05)');
gradient.addColorStop(.5, 'color(display-p3 0.04 0.8 0.2)');
gradient.addColorStop(1, 'color(display-p3 0.1 0.08 0.9)');
context.fillStyle = gradient;
context.fillRect(0, 0, 48, 64);
if (translucent) {
  context.clearRect(47, 63, 1, 1);
  context.fillStyle = 'rgba(150,200,250,0.5)';
  context.fillRect(47, 63, 1, 1);
}
const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
```

`opaque-p3.png` uses `translucent = false`. The second fixture uses `true` and
puts its only non-opaque pixel at the last corner so a partial opacity check
would incorrectly pass. Neither fixture is a real card or physical-iPhone test.
