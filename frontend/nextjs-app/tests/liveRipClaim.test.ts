import assert from "node:assert/strict";
import test from "node:test";
import {
  assignLiveRipSchema,
  buildLiveRipClaimSms,
  hashLiveRipClaimToken,
  liveRipClaimTokenSchema,
  LiveRipClaimError,
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
