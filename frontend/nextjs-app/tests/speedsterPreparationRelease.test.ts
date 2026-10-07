import assert from "node:assert/strict";
import test from "node:test";
import { currentSpeedsterPreparationRelease } from "../lib/server/speedsterPreparationRelease";
import { assertPreparationIdentity } from "../lib/server/speedsterPreparationIntegrity";

// Apply with the actual reviewed CPU source admission. This deliberately fails
// while admission is absent; environment or a synthetic fixture cannot skip it.
test("current CPU admission returns a complete identity and defensive copies", () => {
  const first = currentSpeedsterPreparationRelease();
  assertPreparationIdentity(first);
  const retained = structuredClone(first), second = currentSpeedsterPreparationRelease();
  assert.deepEqual(second, retained);
  assert.notEqual(second, first);
  for (const name of Object.keys(first)) Object.assign(first, { [name]: "caller mutation" });
  Object.assign(first, { unreviewedOverride: true });
  assert.deepEqual(second, retained);
  assert.deepEqual(currentSpeedsterPreparationRelease(), retained);
});
