import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLiveRipClaimAccess,
  assignLiveRipSchema,
  buildLiveRipClaimSms,
  classifyLiveRipQrClaimStatus,
  hashLiveRipClaimToken,
  liveRipClaimTokenSchema,
  LiveRipClaimError,
  QR_CLAIM_TTL_MS,
  toLiveRipClaimError,
} from "../lib/server/liveRipClaim";

test("Live Rip claim tokens are validated and hashed without retaining the raw value", () => {
  const rawToken = "Z".repeat(43);
  const hash = hashLiveRipClaimToken(rawToken);

  assert.equal(liveRipClaimTokenSchema.parse(rawToken), rawToken);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, rawToken);
  assert.equal(hash, hashLiveRipClaimToken(rawToken));
});

test("Live Rip assignment input trims the customer name and accepts a mobile number", () => {
  assert.deepEqual(
    assignLiveRipSchema.parse({
      name: "  Jordan Collector  ",
      phone: "916-555-1212",
    }),
    {
      name: "Jordan Collector",
      phone: "916-555-1212",
    }
  );
});

test("Live Rip assignment SMS uses the required claim copy without a hosting URL", () => {
  const claimUrl = "https://collect.tenkings.co/claim/live-rip/secure-token";
  assert.equal(
    buildLiveRipClaimSms(claimUrl),
    `Your Ten Kings Live Rip is ready! Sign in or create your account to watch and download your video:\n\n${claimUrl}`
  );
});

test("Live Rip claim errors preserve their intended HTTP status", () => {
  const response = toLiveRipClaimError(new LiveRipClaimError(409, "Already claimed"));
  assert.deepEqual(response, {
    status: 409,
    message: "Already claimed",
  });
});

test("QR claims accept the authenticated scanner without a phone-bound recipient", () => {
  assert.doesNotThrow(() =>
    assertLiveRipClaimAccess({
      claimPhone: null,
      existingOwnerId: null,
      claimantUserId: "customer-1",
      claimantPhone: "+19165551212",
    })
  );
});

test("QR claims cannot replace an existing video owner", () => {
  assert.throws(
    () =>
      assertLiveRipClaimAccess({
        claimPhone: null,
        existingOwnerId: "customer-1",
        claimantUserId: "customer-2",
        claimantPhone: "+19165551212",
      }),
    (error: unknown) =>
      error instanceof LiveRipClaimError &&
      error.statusCode === 409 &&
      /already assigned/i.test(error.message)
  );
});

test("legacy SMS claims remain restricted to the recipient phone", () => {
  assert.doesNotThrow(() =>
    assertLiveRipClaimAccess({
      claimPhone: "+19165551212",
      existingOwnerId: "customer-1",
      claimantUserId: "customer-1",
      claimantPhone: "916-555-1212",
    })
  );

  assert.throws(
    () =>
      assertLiveRipClaimAccess({
        claimPhone: "+19165551212",
        existingOwnerId: null,
        claimantUserId: "customer-2",
        claimantPhone: "+19165550000",
      }),
    (error: unknown) =>
      error instanceof LiveRipClaimError &&
      error.statusCode === 403 &&
      /mobile number/i.test(error.message)
  );
});

test("QR claim status distinguishes ready, expired, claimed, and unavailable recordings", () => {
  const now = new Date("2026-07-27T18:00:00.000Z");
  const base = {
    status: "COMPLETE",
    userId: null,
    claimTokenHash: "a".repeat(64),
    claimExpiresAt: new Date(now.getTime() + 60_000),
    claimedAt: null,
  };

  assert.equal(classifyLiveRipQrClaimStatus(base, now), "ready");
  assert.equal(
    classifyLiveRipQrClaimStatus(
      { ...base, claimExpiresAt: new Date(now.getTime() - 1) },
      now
    ),
    "expired"
  );
  assert.equal(classifyLiveRipQrClaimStatus({ ...base, userId: "customer-1" }, now), "claimed");
  assert.equal(classifyLiveRipQrClaimStatus({ ...base, status: "LIVE" }, now), "unavailable");
  assert.equal(classifyLiveRipQrClaimStatus(null, now), "unavailable");
  assert.equal(QR_CLAIM_TTL_MS, 15 * 60 * 1000);
});
