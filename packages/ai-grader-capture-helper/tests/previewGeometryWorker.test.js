const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const {
  runPreviewGeometryWorkerAnalysis,
} = require("../dist/drivers/previewGeometryWorker");

test("preview geometry worker returns an exact-frame-bound detector result", async () => {
  const imageBuffer = await sharp({
    create: {
      width: 640,
      height: 896,
      channels: 3,
      background: { r: 185, g: 185, b: 185 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const timestamp = "2026-07-27T04:00:00.000Z";
  const geometry = await runPreviewGeometryWorkerAnalysis({
    imageBuffer,
    fileName: "preview-frame.jpg",
    detectionPolicy: "live_preview_fast",
    side: "front",
    sourceImageId: "preview-front",
    sourceFrameId: "worker-frame-1",
    timestamp,
  });

  assert.equal(geometry.side, "front");
  assert.equal(geometry.sourceFrameId, "worker-frame-1");
  assert.equal(geometry.timestamp, timestamp);
  assert.equal(geometry.detectionPolicy, "live_preview_fast");
  assert.ok(["not_detected", "adjust_card", "ready"].includes(geometry.placementState));
});

test("authoritative preview detection does not block the bridge event loop", async () => {
  const imageBuffer = await sharp({
    create: {
      width: 1200,
      height: 1680,
      channels: 3,
      background: { r: 185, g: 185, b: 185 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks += 1;
  }, 5);
  try {
    await runPreviewGeometryWorkerAnalysis({
      imageBuffer,
      fileName: "preview-frame.jpg",
      detectionPolicy: "live_preview_fast",
      side: "back",
      sourceImageId: "preview-back",
      sourceFrameId: "worker-frame-event-loop",
      timestamp: "2026-07-27T04:00:01.000Z",
    });
  } finally {
    clearInterval(ticker);
  }
  assert.ok(ticks >= 3, `expected bridge event-loop progress, observed ${ticks} ticks`);
});
