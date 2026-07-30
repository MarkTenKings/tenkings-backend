import test from "node:test";
import assert from "node:assert/strict";
import {
  AiGraderCalibrationActivationTransportError,
} from "../lib/aiGraderCalibrationActivationClient";
import {
  AI_GRADER_CALIBRATION_FRESH_AUTH_MESSAGE,
  ensureFreshAiGraderCalibrationActivationSession,
} from "../lib/aiGraderCalibrationFreshSession";

const session = (token: string) => ({
  token,
  expiresAt: "2026-07-30T12:00:00.000Z",
  user: {
    id: "owner-admin",
    phone: "+15555550123",
    displayName: "Owner",
    avatarUrl: null,
  },
  wallet: { id: "wallet-1", balance: 0 },
});

test("fresh activation handoff reuses verified authority and prompts exactly once only when stale", async () => {
  const existingCalls: Array<{ force?: boolean; message?: string | null } | undefined> = [];
  const existing = await ensureFreshAiGraderCalibrationActivationSession(
    async (options) => {
      existingCalls.push(options);
      return session("fresh-existing");
    },
    async ({ token }) => {
      assert.equal(token, "fresh-existing");
      return { ok: true as const, fresh: true as const };
    },
  );
  assert.equal(existing.token, "fresh-existing");
  assert.deepEqual(existingCalls, [undefined]);

  const renewedCalls: Array<{ force?: boolean; message?: string | null } | undefined> = [];
  const authorizeTokens: string[] = [];
  const renewed = await ensureFreshAiGraderCalibrationActivationSession(
    async (options) => {
      renewedCalls.push(options);
      return session(options?.force ? "fresh-renewed" : "stale-existing");
    },
    async ({ token }) => {
      authorizeTokens.push(token);
      if (token === "stale-existing") {
        throw new AiGraderCalibrationActivationTransportError(
          "Fresh human-admin authentication required",
          403,
        );
      }
      return { ok: true as const, fresh: true as const };
    },
  );
  assert.equal(renewed.token, "fresh-renewed");
  assert.deepEqual(authorizeTokens, ["stale-existing", "fresh-renewed"]);
  assert.deepEqual(renewedCalls, [
    undefined,
    { force: true, message: AI_GRADER_CALIBRATION_FRESH_AUTH_MESSAGE },
  ]);
});
