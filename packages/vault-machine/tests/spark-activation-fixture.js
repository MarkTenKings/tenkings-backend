/* Synthetic signing material, reports, cabinet/profile and release metadata.
 * These in-memory fixtures exercise verification only and are not acceptance. */
const crypto = require('node:crypto');
const { canonicalJson } = require('../../vault-contracts/dist');
const { digest } = require('../dist/util');
const { buildSparkProvisioning, SPARK_PROMOTION_EVIDENCE } = require('../dist/spark-provisioning');
const { waveshareBindingDigest } = require('../dist/waveshare-controller');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function activationFixture(overrides = {}) {
  const key = crypto.generateKeyPairSync('ed25519'), releaseKey = crypto.generateKeyPairSync('ed25519');
  const sign = payload => crypto.sign(null, Buffer.from(canonicalJson(payload)), key.privateKey).toString('base64');
  const provisioning = require('./spark-provisioning-fixture').input();
  provisioning.stage = 'PRODUCTION'; Object.assign(provisioning.profile, { environment: 'PRODUCTION', sandboxConfirmed: false, productionConfirmed: true, credentialGeneration: crypto.randomUUID() });
  if (overrides.machineId) provisioning.machineId = overrides.machineId;
  const controller = overrides.controller ?? { adapterId:'waveshare-modbus-rtu-relay-32ch-v2', mode:'LIVE', devicePath:'/dev/serial/by-id/SYNTHETIC_TEST_ONLY', serialFormat:'9600/8N1',
    endpoints:[{endpointId:'boardA',address:1,expectedFirmwareRegister:100}], mapping:[{doorId:'door-0001',controllerEndpointId:'boardA',controllerChannel:1}],
    mappingVersion:'1', profileDigest:'c'.repeat(64), pulseMs:100,offSettleMs:300,minimumOffMs:100,qualificationEvidenceDigest:'d'.repeat(64) };
  const plan = buildSparkProvisioning(provisioning), sourceCommit = 'a'.repeat(40), machineConfigDigest = overrides.machineConfigDigest ?? 'b'.repeat(64);
  const now = overrides.now ?? Date.parse('2026-10-07T12:00:00.000Z');
  const activatedAt = new Date(now).toISOString();
  const releaseManifest = Buffer.from(JSON.stringify({schemaVersion:1,platform:'linux-x64',nodeVersion:'22.23.2',releaseId:'synthetic-only',sourceCommit,appVersion:'0.1.0',localSchemaVersion:require('../dist/migrations').LOCAL_SCHEMA_VERSION,files:[]}));
  const previousBindingDigest = 'e'.repeat(64), controllerBindingDigest = waveshareBindingDigest(controller), releaseManifestSha256 = hash(releaseManifest);
  const evidence = Object.fromEntries(SPARK_PROMOTION_EVIDENCE.map(kind => {
    const artifact = Buffer.from('Synthetic test report bytes only: '+kind);
    const record = {schemaVersion:1,kind,outcome:'ACCEPTED',evidenceClass:'EXTERNAL_ACCEPTANCE',machineId:plan.machineId,sourceCommit,machineConfigDigest,
      paymentBindingDigest:kind==='TERMINAL_SANDBOX'?previousBindingDigest:plan.bindingDigest,controllerBindingDigest,releaseManifestSha256,
      observedAt:activatedAt,reviewedAt:activatedAt,reviewedBy:'synthetic-test-reviewer',artifactSha256:hash(artifact)};
    return [kind,{record:Buffer.from(JSON.stringify(record)),artifact}];
  }));
  const promotionPayload = {schemaVersion:1,purpose:'VAULT_SPARK_PRODUCTION_PROMOTION',machineId:plan.machineId,configurationDigest:plan.configurationDigest,previousBindingDigest,targetBindingDigest:plan.bindingDigest,sourceCommit,
    approvedBy:'synthetic-test-reviewer',approvedAt:activatedAt,expiresAt:new Date(now+3600000).toISOString(),evidence:SPARK_PROMOTION_EVIDENCE.map(kind=>({kind,sha256:hash(evidence[kind].record)}))};
  const payload = {schemaVersion:1,purpose:'VAULT_SPARK_RUNTIME_ACTIVATION',activationId:crypto.randomUUID(),machineId:plan.machineId,configurationDigest:plan.configurationDigest,machineConfigDigest,
    paymentBindingDigest:plan.bindingDigest,controllerBindingDigest,sourceCommit,releaseManifestSha256,promotionAuthorityDigest:digest(promotionPayload),activatedAt,expiresAt:new Date(now+7*86400000).toISOString(),approvedBy:'synthetic-test-reviewer'};
  const input = {provisioning,envelope:{payload,signature:sign(payload),promotion:{payload:promotionPayload,signature:sign(promotionPayload)}},activationPublicKey:key.publicKey.export({type:'spki',format:'pem'}),
    releaseManifest,releaseSignature:crypto.sign(null,releaseManifest,releaseKey.privateKey),releasePublicKey:releaseKey.publicKey.export({type:'spki',format:'pem'}),
    sourceBuild:{sourceCommit,sourceState:'CLEAN_COMMITTED',buildCompleted:true,releaseAuthorized:true,nativeBuild:'linux-x64'},controller,evidence,
    context:{machineId:plan.machineId,machineConfigDigest,sourceCommit,paymentBindingDigest:plan.bindingDigest,controllerBindingDigest},now};
  const resign = () => {input.envelope.signature=sign(input.envelope.payload);};
  const resignPromotion = () => {input.envelope.promotion.signature=sign(input.envelope.promotion.payload);input.envelope.payload.promotionAuthorityDigest=digest(input.envelope.promotion.payload);resign();};
  return {input,sign,resign,resignPromotion,plan,key,releaseKey,hash};
}
module.exports={activationFixture};
