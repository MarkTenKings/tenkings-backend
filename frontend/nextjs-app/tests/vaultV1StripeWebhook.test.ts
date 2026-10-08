import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeEvent, buildStripeObservation, stripeBindings, stripeTestRetriever } from "../lib/server/vaultV1/stripeWebhook";
const now = 1800000000000, secret = "whsec_test_secret_fixture";
const binding = { machineId: "00000000-0000-4000-8000-000000000001", readerId: "tmr_test", locationId: "tml_test" };
const saleId = "00000000-0000-4000-8000-000000000002";
const intent = () => ({ id: "pi_test", object: "payment_intent", livemode: false, amount: 2500, currency: "usd", capture_method: "automatic", payment_method_types: ["card_present"], status: "succeeded", metadata: { vault_machine_id: binding.machineId, vault_reader_id: binding.readerId, vault_location_id: binding.locationId, vault_sale_id: saleId, vault_request_digest: "a".repeat(64), vault_total_cents: "2500" } });
const event = () => ({ id: "evt_test", object: "event", livemode: false, created: now / 1000, type: "payment_intent.succeeded", data: { object: intent() } });
function signed(value = event(), timestamp = now / 1000) { const body = Buffer.from(JSON.stringify(value)); return { body, signature: `t=${timestamp},v1=${createHmac("sha256", secret).update(timestamp + ".").update(body).digest("hex")}` }; }
const reader = () => ({ id: binding.readerId, object: "terminal.reader", livemode: false, location: binding.locationId });
test("valid signatures support rotating v1 signatures and preserve raw body", () => { const { body, signature } = signed(); assert.equal(verifyStripeEvent(body, signature + ",v1=" + "0".repeat(64), secret, now).id, "evt_test"); assert.throws(() => verifyStripeEvent(Buffer.concat([body, Buffer.from(" ")]), signature, secret, now), /SIGNATURE_INVALID/); });
test("rejects missing signature, expired/future timestamp and duplicate timestamps", () => { const { body, signature } = signed(); for (const sig of [undefined, signature + ",t=1800000000", signed(event(), now / 1000 - 301).signature, signed(event(), now / 1000 + 301).signature]) assert.throws(() => verifyStripeEvent(body, sig, secret, now)); });
test("rejects live and Connect events", () => { for (const e of [{ ...event(), livemode: true }, { ...event(), account: "acct_other" }]) { const s = signed(e); assert.throws(() => verifyStripeEvent(s.body, s.signature, secret, now), /TEST_ACCOUNT_REQUIRED/); } });
test("binding configuration rejects duplicate readers/machines and malformed IDs", () => { assert.deepEqual(stripeBindings(JSON.stringify([binding])), [binding]); for (const data of [[binding, binding], [{ ...binding, readerId: "notreader" }]]) assert.throws(() => stripeBindings(JSON.stringify(data))); });
test("independently retrieves intent and reader, returns only reconciliation instruction", async () => { const paths: string[] = []; const obs = await buildStripeObservation(event(), [binding], async path => { paths.push(path); return path.includes("payment_intents") ? intent() : reader(); }, now); assert.deepEqual(paths, ["/payment_intents/pi_test", "/terminal/readers/tmr_test"]); assert.equal(obs?.instruction, "RECONCILE_ONLY"); assert.equal(obs?.saleId, saleId); });
test("ignores unrelated online payments and unknown events", async () => { const retrieve = async () => { throw Error("must not call"); }; assert.equal(await buildStripeObservation({ ...event(), type: "customer.created" }, [binding], retrieve), null); assert.equal(await buildStripeObservation({ ...event(), data: { object: { id: "pi_online", metadata: {} } } }, [binding], retrieve), null); });
test("rejects independently retrieved mismatched or live payment and reader", async () => { for (const bad of [{ ...intent(), livemode: true }, { ...intent(), amount: 2600 }, { ...intent(), currency: "eur" }, { ...intent(), metadata: { ...intent().metadata, vault_reader_id: "tmr_other" } }]) await assert.rejects(buildStripeObservation(event(), [binding], async p => p.includes("payment_intents") ? bad : reader()), /BINDING_MISMATCH/); await assert.rejects(buildStripeObservation(event(), [binding], async p => p.includes("payment_intents") ? intent() : { ...reader(), location: "tml_other" }), /READER_MISMATCH/); });
test("out-of-order event uses current retrieved state, never event success as authority", async () => { const obs = await buildStripeObservation(event(), [binding], async p => p.includes("payment_intents") ? { ...intent(), status: "canceled" } : reader()); assert.equal(obs?.status, "canceled"); });
test("reader action binds reader and intent", async () => { const e = { ...event(), type: "terminal.reader.action_succeeded", data: { object: { id: binding.readerId, action: { type: "process_payment_intent", process_payment_intent: { payment_intent: "pi_test" } } } } }; assert.equal((await buildStripeObservation(e, [binding], async p => p.includes("payment_intents") ? intent() : reader()))?.paymentIntentId, "pi_test"); });
test("retriever rejects live credentials and arbitrary destinations and redacts failures", async () => { assert.throws(() => stripeTestRetriever("sk_live_x")); const get = stripeTestRetriever("sk_test_fixture", async () => { throw Error("SECRET_PROVIDER_DIAGNOSTICS"); }); await assert.rejects(get("https://attacker.test"), /PATH_INVALID/); await assert.rejects(get("/payment_intents/pi_test"), error => String(error).includes("RETRIEVAL_UNAVAILABLE") && !String(error).includes("SECRET")); });

// No machine/sale projection dependency: valid receipts survive delayed synchronization.
import { persistStripeObservation, stripeObservationHints } from "../lib/server/vaultV1/stripeInbox";
async function observation() { return (await buildStripeObservation(event(), [binding], async p => p.includes("payment_intents") ? intent() : reader(), now))!; }
test("inbox persists without sale projection; identical retries cannot overwrite", async () => {
  const rows = new Map<string, any>(); let writes = 0;
  const db: any = { vaultStripeObservation: { findUnique: async ({ where }: any) => rows.get(where.id), create: async ({ data }: any) => { writes++; rows.set(data.id, data); } } };
  const obs = await observation();
  assert.equal(await persistStripeObservation(db, obs, "a".repeat(64)), "INSERTED");
  assert.equal(await persistStripeObservation(db, { ...obs, status: "canceled" }, "a".repeat(64)), "DUPLICATE");
  assert.equal(writes, 1); assert.equal(rows.get("stripe-test:evt_test").observedStatus, "succeeded");
  await assert.rejects(persistStripeObservation(db, obs, "b".repeat(64)), /EVENT_ID_CONFLICT/);
});
test("concurrent unique-key duplicate is read back and conflict-checked", async () => {
  let reads = 0;
  const db: any = { vaultStripeObservation: { findUnique: async () => ++reads === 1 ? null : { payloadDigest: "same" }, create: async () => { throw { code: "P2002" }; } } };
  assert.equal(await persistStripeObservation(db, await observation(), "same"), "DUPLICATE");
  reads = 0; await assert.rejects(persistStripeObservation(db, await observation(), "different"), /EVENT_ID_CONFLICT/);
});
test("database failure is not acknowledged as durable", async () => {
  const db: any = { vaultStripeObservation: { findUnique: async () => null, create: async () => { throw Error("storage unavailable"); } } };
  await assert.rejects(persistStripeObservation(db, await observation(), "digest"), /storage unavailable/);
});
test("hint query scopes machine and sale, checks certification and excludes payment authority", async () => {
  const queries: any[] = [];
  const db: any = { vaultSale: { findFirst: async (q: any) => { queries.push(q); return { mode: "CERTIFICATION", totalCents: 2500, currency: "USD" }; } }, vaultStripeObservation: { findMany: async (q: any) => { queries.push(q); return []; } } };
  const result = await stripeObservationHints(db, binding.machineId, saleId);
  assert.deepEqual(queries[0].where, { id: saleId, machineId: binding.machineId });
  assert.deepEqual(queries[1].where, { machineId: binding.machineId, saleId, totalCents: 2500, currency: "usd" });
  assert.equal(queries[1].take, 100); assert.equal(queries[1].select.observedStatus, undefined);
  assert.deepEqual(result, { instruction: "RECONCILE_ONLY", saleId, observations: [] });
});
test("hint query waits for projection and rejects production sales", async () => {
  for (const sale of [null, { mode: "PRODUCTION" }]) {
    const db: any = { vaultSale: { findFirst: async () => sale }, vaultStripeObservation: { findMany: async () => { throw Error("must not read"); } } };
    await assert.rejects(stripeObservationHints(db, binding.machineId, saleId), /PROJECTION_PENDING|TEST_SALE_REQUIRED/);
  }
});
test("provider transport bounds streamed data and disables redirects", async () => {
  let options: any;
  const retrieve = stripeTestRetriever("rk_test_fixture", async (_url, init) => { options = init; return new Response("x".repeat(262145)); });
  await assert.rejects(retrieve("/payment_intents/pi_test"), /RETRIEVAL_UNAVAILABLE/);
  assert.equal(options.redirect, "error");
});
