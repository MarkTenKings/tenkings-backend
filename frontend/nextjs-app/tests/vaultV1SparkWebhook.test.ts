import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { authenticateSparkCallback, buildSparkReceipt, readSparkBody, sparkBindings } from "../lib/server/vaultV1/sparkWebhook";
import { persistSparkReceipt, sparkObservationHints, sparkReceiptFeed } from "../lib/server/vaultV1/sparkInbox";

const binding = { machineId: "00000000-0000-4000-8000-000000000001", nayaxMachineId: "71234996", terminalId: "0434334921100366", hwSerial: "0434334921100366", siteId: 2, currency: "USD" as const, callbackTerminalIdRepresentation: "HW_SERIAL" as const, acquiringOnlyConfirmed: true as const, cardUidPolicy: "REJECT_AMBIGUOUS" as const, acquiringCardBrands: ["Visa"], unsupportedCardBrands: ["Configured closed-loop"] };
const session = "12c7cec2-c690-4425-9a1f-db0db60e2d8c";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", VAULT_NAYAX_SPARK_CALLBACKS_ENABLED: "true", VAULT_NAYAX_SPARK_ENVIRONMENT: "SANDBOX", VAULT_NAYAX_SPARK_CALLBACK_SECRET: "s".repeat(48) };
const transaction = () => ({ NayaxTransactionId: 2004545072, SparkTransactionId: session, SiteId: 2,
  TerminalId: binding.terminalId, MachineId: 71234996, HwSerial: binding.hwSerial, MachineAuTime: "20240205194122328",
  AuthStatus: { Verdict: "Approved", ErrorCode: 0, ErrorDescription: "sensitive diagnostic" }, Amount: 15.00, CurrencyCode: "USD",
  CardLast4Digits: "1234", CardHash: "private card hash", CardUid: "private uid" });
const body = (value: unknown) => Buffer.from(JSON.stringify(value));
const receipt = () => buildSparkReceipt(body(transaction()), "TRANSACTION", [binding]);

test("Spark callback static header requires configured sandbox and exact secret", () => {
  authenticateSparkCallback({ "x-vault-spark-secret": env.VAULT_NAYAX_SPARK_CALLBACK_SECRET }, env);
  for (const supplied of [undefined, "wrong", [env.VAULT_NAYAX_SPARK_CALLBACK_SECRET!]]) assert.throws(() => authenticateSparkCallback({ "x-vault-spark-secret": supplied }, env), /AUTH_INVALID/);
  for (const override of [{ VAULT_NAYAX_SPARK_CALLBACKS_ENABLED: "false" }, { VAULT_NAYAX_SPARK_ENVIRONMENT: "LIVE" }, { VAULT_NAYAX_SPARK_CALLBACK_SECRET: "short" }, { VAULT_NAYAX_SPARK_CALLBACK_HEADER: "authorization" }]) assert.throws(() => authenticateSparkCallback({}, { ...env, ...override }));
});
test("bindings are exact, normalized, and cannot ambiguously share a device", () => {
  assert.deepEqual(sparkBindings(JSON.stringify([binding])), [binding]);
  for (const data of [[], [binding, binding], [{ ...binding, nayaxMachineId: 71234996 }], [{ ...binding, siteId: -1 }], [{ ...binding, machineId: "wrong" }]]) assert.throws(() => sparkBindings(JSON.stringify(data)), /BINDINGS_INVALID/);
});
test("approved callback keeps minimal exact evidence and converts major units to cents", () => {
  const actual = receipt();
  assert.equal(actual.vaultMachineId, binding.machineId);
  assert.equal(actual.observation.machineId, binding.nayaxMachineId);
  assert.equal(actual.observation.amountCents, 1500);
  assert.equal(actual.observation.currency, "USD");
  assert.equal(actual.observation.nayaxTransactionId, "2004545072");
  assert.equal(actual.observation.verdict, "Approved");
  assert.doesNotMatch(JSON.stringify(actual), /sensitive|private|Card/);
});
test("missing optional callback currency uses explicit configured machine USD with provenance", () => {
  const callback: any = transaction(); delete callback.CurrencyCode;
  const observation = buildSparkReceipt(body(callback), "TRANSACTION", [binding]).observation;
  assert.equal(observation.currency, "USD"); assert.equal(observation.currencySource, "MACHINE_BINDING");
  assert.equal(receipt().observation.currencySource, "CALLBACK");
  const unconfirmed: any = { ...binding }; delete unconfirmed.currency;
  assert.throws(() => sparkBindings(JSON.stringify([unconfirmed])), /BINDINGS_INVALID/);
});
test("reject cross-device, malformed identity, unsupported currency and fractional cents", () => {
  for (const change of [{ MachineId: 10 }, { TerminalId: "other" }, { HwSerial: "other" }, { SiteId: 3 }, { SparkTransactionId: "not-guid" }, { NayaxTransactionId: 1e20 }, { Amount: 15.001 }, { Amount: -15 }, { CurrencyCode: "EUR" }, { CurrencyNumeric: "978" }, { AuthStatus: { Verdict: "Captured" } }]) assert.throws(() => buildSparkReceipt(body({ ...transaction(), ...change }), "TRANSACTION", [binding]));
});
test("amount conversion accepts normal decimal values without rounding fractional cents", () => {
  assert.equal(buildSparkReceipt(body({ ...transaction(), Amount: 19.99 }), "TRANSACTION", [binding]).observation.amountCents, 1999);
  assert.throws(() => buildSparkReceipt(body({ ...transaction(), Amount: 0.001 }), "TRANSACTION", [binding]), /AMOUNT_INVALID/);
  for (const literal of ["15.000000000000000001", "0.009999999999999999999", "15.001e0"]) assert.throws(() => buildSparkReceipt(Buffer.from(JSON.stringify(transaction()).replace('"Amount":15', '"Amount":' + literal)), "TRANSACTION", [binding]), /AMOUNT_INVALID/);
  assert.equal(buildSparkReceipt(Buffer.from(JSON.stringify(transaction()).replace('"Amount":15', '"Amount":15e0')), "TRANSACTION", [binding]).observation.amountCents, 1500);
});
test("JSON int64 IDs remain lossless and duplicate ambiguous keys are rejected", () => {
  const serialized = JSON.stringify(transaction()).replace('"NayaxTransactionId":2004545072', '"NayaxTransactionId":9223372036854775807');
  assert.equal(buildSparkReceipt(Buffer.from(serialized), "TRANSACTION", [binding]).observation.nayaxTransactionId, "9223372036854775807");
  assert.throws(() => buildSparkReceipt(Buffer.from(serialized.replace("9223372036854775807", "9223372036854775808")), "TRANSACTION", [binding]), /PROVIDER_ID_INVALID/);
  assert.throws(() => buildSparkReceipt(Buffer.from(serialized.replace('"Amount":15', '"Amount":15,"Amount":25')), "TRANSACTION", [binding]), /BODY_INVALID/);
});
test("decline and timeout are distinct session observations with no amount or approval", () => {
  const value = { SparkTransactionId: session, MachineId: 71234996, HwSerial: binding.hwSerial, TerminalId: binding.terminalId };
  const timeout = buildSparkReceipt(body(value), "TIMEOUT", [binding]).observation;
  const { TerminalId, ...declineValue } = value;
  const decline = buildSparkReceipt(body({ ...declineValue, Status: { Verdict: "Declined", ErrorCode: 44 } }), "DECLINE", [binding]).observation;
  assert.equal(timeout.verdict, null); assert.equal(timeout.amountCents, null);
  assert.equal(decline.terminalId, null); assert.equal(decline.verdict, "Declined");
  assert.notEqual(timeout.receiptId, decline.receiptId);
});
test("normalized duplicate ignores discarded card data but preserves conflicting outcome", () => {
  const same = buildSparkReceipt(body({ ...transaction(), CardUid: "changed", Unused: "ignored" }), "TRANSACTION", [binding]);
  const conflicting = buildSparkReceipt(body({ ...transaction(), Amount: 25 }), "TRANSACTION", [binding]);
  assert.equal(same.observation.receiptId, receipt().observation.receiptId);
  assert.notEqual(conflicting.observation.receiptId, receipt().observation.receiptId);
});
test("strict UTF-8 JSON and streamed byte bounds reject malformed and oversized bodies", async () => {
  assert.throws(() => buildSparkReceipt(Buffer.from([0xff]), "TRANSACTION", [binding]), /BODY_INVALID/);
  assert.throws(() => buildSparkReceipt(body({ payload: "x".repeat(32768) }), "TRANSACTION", [binding]), /BODY_TOO_LARGE/);
  await assert.rejects(readSparkBody(Readable.from([Buffer.alloc(20000), Buffer.alloc(20000)])), /BODY_TOO_LARGE/);
  assert.deepEqual(await readSparkBody(Readable.from([body(transaction())])), body(transaction()));
});
test("inbox insert/replay never depends on or mutates sale/door projection", async () => {
  const rows = new Map<string, any>(); let writes = 0;
  const db: any = { vaultSparkObservation: { findUnique: async ({ where }: any) => rows.get(where.id), create: async ({ data }: any) => { writes++; rows.set(data.id, data); } } };
  db.$transaction = async (work: any) => work({ ...db, $queryRaw: async () => [] });
  assert.equal(await persistSparkReceipt(db, receipt()), "INSERTED");
  assert.equal(await persistSparkReceipt(db, receipt()), "DUPLICATE");
  assert.equal(writes, 1);
  const row = [...rows.values()][0]; assert.equal(row.machineId, binding.machineId); assert.equal(row.nayaxMachineId, binding.nayaxMachineId);
});
test("receipt allocation follows the transaction lock and storage failure stays unacknowledged", async () => {
  const calls: string[] = [];
  const db: any = { $transaction: async (work: any) => work({ $queryRaw: async () => { calls.push("LOCK"); }, vaultSparkObservation: {
    findUnique: async () => { calls.push("READ"); return null; }, create: async () => { calls.push("ALLOCATE"); throw Error("offline"); },
  } }) };
  await assert.rejects(persistSparkReceipt(db, receipt()), /offline/);
  assert.deepEqual(calls, ["LOCK", "READ", "ALLOCATE"]);
});
test("observation retrieval scopes exact authenticated machine/session and returns all conflicts", async () => {
  let query: any;
  const { receiptId, machineId: nayaxMachineId, ...fields } = receipt().observation;
  const db: any = { vaultSparkObservation: { findMany: async (q: any) => { query = q; return [{ id: receiptId, nayaxMachineId, ...fields }]; } } };
  const result = await sparkObservationHints(db, binding.machineId, session);
  assert.deepEqual(query.where, { machineId: binding.machineId, sparkTransactionId: session, stage: "SANDBOX" });
  assert.equal(result.instruction, "RECONCILE_ONLY"); assert.deepEqual(result.observations, [receipt().observation]); assert.equal(query.take, 101);
  db.vaultSparkObservation.findMany = async () => Array.from({ length: 101 }, () => ({}));
  await assert.rejects(sparkObservationHints(db, binding.machineId, session), /OBSERVATION_LIMIT_REVIEW_REQUIRED/);
});

test("documented transaction decline accepts omitted amount but never an incomplete approval", () => {
  const decline: any = { ...transaction(), AuthStatus: { Verdict: "Declined", ErrorCode: 37 } }; delete decline.Amount;
  assert.equal(buildSparkReceipt(body(decline), "TRANSACTION", [binding]).observation.amountCents, null);
  assert.equal(buildSparkReceipt(body(decline), "TRANSACTION", [binding]).observation.verdict, "Declined");
  for (const missing of ["Amount", "MachineAuTime"]) { const bad: any = transaction(); delete bad[missing]; assert.throws(() => buildSparkReceipt(body(bad), "TRANSACTION", [binding])); }
});
test("callback terminal representation is explicit and independent of trigger identifier", () => {
  const configured = { ...binding, callbackTerminalIdRepresentation: "MACHINE_ID" as const };
  assert.equal(buildSparkReceipt(body({ ...transaction(), TerminalId: 71234996 }), "TRANSACTION", [configured]).observation.terminalId, "71234996");
  assert.throws(() => buildSparkReceipt(body(transaction()), "TRANSACTION", [configured]), /DEVICE_BINDING/);
  assert.throws(() => sparkBindings(JSON.stringify([{ ...binding, callbackTerminalIdRepresentation: undefined }])), /BINDINGS/);
});
test("acquiring proof requires explicit method profile and preserves only presence flags", () => {
  const card: any = { ...transaction(), CardBrand: "Visa", AuthCode: "secret-auth", NayaxRRN: "secret-rrn" }; delete card.CardUid;
  const acquiring = buildSparkReceipt(body(card), "TRANSACTION", [binding]).observation;
  assert.equal(acquiring.methodClassification, "ACQUIRING"); assert.equal(acquiring.methodEvidence.rrnPresent, true);
  assert.match(acquiring.methodProfileDigest, /^[a-f0-9]{64}$/);
  const changedProfile = buildSparkReceipt(body(card), "TRANSACTION", [{ ...binding, acquiringCardBrands: ["Visa", "Vendor-confirmed additional brand"] }]).observation;
  assert.notEqual(changedProfile.methodProfileDigest, acquiring.methodProfileDigest);
  assert.notEqual(changedProfile.receiptId, acquiring.receiptId);
  assert.doesNotMatch(JSON.stringify(acquiring), /secret|Visa/);
  assert.equal(buildSparkReceipt(body({ ...card, CardUid: "hidden" }), "TRANSACTION", [binding]).observation.methodClassification, "AMBIGUOUS");
  assert.equal(buildSparkReceipt(body({ ...card, CardBrand: "Unconfirmed" }), "TRANSACTION", [binding]).observation.methodClassification, "AMBIGUOUS");
  assert.equal(buildSparkReceipt(body({ ...card, CardBrand: "Configured closed-loop" }), "TRANSACTION", [binding]).observation.methodClassification, "UNSUPPORTED");
  assert.equal(buildSparkReceipt(body({ ...card, CardUid: "hidden" }), "TRANSACTION", [{ ...binding, cardUidPolicy: "ALLOW_CONFIRMED_ACQUIRING" }]).observation.methodClassification, "ACQUIRING");
});
test("machine feed keeps int64 cursor exact, includes all sessions and pages without skipping", async () => {
  const { receiptId, machineId: nayaxMachineId, ...fields } = receipt().observation;
  let query: any;
  const start = 9007199254740993n;
  const db: any = { vaultSparkObservation: { findMany: async (input: any) => { query = input; return Array.from({ length: 101 }, (_, i) => ({ id: receiptId, nayaxMachineId, ...fields, receiptSequence: start + BigInt(i) })); } } };
  const result = await sparkReceiptFeed(db, binding.machineId, "9007199254740992");
  assert.deepEqual(query.where, { machineId: binding.machineId, stage: "SANDBOX", receiptSequence: { gt: 9007199254740992n } });
  assert.equal(result.observations.length, 100); assert.equal(result.nextCursor, String(start + 99n)); assert.equal(result.hasMore, true);
  assert.equal("receiptSequence" in result.observations[0]!, false);
  for (const cursor of ["-1", "01", "9223372036854775808", "1.5"]) await assert.rejects(sparkReceiptFeed(db, binding.machineId, cursor), /CURSOR_INVALID/);
  db.vaultSparkObservation.findMany = async () => [];
  assert.equal((await sparkReceiptFeed(db, binding.machineId, result.nextCursor)).nextCursor, result.nextCursor);
});
