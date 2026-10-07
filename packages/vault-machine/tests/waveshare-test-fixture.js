const { createRig, crypto, contracts, vault } = require('./helpers');
const { makeSyntheticConfig } = require('../../vault-contracts/tests/profile-fixtures');

/** Injection only: these fabricated qualification hashes and relay states exist
 * solely to exercise non-MOCK policy branches. No transport/hardware is composed. */
async function createInjectedQualifiedCertificationRig() {
  const machineId = crypto.randomUUID(); const keyPair = crypto.generateKeyPairSync('ed25519');
  const generated = makeSyntheticConfig(machineId, 1, keyPair.privateKey, 2);
  const payload = generated.payload;
  payload.machineProfile.provenance = 'QUALIFIED';
  payload.machineProfile.evidence = Object.fromEntries(['geometryDigest', 'wiringDigest', 'capabilityDigest', 'hardwareDigest'].map(key => [key, 'f'.repeat(64)]));
  const controller = new vault.DeterministicControllerSimulator(payload.doorMapping);
  const identity = controller.identity.bind(controller); const send = controller.sendOpenCommand.bind(controller);
  controller.identity = async () => ({ ...await identity(), outputState: 'OFF_VERIFIED' });
  controller.sendOpenCommand = async command => ({ ...await send(command), outputState: 'OFF_VERIFIED' });
  const rig = await createRig({ machineId, keyPair, controller, configure: false });
  rig.machine.stageConfig({ payload, digest: contracts.configDigest(payload), keyId: 'test-config-key', algorithm: 'Ed25519', signature: crypto.sign(null, Buffer.from(contracts.canonicalJson(payload)), keyPair.privateKey).toString('base64') });
  if (!rig.machine.activatePendingConfig().activated) throw new Error('Injected certification profile did not activate');
  rig.machine.markCloudContact();
  return rig;
}
module.exports = { createInjectedQualifiedCertificationRig };
