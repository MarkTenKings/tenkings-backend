import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION } from "@tenkings/shared";
import {
  fetchExactAiGraderDesignReferenceArtifact,
  normalizeAiGraderExactDesignReferenceIdentity,
  resolveActiveAiGraderDesignReference,
  type AiGraderApprovedDesignReferenceOperatorAuthority,
  type AiGraderExactDesignReferenceIdentity,
} from "../lib/aiGraderDesignReferenceClient";

const identity: AiGraderExactDesignReferenceIdentity = {
  tenantId: "tenant-1",
  setId: "set-1",
  programId: "program-1",
  cardNumber: "7",
  variantId: null,
  parallelId: null,
  side: "front",
  profile: "registered_design_template_v1",
};

function authority(hash = "a".repeat(64)): AiGraderApprovedDesignReferenceOperatorAuthority {
  return {
    databaseReferenceId: "ref-1",
    mathematicalReference: {
      schemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
      designReferenceId: "ref-1",
      profile: "registered_design_template_v1",
      tenantId: "tenant-1",
      setId: "set-1",
      programId: "program-1",
      cardNumber: "7",
      variantId: null,
      parallelId: null,
      side: "front",
      artifactId: "designref:ref-1:artifact",
      artifactSha256: hash,
      version: 3,
      widthPx: 100,
      heightPx: 200,
      intendedPrintBoundary: [
        { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
      ],
      approvedBy: "admin-1",
      approvedAt: "2026-07-18T12:00:00.000Z",
    },
    artifactMimeType: "image/png",
    intendedDesignBoundaryPixels: {
      schemaVersion: "ai-grader-intended-design-boundary-v1",
      coordinateFrame: "design_reference_pixels",
      contour: [[10, 20], [90, 20], [90, 180], [10, 180]],
    },
    registrationAcceptance: {},
    provenance: {},
  };
}

test("active reference lookup sends complete exact null-bearing identity and accepts no private path", async () => {
  const expected = authority();
  const resolved = await resolveActiveAiGraderDesignReference({
    identity,
    headers: { Authorization: "Bearer test" },
    fetchImpl: async (url, init) => {
      assert.equal(url, "/api/admin/ai-grader/design-references/active");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test");
      assert.deepEqual(JSON.parse(String(init?.body)), identity);
      return new Response(JSON.stringify({ ok: true, authority: expected }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(resolved.databaseReferenceId, "ref-1");
  assert.equal(JSON.stringify(resolved).includes("storage"), false);
  assert.throws(
    () => normalizeAiGraderExactDesignReferenceIdentity({ ...identity, setId: "" }),
    /setId is invalid/,
  );
});

test("artifact transport sends exact resolved version/hash and independently verifies headers, length, and bytes", async () => {
  const bytes = new TextEncoder().encode("exact approved design reference");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const exactAuthority = authority(hash);
  const artifact = await fetchExactAiGraderDesignReferenceArtifact({
    identity,
    authority: exactAuthority,
    headers: { Authorization: "Bearer test" },
    fetchImpl: async (url, init) => {
      assert.equal(url, "/api/admin/ai-grader/design-references/artifact");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        ...identity,
        version: 3,
        expectedArtifactSha256: hash,
      });
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(bytes.byteLength),
          "x-ten-kings-design-reference-id": "ref-1",
          "x-ten-kings-design-reference-sha256": hash,
        },
      });
    },
  });
  assert.equal(artifact.sha256, hash);
  assert.deepEqual(artifact.bytes, bytes);

  await assert.rejects(
    fetchExactAiGraderDesignReferenceArtifact({
      identity,
      authority: exactAuthority,
      headers: {},
      fetchImpl: async () => new Response(new TextEncoder().encode("tampered"), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": "8",
          "x-ten-kings-design-reference-id": "ref-1",
          "x-ten-kings-design-reference-sha256": hash,
        },
      }),
    }),
    /do not match the approved SHA-256/,
  );
});
