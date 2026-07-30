import assert from "node:assert/strict";
import test from "node:test";
import type { AiGraderMathematicalGradingAuthorityV1 } from "../lib/aiGraderLocalStation";
import {
  AI_GRADER_REVIEW_LINKAGE_DRAFT_STORAGE_KEY,
  boundAiGraderMathematicalAuthorityDraft,
  boundAiGraderReviewDraftPatch,
  persistAiGraderReviewLinkageField,
  readAiGraderReviewLinkageDraft,
} from "../lib/aiGraderReviewLinkageDraft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

const cardA = {
  queueItemId: "queue-a",
  gradingSessionId: "session-a",
  reportId: "report-a",
};
const cardB = {
  queueItemId: "queue-b",
  gradingSessionId: "session-b",
  reportId: "report-b",
};

function boundAuthority(): AiGraderMathematicalGradingAuthorityV1 {
  return {
    schemaVersion: "ai-grader-mathematical-grading-authority-v1",
    reportId: "report-a",
    gradingSessionId: "session-a",
    cardFormatId: "pokemon_tcg_standard",
    cardIdentity: {
      title: "Porygon-Z",
      sideCount: 2,
      tenantId: "tenant-1",
      setId: "set-42",
      programId: "base",
      cardNumber: "7",
      variantId: null,
      parallelId: null,
    },
    sides: {
      front: {
        centering: { profile: "pokemon_standard_yellow_border_v1" },
      },
      back: {
        centering: { profile: "pokemon_standard_back_v1" },
      },
    },
  } as unknown as AiGraderMathematicalGradingAuthorityV1;
}

test("refresh-safe linkage fields persist only under one exact queue/session/report identity", () => {
  const storage = memoryStorage();
  persistAiGraderReviewLinkageField(
    cardA,
    "manufacturer",
    "The Pokémon Company",
    storage,
    new Date("2026-07-28T12:00:00.000Z"),
  );
  persistAiGraderReviewLinkageField(
    cardA,
    "year",
    "2025",
    storage,
    new Date("2026-07-28T12:00:01.000Z"),
  );

  assert.deepEqual(readAiGraderReviewLinkageDraft(cardA, storage), {
    manufacturer: "The Pokémon Company",
    year: "2025",
  });
  assert.equal(readAiGraderReviewLinkageDraft(cardB, storage), undefined);

  const records = JSON.parse(
    storage.values.get(AI_GRADER_REVIEW_LINKAGE_DRAFT_STORAGE_KEY) ?? "[]",
  );
  assert.deepEqual(Object.keys(records[0].fields).sort(), [
    "manufacturer",
    "year",
  ]);
  assert.equal(JSON.stringify(records).includes("Porygon-Z"), false);
  assert.equal(JSON.stringify(records).includes("set-42"), false);
});

test("bound immutable Mathematical identity rehydrates independently from owner linkage fields", () => {
  const authority = boundAuthority();
  assert.deepEqual(boundAiGraderReviewDraftPatch(authority), {
    category: "tcg",
    playerName: "",
    cardName: "Porygon-Z",
    game: "Pokemon",
    productSet: "set-42",
    cardNumber: "7",
    insert: "",
    parallel: "",
  });
  assert.deepEqual(boundAiGraderMathematicalAuthorityDraft(authority), {
    cardFormatProfile: "pokemon_tcg_standard",
    title: "Porygon-Z",
    tenantId: "tenant-1",
    setId: "set-42",
    programId: "base",
    cardNumber: "7",
    variantId: "",
    parallelId: "",
    profiles: {
      front: "pokemon_standard_yellow_border_v1",
      back: "pokemon_standard_back_v1",
    },
  });
});

test("unsafe or malformed linkage storage cannot cross into an active card", () => {
  const storage = memoryStorage();
  storage.setItem(
    AI_GRADER_REVIEW_LINKAGE_DRAFT_STORAGE_KEY,
    JSON.stringify([
      {
        ...cardA,
        updatedAt: "2026-07-28T12:00:00.000Z",
        fields: {
          manufacturer: "data:text/html,attacker",
          year: "<script>",
          sport: "Pokémon",
          cardName: "must-not-be-accepted",
        },
      },
      {
        ...cardB,
        reportId: "../wrong",
        updatedAt: "not-a-date",
        fields: { sport: "Baseball" },
      },
    ]),
  );

  assert.deepEqual(readAiGraderReviewLinkageDraft(cardA, storage), {
    sport: "Pokémon",
  });
  assert.equal(readAiGraderReviewLinkageDraft(cardB, storage), undefined);
});
