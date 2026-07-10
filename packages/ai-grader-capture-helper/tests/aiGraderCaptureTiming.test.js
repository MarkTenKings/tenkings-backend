import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneAiGraderCaptureTiming,
  createAiGraderCaptureTimingMetadata,
  recordAiGraderCaptureTimingEvent,
  recordAiGraderCaptureTimingPhase,
} from "../dist/drivers/aiGraderCaptureTiming.js";

function addEvent(timing, id, atMs, side, triggerMode) {
  recordAiGraderCaptureTimingEvent(timing, {
    id,
    at: new Date(Date.UTC(2026, 6, 9, 12, 0, 0, atMs)).toISOString(),
    side,
    triggerMode,
  });
}

test("capture timing calculates both side totals, flip overlap, report, and total card wall time", () => {
  const timing = createAiGraderCaptureTimingMetadata({
    captureProfile: "production_fast",
    startedAt: "2026-07-09T12:00:00.000Z",
  });
  addEvent(timing, "preview_stream_started", 100);
  addEvent(timing, "preview_ready", 300);
  addEvent(timing, "edge_detection_ready", 500, "front");
  addEvent(timing, "capture_trigger", 1000, "front", "operator");
  addEvent(timing, "raw_capture_completed", 5600, "front");
  addEvent(timing, "side_processing_started", 5600, "front");
  addEvent(timing, "back_positioning_started", 5600, "back");
  addEvent(timing, "edge_detection_ready", 6000, "back");
  addEvent(timing, "capture_trigger", 7000, "back", "auto");
  addEvent(timing, "side_processing_completed", 6500, "front");
  addEvent(timing, "raw_capture_completed", 11800, "back");
  addEvent(timing, "safely_queued", 12000);
  addEvent(timing, "side_processing_started", 11800, "back");
  addEvent(timing, "side_processing_completed", 13800, "back");
  addEvent(timing, "report_generation_started", 13800);
  addEvent(timing, "report_ready", 16800);
  recordAiGraderCaptureTimingPhase(timing, { id: "file_writes", side: "front", durationMs: 2700.24 });
  recordAiGraderCaptureTimingPhase(timing, { id: "crop_deskew", side: "front", durationMs: 88.81 });

  const snapshot = cloneAiGraderCaptureTiming(timing);
  assert.equal(snapshot.captureProfile, "production_fast");
  assert.equal(snapshot.summary.previewReadyMs, 200);
  assert.equal(snapshot.summary.totalFrontMs, 4600);
  assert.equal(snapshot.summary.totalBackMs, 4800);
  assert.equal(snapshot.summary.frontProcessingDuringFlipMs, 900);
  assert.equal(snapshot.summary.frontProcessingOverlappedFlip, true);
  assert.equal(snapshot.summary.reportGenerationMs, 3000);
  assert.equal(snapshot.summary.totalCardMs, 11000);
  assert.equal(snapshot.summary.reportReadyTotalMs, 15800);
  assert.equal(snapshot.summary.safeQueueLatencyMs, 200);
  assert.equal(snapshot.target.frontWithinTarget, true);
  assert.equal(snapshot.target.backWithinTarget, true);
  assert.equal(snapshot.target.fiveSecondsPerSideProven, false);
  assert.equal(snapshot.target.hardwareMeasurementRequired, true);
  assert.equal(snapshot.phases.find((phase) => phase.id === "file_writes")?.durationMs, 2700.2);
});

test("five-second proof requires a real hardware measurement and both measured sides", () => {
  const timing = createAiGraderCaptureTimingMetadata({
    captureProfile: "production_fast",
    hardwareMeasurement: true,
    startedAt: "2026-07-09T12:00:00.000Z",
  });
  addEvent(timing, "capture_trigger", 0, "front", "operator");
  addEvent(timing, "raw_capture_completed", 4900, "front");
  assert.equal(timing.target.fiveSecondsPerSideProven, false);
  addEvent(timing, "capture_trigger", 5000, "back", "operator");
  addEvent(timing, "raw_capture_completed", 10100, "back");
  assert.equal(timing.target.frontWithinTarget, true);
  assert.equal(timing.target.backWithinTarget, false);
  assert.equal(timing.target.fiveSecondsPerSideProven, false);
  assert.match(timing.target.note, /did not prove/i);
});

test("timing metadata is path-free and does not accept arbitrary detail payloads", () => {
  const timing = createAiGraderCaptureTimingMetadata({ startedAt: "2026-07-09T12:00:00.000Z" });
  addEvent(timing, "preview_ready", 10);
  const serialized = JSON.stringify(timing);
  assert.doesNotMatch(serialized, /C:\\\\|localhost|stationToken|x-amz|data:image/i);
  assert.deepEqual(Object.keys(timing.events[1]).sort(), ["at", "id"]);
});
