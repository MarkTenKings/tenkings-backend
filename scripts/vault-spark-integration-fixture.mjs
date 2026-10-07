import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { SYNTHETIC_SPARK_ORIGIN, SYNTHETIC_SPARK_TOKEN, SYNTHETIC_SPARK_KEY } from "./vault-synthetic-spark-server.mjs";
const require = createRequire(import.meta.url);
const vault = require("../packages/vault-machine/dist");
const contracts = require("../packages/vault-contracts/dist");
const { makeSyntheticConfig } = require("../packages/vault-contracts/tests/profile-fixtures.js");
const root = resolve(import.meta.dirname, "..");
export const hash = value => createHash("sha256").update(value).digest("hex");
export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function until(work, label, timeout = 12000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = await work(); if (value) return value; await delay(50); } throw new Error(`Synthetic deadline: ${label}`); }

export function syntheticBinding(index) { const machineId = randomUUID(); return { machineId, nayaxMachineId: String(80000000 + index), terminalId: `SYNTHETIC-${index}`, hwSerial: `SYNTHETIC-${index}`, siteId: 2, currency: "USD", callbackTerminalIdRepresentation: "HW_SERIAL", acquiringOnlyConfirmed: true, cardUidPolicy: "REJECT_AMBIGUOUS", acquiringCardBrands: ["VISA", "MASTERCARD"], unsupportedCardBrands: ["SMC"] }; }

export async function seedSyntheticAdministrator(prisma) {
  const id = randomUUID(), token = `synthetic_${randomBytes(32).toString("base64url")}`, expiresAt = new Date(Date.now() + 3600000);
  await prisma.user.create({ data: { id, displayName: "Synthetic Vault Administrator", role: "admin" } });
  await prisma.session.create({ data: { userId: id, tokenHash: hash(token), expiresAt } });
  return { id, token, expiresAt: expiresAt.toISOString(), session: { token, expiresAt: expiresAt.toISOString(), user: { id, phone: null, displayName: "Synthetic Vault Administrator", avatarUrl: null }, wallet: { id: "synthetic", balance: 0 } } };
}

export async function createSparkIntegrationFixture({ prisma, binding, provider, cloudOrigin, label, administrator }) {
  const directory = mkdtempSync(resolve(tmpdir(), "vault-spark-integration-"));
  const keys = generateKeyPairSync("ed25519"), credential = `vault_${randomBytes(32).toString("base64url")}`;
  const config = makeSyntheticConfig(binding.machineId, 1, keys.privateKey, 72);
  const productId = `synthetic-${binding.machineId}`;
  config.payload.products[0].id = productId;
  config.payload.products[0].name = "Synthetic sports pack";
  config.payload.assignments = Object.fromEntries(config.payload.machineProfile.doors.map(door => [door.doorId, productId]));
  config.payload.createdAt = new Date(Date.now() - 60000).toISOString();
  config.payload.expiresAt = new Date(Date.now() + 86400000).toISOString();
  config.digest = contracts.configDigest(config.payload); config.signature = sign(null, Buffer.from(contracts.canonicalJson(config.payload)), keys.privateKey).toString("base64");
  await prisma.vaultMachine.create({ data: { id: binding.machineId, slug: `synthetic-${binding.machineId}`, serialNumber: `synthetic-${binding.machineId}`, displayName: `Synthetic ${label}`, status: "ACTIVE", timezone: config.payload.timezone, city: config.payload.city, state: config.payload.state, taxRateBasisPoints: config.payload.taxRateBasisPoints, currentCredentialVersion: 1 } });
  await prisma.vaultProduct.create({ data: { ...config.payload.products[0], slug: productId, createdByAdminId: administrator.id } });
  await prisma.vaultDoor.createMany({ data: config.payload.doorMapping.map(door => ({ machineId: binding.machineId, doorId: door.doorId, controllerChannel: door.controllerChannel, controllerEndpointId: door.controllerEndpointId, plannedProductId: productId, state: "EMPTY" })) });
  const storedConfig = await prisma.vaultConfigVersion.create({ data: { machineId: binding.machineId, version: 1, schemaVersion: 2, status: "PUBLISHED", canonicalPayload: config.payload, digest: config.digest, signingKeyId: config.keyId, signingAlgorithm: config.algorithm, detachedSignature: config.signature, minimumAppVersion: "0.1.0", createdByAdminId: administrator.id, publishedByAdminId: administrator.id, publishedAt: new Date(config.payload.createdAt), expiresAt: new Date(config.payload.expiresAt) } });
  await prisma.vaultMachine.update({ where: { id: binding.machineId }, data: { pendingConfigId: storedConfig.id } });
  await prisma.vaultMachineCredential.create({ data: { machineId: binding.machineId, version: 1, credentialHash: hash(credential), status: "ACTIVE", activatedAt: new Date() } });
  const staffUser = `synthetic-tech-${binding.machineId}`;
  await prisma.vaultStaffMachineAccess.create({ data: { grantId: randomUUID(), userId: staffUser, machineId: binding.machineId, role: "TECHNICIAN", grantVersion: 1, verifierVersion: 1, verifierHash: vault.createScryptPinVerifier("123456"), verifierAlgorithm: "scrypt", verifierParameters: { N: 16384, r: 8, p: 1 }, validFrom: new Date(config.payload.createdAt), expiresAt: new Date(config.payload.expiresAt), createdByAdminId: administrator.id } });
  let offset = 0, cloudDown = false, cookie = "", store, payment, machine, service, runtime, controller;
  const clock = { now: () => new Date(Date.now() + offset), monotonicMs: () => performance.now() + offset };
  const errors = [];
  const cloud = new vault.VaultCloudClient({ origin: cloudOrigin, machineId: binding.machineId, credential: () => credential, allowInsecureLoopback: true,
    fetch: async (url, options) => { assert.equal(new URL(url).origin, cloudOrigin); if (cloudDown) throw new Error("SYNTHETIC_CLOUD_OUTAGE"); const response=await fetch(url,options); if(String(url).includes("events:batch")){const result=await response.clone().json();if(result.rejected?.length)errors.push(...result.rejected.map(item=>item.code));} return response; } });
  const api = async (path, body, { expected = 200, version } = {}) => {
    const stateVersion = body !== undefined && cookie && version === undefined ? (await api("/api/v1/state")).stateVersion : version;
    const response = await fetch(`${service.options?.origin ?? fixture.origin}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Origin: fixture.origin, "X-Vault-Contract-Version": "1", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(stateVersion === undefined ? {} : { "If-Match": String(stateVersion) }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
    const data = await response.json(); assert.equal(response.status, expected, `${label} ${path}: ${JSON.stringify(data)}`); return expected === 200 ? data.data : data;
  };
  async function open() {
    store = new vault.VaultStore(resolve(directory, "machine.sqlite"), { machineId: binding.machineId, appVersion: "0.1.0", sourceCommit: "a".repeat(40) });
    payment = new vault.NayaxSparkTestAdapter({ ...binding, terminalIdType: 1, integratorId: "927", tokenId: 116383, tokenSecret: SYNTHETIC_SPARK_TOKEN, signKey: SYNTHETIC_SPARK_KEY,
      apiBase: `${SYNTHETIC_SPARK_ORIGIN}/api`, environment: "SANDBOX", sandboxConfirmed: true, preSelectionConfirmed: true, currencyConfirmed: true, signingProfile: "CURRENT_GUID_SHA256", wireApiVersion: null,
      vendorApprovalReference: "SYNTHETIC_LOCAL_VALIDATION_ONLY", maxTotalCents: 100000, triggerReplayPolicy: "DISABLED", cancelReplayPolicy: "DISABLED", maxTriggerAttempts: 1, maxCancelAttempts: 1,
      journalPath: resolve(directory, "machine.sqlite.spark-provider.sqlite"), now: () => clock.now().getTime(), fetchImpl: provider.fetch,
      readObservations: id => cloud.sparkObservations(id), readReceiptFeed: after => cloud.sparkReceipts(after) });
    controller = new vault.DeterministicControllerSimulator(config.payload.doorMapping);
    machine = new vault.VaultMachine(store, payment, controller, { clock, appVersion: "0.1.0", pinnedConfigKeys: { "test-key": keys.publicKey.export({type:"spki",format:"pem"}) }, beforeCheckout: () => runtime.proveCheckoutReachability() });
    await machine.initialize();
    // Port zero is allocated before construction because the HTTP boundary binds Origin.
    const { createServer } = await import("node:net"); const allocation = createServer(); await new Promise(resolve => allocation.listen(0,"127.0.0.1",resolve)); const port = allocation.address().port; await new Promise(resolve => allocation.close(resolve));
    fixture.origin = `http://127.0.0.1:${port}`;
    service = new vault.VaultHttpService(machine, new vault.VaultOperationsService(machine,clock), { origin:fixture.origin,host:"127.0.0.1",port,staticRoot:resolve(root,"frontend/vault-kiosk/dist"),adapterCallbackToken:randomBytes(32).toString("hex"),clock });
    runtime = new vault.VaultRuntime(machine,cloud,{clock,broadcast:()=>service.broadcastState(),reportError:code=>errors.push(code)});
    await service.listen(); await runtime.synchronize(); cookie=""; await api("/api/v1/session/bootstrap",{});
  }
  async function closeLocal() { await runtime?.stop(); if(service?.server.listening) await service.close(); payment?.close(); store?.close(); }
  const fixture = { label,binding,directory,config,cloud,clock,api,errors,origin:"",get store(){return store;},get machine(){return machine;},get payment(){return payment;},get runtime(){return runtime;},get controller(){return controller;},
    advance(ms){offset+=ms;}, outage(value){cloudDown=value;}, async cycle(){await runtime.tickLocal();await runtime.synchronize();await runtime.synchronize();}, async restart(){await closeLocal();await open();},
    async start(doorId="door-0001"){await api("/api/v1/cart/select",{doorId,productId,selected:true});const checkout=await api("/api/v1/checkout",{idempotencyKey:randomUUID(),mode:"CERTIFICATION",configVersion:1,doorIds:[doorId]});await api(`/api/v1/sales/${checkout.activeSale.saleId}/payment`,{idempotencyKey:randomUUID()});return store.one("SELECT * FROM sale WHERE sale_id=?",checkout.activeSale.saleId);},
    async done(saleId){await api(`/api/v1/sales/${saleId}/done`,{});await runtime.synchronize();},
    async close(){await closeLocal();rmSync(directory,{recursive:true,force:true});},
  };
  try {
  await open();
  const actor = await api("/api/v1/staff/authenticate",{userId:staffUser,pin:"123456"});
  for(const doorId of ["door-0001","door-0002","door-0003"]){const restock=await api("/api/v1/restocks",{staffSessionId:actor.sessionId,doorIds:[doorId]});await api(`/api/v1/restocks/${restock.sessionId}/items/${doorId}`,{staffSessionId:actor.sessionId,outcome:"FILLED",productFitConfirmed:true,notes:"Synthetic software-only product fit"});await api(`/api/v1/restocks/${restock.sessionId}/finalize`,{staffSessionId:actor.sessionId,servicedDoorsClosed:true});}
  await api("/api/v1/staff/safe-exit",{staffSessionId:actor.sessionId,servicedDoorsClosed:true});await runtime.synchronize();
  return fixture;
  } catch(error) { await fixture.close(); error.message += ` (synthetic cloud event codes: ${errors.join(",")})`; throw error; }
}
