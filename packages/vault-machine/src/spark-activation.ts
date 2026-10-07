import { createHash, createPublicKey, verify } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalJson } from "../../vault-contracts/dist";
import { buildSparkProvisioning, SPARK_PROMOTION_EVIDENCE, verifySparkPromotion, type SparkPromotionApproval } from "./spark-provisioning";
import { waveshareBindingDigest, type WaveshareControllerConfig } from "./waveshare-controller";
import { digest } from "./util";
import { VaultError } from "./types";
import { LOCAL_SCHEMA_VERSION } from "./migrations";

export interface ProductionEffectContext {
  machineId: string; machineConfigDigest: string | null; sourceCommit: string;
  paymentBindingDigest?: string; controllerBindingDigest?: string;
}
export interface ProductionAuthority { readonly paymentBindingDigest: string; readonly controllerBindingDigest: string; assertAuthorized(context: ProductionEffectContext): void }
export interface SparkActivationPayload {
  schemaVersion: 1; purpose: "VAULT_SPARK_RUNTIME_ACTIVATION"; activationId: string;
  machineId: string; configurationDigest: string; machineConfigDigest: string;
  paymentBindingDigest: string; controllerBindingDigest: string;
  sourceCommit: string; releaseManifestSha256: string; promotionAuthorityDigest: string;
  activatedAt: string; expiresAt: string; approvedBy: string;
}
export interface SparkActivationEnvelope {
  payload: SparkActivationPayload; signature: string;
  promotion: { payload: SparkPromotionApproval; signature: string };
}
export interface SparkAcceptanceEvidence {
  schemaVersion: 1; kind: typeof SPARK_PROMOTION_EVIDENCE[number]; outcome: "ACCEPTED";
  evidenceClass: "EXTERNAL_ACCEPTANCE"; machineId: string; sourceCommit: string;
  machineConfigDigest: string; paymentBindingDigest: string; controllerBindingDigest: string;
  releaseManifestSha256: string; observedAt: string; reviewedAt: string; reviewedBy: string;
  /** A separate actual report/archive, hashed and retained beside this record. */
  artifactSha256: string;
}
interface ReleaseManifest { schemaVersion: number; platform: string; nodeVersion: string; sourceCommit: string; appVersion: string; localSchemaVersion: number; releaseId: string; files: Array<{ path: string; size: number; mode: number; sha256: string }> }
const shaPattern = /^[a-f0-9]{64}$/;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function need(value: unknown, suffix: string): asserts value { if (!value) throw new VaultError(`SPARK_ACTIVATION_${suffix}`, "Production authority requires operator review", 503); }
function signature(bytes: Buffer, signed: Buffer, pem: string): void {
  try { const key = createPublicKey(pem); need(key.asymmetricKeyType === "ed25519" && signed.length === 64 && verify(null, bytes, key, signed), "SIGNATURE_INVALID"); }
  catch { need(false, "SIGNATURE_INVALID"); }
}

/** Pure verifier for offline review and synthetic tests. Its trusted public keys
 * are supplied by the protected filesystem loader below, never by the envelope.
 * Metadata is an assertion by the signing reviewer; no fixture string is proof
 * of external acceptance. Every accepted report's actual bytes are also hashed. */
export function verifySparkActivation(input: {
  provisioning: unknown; envelope: SparkActivationEnvelope; activationPublicKey: string;
  releaseManifest: Buffer; releaseSignature: Buffer; releasePublicKey: string; sourceBuild: unknown;
  controller: WaveshareControllerConfig;
  evidence: Record<string, { record: Buffer; artifact: Buffer }>;
  context: ProductionEffectContext; now: number;
}): { bindingDigest: string; activationId: string; expiresAt: string } {
  const e = input.envelope, p = e?.payload;
  need(p && p.schemaVersion === 1 && p.purpose === "VAULT_SPARK_RUNTIME_ACTIVATION"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.activationId), "ENVELOPE_INVALID");
  need(typeof e.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(e.signature), "SIGNATURE_INVALID");
  signature(Buffer.from(canonicalJson(p)), Buffer.from(e.signature, "base64"), input.activationPublicKey);
  const activated = Date.parse(p.activatedAt), expires = Date.parse(p.expiresAt);
  need(Number.isFinite(input.now) && Number.isFinite(activated) && activated <= input.now && expires > input.now
    && expires > activated && expires - activated <= 30 * 24 * 60 * 60 * 1000, "LEASE_EXPIRED");
  need(typeof p.approvedBy === "string" && /^[A-Za-z0-9_.:@-]{1,160}$/.test(p.approvedBy), "REVIEWER_INVALID");
  const plan = buildSparkProvisioning(input.provisioning);
  need(plan.stage === "PRODUCTION" && input.controller.mode === "LIVE", "STAGE_MISMATCH");
  need([p.configurationDigest,p.machineConfigDigest,p.paymentBindingDigest,p.controllerBindingDigest,p.releaseManifestSha256,p.promotionAuthorityDigest].every(v => typeof v === "string" && shaPattern.test(v)), "DIGEST_INVALID");
  need(p.machineId === plan.machineId && p.machineId === input.context.machineId && p.configurationDigest === plan.configurationDigest
    && p.paymentBindingDigest === plan.bindingDigest && p.machineConfigDigest === input.context.machineConfigDigest
    && p.controllerBindingDigest === waveshareBindingDigest(input.controller)
    && (!input.context.paymentBindingDigest || input.context.paymentBindingDigest === p.paymentBindingDigest)
    && (!input.context.controllerBindingDigest || input.context.controllerBindingDigest === p.controllerBindingDigest), "BINDING_MISMATCH");
  const evidenceDigests: Record<string, string> = {};
  for (const kind of SPARK_PROMOTION_EVIDENCE) {
    const pair = input.evidence[kind]; need(pair && pair.record.length > 0 && pair.artifact.length > 0, "EVIDENCE_MISSING");
    let record: SparkAcceptanceEvidence;
    try { record = JSON.parse(pair.record.toString("utf8")); } catch { need(false, "EVIDENCE_INVALID"); }
    need(record!.schemaVersion === 1 && record!.kind === kind && record!.outcome === "ACCEPTED" && record!.evidenceClass === "EXTERNAL_ACCEPTANCE"
      && record!.machineId === p.machineId && record!.sourceCommit === p.sourceCommit && record!.machineConfigDigest === p.machineConfigDigest
      && record!.controllerBindingDigest === p.controllerBindingDigest && record!.releaseManifestSha256 === p.releaseManifestSha256
      && record!.paymentBindingDigest === (kind === "TERMINAL_SANDBOX" ? e.promotion?.payload?.previousBindingDigest : p.paymentBindingDigest)
      && typeof record!.reviewedBy === "string" && /^[A-Za-z0-9_.:@-]{1,160}$/.test(record!.reviewedBy)
      && Number.isFinite(Date.parse(record!.observedAt)) && Date.parse(record!.observedAt) <= Date.parse(record!.reviewedAt)
      && Date.parse(record!.reviewedAt) <= activated && Date.parse(record!.reviewedAt) <= Date.parse(e.promotion?.payload?.approvedAt) && record!.artifactSha256 === sha(pair.artifact), "EVIDENCE_INVALID");
    evidenceDigests[kind] = sha(pair.record);
  }
  // Fresh promotion grants issuance, not daily manual renewal. The outer signed
  // lease expires within 30 days; its exact authority is checked on every effect.
  const promotion = verifySparkPromotion(input.provisioning, e.promotion, input.activationPublicKey, evidenceDigests, activated);
  need(p.promotionAuthorityDigest === promotion.authorityDigest && p.sourceCommit === promotion.sourceCommit, "PROMOTION_MISMATCH");
  need(sha(input.releaseManifest) === p.releaseManifestSha256, "RELEASE_MISMATCH");
  signature(input.releaseManifest, input.releaseSignature, input.releasePublicKey);
  let manifest: ReleaseManifest;
  try { manifest = JSON.parse(input.releaseManifest.toString("utf8")); } catch { need(false, "RELEASE_INVALID"); }
  const build = input.sourceBuild as Record<string, unknown>;
  need(manifest!.schemaVersion === 1 && manifest!.platform === "linux-x64" && /^[a-f0-9]{40}$/.test(p.sourceCommit)
    && manifest!.localSchemaVersion === LOCAL_SCHEMA_VERSION && manifest!.sourceCommit === p.sourceCommit && input.context.sourceCommit === p.sourceCommit
    && build?.sourceState === "CLEAN_COMMITTED" && build.buildCompleted === true && build.releaseAuthorized === true
    && build.sourceCommit === p.sourceCommit && build.nativeBuild === "linux-x64", "RELEASE_PROVENANCE_INVALID");
  return { bindingDigest: plan.bindingDigest, activationId: p.activationId, expiresAt: p.expiresAt };
}

/** Follow no symlinks, including parents. The service account must not be able
 * to replace a trust root, reviewed configuration, or installed executable. */
export function protectedProductionPath(path: string, directory = false): BigIntStats {
  need(typeof path === "string" && isAbsolute(path) && resolve(path) === path, "PROTECTED_PATH_REQUIRED");
  let selected = path;
  for (;;) {
    const stat = lstatSync(selected, { bigint: true });
    need(!stat.isSymbolicLink() && stat.uid === 0n && (stat.mode & 0o022n) === 0n
      && (selected === path && !directory ? stat.isFile() : stat.isDirectory()), "UNTRUSTED_PATH");
    if (dirname(selected) === selected) break;
    selected = dirname(selected);
  }
  return lstatSync(path, { bigint: true });
}
function protectedBytes(path: string, maximum = 4 * 1024 * 1024): Buffer {
  const before = protectedProductionPath(path);
  need(before.size > 0n && before.size <= BigInt(maximum), "FILE_SIZE_INVALID");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd, { bigint: true }); need(stamp(before) === stamp(stat), "FILE_CHANGED"); return readFileSync(fd); }
  finally { closeSync(fd); }
}
const stamp = (s: BigIntStats) => [s.dev,s.ino,s.mode,s.uid,s.gid,s.size,s.mtimeNs,s.ctimeNs].join(":");
function releaseTree(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (path: string) => {
    const stat = lstatSync(path, { bigint: true });
    need(!stat.isSymbolicLink() && stat.uid === 0n && !(stat.mode & 0o022n) && (stat.isFile() || stat.isDirectory()), "UNTRUSTED_RELEASE");
    result.set(path, stamp(stat));
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  protectedProductionPath(root, true); visit(root); need(result.size <= 40000, "RELEASE_TOO_LARGE"); return result;
}

/** Operational factory. No environment boolean, caller-provided public key, or
 * arbitrary callback can bypass protected trust/config/release verification. */
export function createSparkProductionAuthority(env: NodeJS.ProcessEnv, machineId: string, controller: WaveshareControllerConfig): ProductionAuthority & { bindingDigest: string } {
  const required = (name: string) => { const value = env[name]; need(value, "CONFIGURATION_REQUIRED"); return value; };
  const root = required("VAULT_RELEASE_ROOT");
  need(process.platform === "linux" && process.arch === "x64" && root === resolve(__dirname, "../../..")
    && process.execPath === join(root, "runtime/bin/node"), "PACKAGED_RUNTIME_REQUIRED");
  const releaseKey = required("VAULT_RELEASE_PUBLIC_KEY_PATH"), activationKey = required("VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH");
  need(releaseKey === "/etc/tenkings-vault/release-public.pem" && activationKey === "/etc/tenkings-vault/spark-activation-public.pem", "PINNED_TRUST_PATH_REQUIRED");
  const provisioningPath = required("VAULT_SPARK_PROVISIONING_PATH"), activationPath = required("VAULT_SPARK_ACTIVATION_PATH");
  const evidenceRoot = required("VAULT_SPARK_EVIDENCE_PATH"), profilePath = required("VAULT_SPARK_CONFIG_PATH"), controllerPath = required("VAULT_WAVESHARE_CONFIG_PATH");
  const releaseManifest = protectedBytes(join(root, "release.json")), releaseSignature = protectedBytes(join(root, "release.sig"), 64);
  const releasePublicKey = protectedBytes(releaseKey).toString("utf8");
  signature(releaseManifest, releaseSignature, releasePublicKey);
  const manifest = JSON.parse(releaseManifest.toString("utf8")) as ReleaseManifest;
  need(manifest.nodeVersion === process.versions.node && manifest.nodeVersion === "22.23.2" && manifest.platform === "linux-x64" && manifest.schemaVersion === 1, "RUNTIME_MISMATCH");
  const baseline = releaseTree(root), seen = new Set<string>();
  need(Array.isArray(manifest.files) && manifest.files.length > 0, "RELEASE_INVALID");
  for (const entry of manifest.files) {
    need(entry && typeof entry.path === "string" && !isAbsolute(entry.path) && !entry.path.split("/").some(part => !part || part === "." || part === "..")
      && !seen.has(entry.path) && !["release.json", "release.sig"].includes(entry.path), "RELEASE_INVALID");
    seen.add(entry.path); const file = join(root, entry.path), stat = protectedProductionPath(file);
    need(stat.isFile() && Number(stat.size) === entry.size && Number(stat.mode & 0o777n) === entry.mode && sha(readFileSync(file)) === entry.sha256, "RELEASE_INTEGRITY_FAILED");
  }
  const actual = [...baseline.keys()].filter(file => lstatSync(file).isFile() && ![join(root,"release.json"),join(root,"release.sig")].includes(file));
  need(actual.length === seen.size && actual.every(file => seen.has(file.slice(root.length + 1)))
    && ["runtime/bin/node", "source-build.json", "packages/vault-machine/dist/cli.js", "packages/vault-machine/dist/spark-activation.js", "packages/vault-contracts/dist/index.js", "deploy/vault-linux/launch.py", "frontend/vault-kiosk/dist/index.html"].every(file => seen.has(file)), "RELEASE_MEMBERSHIP_INVALID");
  const sourceBuild = JSON.parse(protectedBytes(join(root,"source-build.json")).toString("utf8"));
  const read = () => {
    protectedProductionPath(evidenceRoot, true);
    const evidence: Record<string,{record: Buffer;artifact: Buffer}> = {};
    for (const kind of SPARK_PROMOTION_EVIDENCE) evidence[kind] = { record: protectedBytes(join(evidenceRoot, `${kind}.evidence`)), artifact: protectedBytes(join(evidenceRoot, `${kind}.artifact`), 32 * 1024 * 1024) };
    const provisioning = JSON.parse(protectedBytes(provisioningPath).toString("utf8"));
    const envelope = JSON.parse(protectedBytes(activationPath).toString("utf8")) as SparkActivationEnvelope;
    need(digest(buildSparkProvisioning(provisioning).localProfile) === digest(JSON.parse(protectedBytes(profilePath).toString("utf8")))
      && waveshareBindingDigest(controller) === waveshareBindingDigest(JSON.parse(protectedBytes(controllerPath).toString("utf8"))), "PROFILE_CHANGED");
    need(protectedBytes(releaseKey).toString("utf8") === releasePublicKey, "RELEASE_TRUST_CHANGED");
    return { provisioning, envelope, evidence, activationPublicKey: protectedBytes(activationKey).toString("utf8") };
  };
  const loaded = read();
  const baseContext = { machineId, sourceCommit: env.VAULT_SOURCE_COMMIT ?? "", machineConfigDigest: loaded.envelope.payload.machineConfigDigest };
  const check = (current: ReturnType<typeof read>, context: ProductionEffectContext, now = Date.now()) => verifySparkActivation({ ...current, releaseManifest, releaseSignature, releasePublicKey, sourceBuild, controller, context, now });
  // An expired but authentic lease may boot for read-only reconciliation. Every
  // effect below still checks actual wall time and the machine durable clock.
  const initial = check(loaded, baseContext, Math.min(Date.now(), Date.parse(loaded.envelope.payload.expiresAt) - 1));
  return { bindingDigest: initial.bindingDigest, paymentBindingDigest: initial.bindingDigest, controllerBindingDigest: waveshareBindingDigest(controller), assertAuthorized(context) {
    // A full hash verified startup establishes immutable metadata. Any root edit,
    // replacement, chmod, membership change or tampering invalidates that cache.
    const currentTree = releaseTree(root);
    need(currentTree.size === baseline.size && [...baseline].every(([file, version]) => currentTree.get(file) === version), "RELEASE_CHANGED");
    const result = check(read(), context);
    need(result.bindingDigest === initial.bindingDigest, "BINDING_CHANGED_RESTART_REQUIRED");
  } };
}
