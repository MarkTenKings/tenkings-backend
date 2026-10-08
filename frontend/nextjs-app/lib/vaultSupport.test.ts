import assert from "node:assert/strict";
import test from "node:test";
import { publicVaultSupport, vaultSupportLinks } from "./vaultSupport";

test("Vault public support projects contacts and safe user context without sale authority", () => {
  const support = publicVaultSupport({ email: "support@example.test", textNumber: "+15555550101", phoneNumber: "+15555550102", hours: "Mon–Fri 9–5 Pacific", secret: "do-not-expose" } as never, { ref: "A1B2C3", doors: "X-01,K-01,X-01,X-26,compact_A9,constructor,../door,<script>" });
  assert.deepEqual(support.doorIds, ["X-01", "K-01", "X-26", "compact_A9"]);
  assert.equal(support.reference, "A1B2C3");
  assert.equal("secret" in support, false);
  assert.match(vaultSupportLinks(support).text, /^sms:\+15555550101\?body=/);
  assert.match(decodeURIComponent(vaultSupportLinks(support).email), /Reported doors: X-01, K-01/);
  assert.deepEqual(publicVaultSupport(support, { ref: ["secret"], doors: ["X-01"] }).doorIds, []);
  assert.equal(publicVaultSupport(support, { ref: "provider/secret?" }).reference, null);
  assert.equal(publicVaultSupport(support, { ref: "x".repeat(5000) }).reference, null);
});
