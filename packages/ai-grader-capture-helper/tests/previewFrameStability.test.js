const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const {
  buildPreviewFrameStabilityFingerprint,
  comparePreviewFrameStability,
} = require("../dist/drivers/previewFrameStability");

async function testFrame(left) {
  return sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 170, g: 170, b: 170 },
    },
  })
    .composite([{
      input: {
        create: {
          width: 240,
          height: 340,
          channels: 3,
          background: { r: 35, g: 35, b: 35 },
        },
      },
      left,
      top: 70,
    }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

test("tiny stability fingerprint distinguishes a stopped card from meaningful movement", async () => {
  const stationary = await testFrame(200);
  const moved = await testFrame(230);
  const first = await buildPreviewFrameStabilityFingerprint(stationary);
  const second = await buildPreviewFrameStabilityFingerprint(stationary);
  const shifted = await buildPreviewFrameStabilityFingerprint(moved);

  const stopped = comparePreviewFrameStability(first, second);
  const moving = comparePreviewFrameStability(second, shifted);

  assert.equal(stopped.stable, true);
  assert.equal(stopped.meanAbsoluteDelta, 0);
  assert.equal(stopped.changedPixelFraction, 0);
  assert.equal(moving.stable, false);
  assert.ok(moving.meanAbsoluteDelta > stopped.meanAbsoluteDelta);
  assert.ok(moving.changedPixelFraction > stopped.changedPixelFraction);
});

test("tiny stability fingerprint ignores bounded whole-frame lighting variation", async () => {
  const stationary = await testFrame(200);
  const lightingShifted = await sharp(stationary)
    .linear(1.02, 2)
    .jpeg({ quality: 90 })
    .toBuffer();
  const moved = await testFrame(230);
  const movedLightingShifted = await sharp(moved)
    .linear(1.02, 2)
    .jpeg({ quality: 90 })
    .toBuffer();

  const first = await buildPreviewFrameStabilityFingerprint(stationary);
  const relit = await buildPreviewFrameStabilityFingerprint(lightingShifted);
  const shifted = await buildPreviewFrameStabilityFingerprint(movedLightingShifted);

  assert.equal(comparePreviewFrameStability(first, relit).stable, true);
  assert.equal(comparePreviewFrameStability(first, shifted).stable, false);
});
