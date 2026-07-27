import assert from "node:assert/strict";
import test from "node:test";
import {
  aiGraderEyesCenteringSelectionRequestSha256,
  buildAiGraderEyesCenteringSelectionRequest,
  parseAiGraderEyesCenteringSelectionResponse,
  type AiGraderEyesCenteringCandidateOverlay,
} from "../lib/server/aiGraderEyesCenteringCandidateSelection";
import {
  AiGraderEyesError,
  type AiGraderEyesSourceImage,
} from "../lib/server/aiGraderEyesSemanticObserver";

const images: AiGraderEyesSourceImage[] = [
  {
    side: "front",
    url: "https://cdn.tenkings.test/front.png",
    checksumSha256: "a".repeat(64),
  },
  {
    side: "back",
    url: "https://cdn.tenkings.test/back.png",
    checksumSha256: "b".repeat(64),
  },
];

const edges = ["left", "right", "top", "bottom"] as const;
const candidates: AiGraderEyesCenteringCandidateOverlay[] = (
  ["front", "back"] as const
).flatMap((side, sideIndex) =>
  edges.map((edge, edgeIndex) => {
    const hex = ((sideIndex * edges.length + edgeIndex + 1) % 16)
      .toString(16);
    return {
      side,
      edge,
      candidateId: `${side}-${edge}-primary`,
      url: `https://cdn.tenkings.test/${side}-${edge}-primary.png`,
      checksumSha256: hex.repeat(64),
      deterministicInputSha256: ((Number.parseInt(hex, 16) + 8) % 16)
        .toString(16)
        .repeat(64),
    };
  }),
);
candidates.push({
  side: "front",
  edge: "left",
  candidateId: "front-left-secondary",
  url: "https://cdn.tenkings.test/front-left-secondary.png",
  checksumSha256: "e".repeat(64),
  deterministicInputSha256: "f".repeat(64),
});

function response(decisions: unknown) {
  return {
    status: "completed",
    model: "gpt-5.6-sol-2026-07-01",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({ decisions }),
      }],
    }],
  };
}

const validDecisions = (["front", "back"] as const).flatMap((side) =>
  edges.map((edge) => ({
    side,
    edge,
    decision: "select_candidate" as const,
    candidateId: `${side}-${edge}-primary`,
    confidence: 0.94,
    rationale: `The line follows the coherent ${edge} printed border.`,
  })),
);

test("candidate-selection request shows only exact hash-bound sources and overlays at original detail", () => {
  const request = buildAiGraderEyesCenteringSelectionRequest({
    model: "gpt-5.6-sol",
    images,
    candidates,
  }) as any;

  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "medium");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(
    request.text.format.schema.properties.decisions.items.additionalProperties,
    false,
  );

  const content = request.input[0].content;
  const imageInputs = content.filter((entry: any) => entry.type === "input_image");
  assert.equal(imageInputs.length, images.length + candidates.length);
  assert.equal(imageInputs.every((entry: any) => entry.detail === "original"), true);
  assert.deepEqual(
    imageInputs.map((entry: any) => entry.image_url),
    [
      images[0]!.url,
      candidates[0]!.url,
      candidates[8]!.url,
      candidates[1]!.url,
      candidates[2]!.url,
      candidates[3]!.url,
      images[1]!.url,
      candidates[4]!.url,
      candidates[5]!.url,
      candidates[6]!.url,
      candidates[7]!.url,
    ],
  );

  const instructions = content[0].text;
  assert.match(instructions, /only an exact supplied candidateId or null/);
  assert.match(instructions, /Never create coordinates/);
  assert.match(instructions, /Deterministic calibrated pixels remain the only metric authority/);
});

test("request receipt hash is stable when source and candidate input order changes", () => {
  const expected = aiGraderEyesCenteringSelectionRequestSha256({
    images,
    candidates,
  });
  const reordered = aiGraderEyesCenteringSelectionRequestSha256({
    images: [...images].reverse(),
    candidates: [...candidates].reverse(),
  });
  assert.equal(reordered, expected);
});

test("candidate-selection receipt grants no coordinate or measurement authority", () => {
  const receipt = parseAiGraderEyesCenteringSelectionResponse({
    payload: response(validDecisions),
    images,
    candidates,
    requestedModel: "gpt-5.6-sol",
    providerElapsedMs: 1_234.4,
  });

  assert.equal(receipt.decisions[0]!.candidateId, "front-left-primary");
  assert.equal(receipt.decisions[7]!.candidateId, "back-bottom-primary");
  assert.equal(receipt.metricAuthority, "deterministic_calibrated_pixels_only");
  assert.equal(receipt.coordinateAuthority, false);
  assert.equal(receipt.maximumRemeasurementPasses, 2);
  assert.equal(receipt.providerElapsedMs, 1_234);
  assert.equal(
    receipt.requestSha256,
    aiGraderEyesCenteringSelectionRequestSha256({ images, candidates }),
  );
});

test("candidate-selection rejects an invented candidate ID", () => {
  const invented = structuredClone(validDecisions);
  invented[0]!.candidateId = "front-left-invented";
  assert.throws(
    () => parseAiGraderEyesCenteringSelectionResponse({
      payload: response(invented),
      images,
      candidates,
      requestedModel: "gpt-5.6-sol",
      providerElapsedMs: 100,
    }),
    (error: unknown) =>
      error instanceof AiGraderEyesError && error.code === "malformed_response",
  );
});

test("candidate-selection rejects coordinates and other extra authority", () => {
  const withCoordinates = structuredClone(validDecisions) as Array<
    Record<string, unknown>
  >;
  withCoordinates[0]!.coordinates = { left: 12, right: 988 };
  assert.throws(
    () => parseAiGraderEyesCenteringSelectionResponse({
      payload: response(withCoordinates),
      images,
      candidates,
      requestedModel: "gpt-5.6-sol",
      providerElapsedMs: 100,
    }),
    (error: unknown) =>
      error instanceof AiGraderEyesError && error.code === "malformed_response",
  );
});

test("select requires an exact candidate and reject or unclear requires null", () => {
  const selectWithoutCandidate = structuredClone(validDecisions);
  selectWithoutCandidate[0]!.candidateId = null;
  const rejectWithCandidate = structuredClone(validDecisions);
  rejectWithCandidate[7]!.decision = "reject_all";

  for (const invalid of [selectWithoutCandidate, rejectWithCandidate]) {
    assert.throws(
      () => parseAiGraderEyesCenteringSelectionResponse({
        payload: response(invalid),
        images,
        candidates,
        requestedModel: "gpt-5.6-sol",
        providerElapsedMs: 100,
      }),
      (error: unknown) =>
        error instanceof AiGraderEyesError && error.code === "malformed_response",
    );
  }
});
