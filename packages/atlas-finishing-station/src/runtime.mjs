import { join, isAbsolute } from 'node:path';
import { readProtectedStationFile, verifyNativeExecutable, createNativeCompanion } from './native.mjs';
import { createStationJournal } from './journal.mjs';
import { createStationController } from './controller.mjs';
import { createFileMacNfcJournal } from '@atlas/finishing/mac-nfc-journal';
import { createCupsPrinter, createFileCupsJournal, createLocalCupsTransport, validateCupsConfiguration } from '@atlas/finishing/cups';
import { createManualLabelPdfRenderer } from '@atlas/finishing/label-pdf';
import { stationAssert as check, stationObject as exact } from '@atlas/finishing/station-protocol';

async function loadConfiguration(configurationPath) {
  check(process.platform === 'darwin', 'STATION_MAC_REQUIRED');
  check(process.versions.node.split('.')[0] === '20', 'STATION_NODE20_REQUIRED');
  const config = JSON.parse(await readProtectedStationFile(configurationPath));
  exact(config, ['version','origin','nativeExecutable','nativeSha256','nativeConfigurationPath','stateDirectory','printer','label']);
  check(config.version === 'atlas-finishing-station-config-v1' && config.origin === 'https://atlasgrading.com'
    && isAbsolute(config.stateDirectory), 'STATION_CONFIGURATION_INVALID');
  await verifyNativeExecutable(config.nativeExecutable, config.nativeSha256);
  const protectedConfig = JSON.parse(await readProtectedStationFile(config.nativeConfigurationPath));
  check(protectedConfig.version === 'atlas-mac-companion-config-v1', 'STATION_NATIVE_CONFIG_INVALID');
  const native = createNativeCompanion({ executable: config.nativeExecutable, configurationPath: config.nativeConfigurationPath });
  check((await native.validateConfiguration()).configurationValid === true, 'STATION_NATIVE_CONFIG_INVALID');
  const capabilities = await native.capabilities();
  let renderer = null;
  if (config.printer !== null && config.label !== null) {
    validateCupsConfiguration(config.printer);
    renderer = createManualLabelPdfRenderer({ ...config.label, layoutVersion: config.printer.layoutVersion });
    check(config.printer.renderProfileHash === renderer.profileHash, 'STATION_RENDER_PROFILE_MISMATCH');
  } else check(config.printer === null && config.label === null, 'STATION_PRINTER_CONFIGURATION_INVALID');
  return { config, protectedConfig, native, capabilities, renderer };
}

/** Read-only setup check: validates both protected files with the real native
 * parser, executable hash and optional media/render profile. It never creates
 * journals, queries Keychain/PCSC/CUPS, opens HTTP or contacts the host. */
export async function checkLocalStationConfiguration({ configurationPath }) {
  const { config, capabilities } = await loadConfiguration(configurationPath);
  return { configurationValid: true, nativeCapabilities: capabilities, printerConfigured: config.printer !== null,
    hardwareInspected: false, keychainInspected: false, hostedActivationChecked: false };
}

/** Explicit launcher entry point. No discovery, keys, network requests or
 * devices are touched merely by importing this package. */
export async function createLocalStationRuntime({ configurationPath }) {
  const { config, protectedConfig, native, capabilities, renderer } = await loadConfiguration(configurationPath);
  let key = null; try { key = await native.keyInfo(); } catch { /* Missing existing protected key is setup pending; no creation. */ }
  const fullSync = async fd => { check((await native.fullSync(fd)).synced === true, 'STATION_FULLSYNC_REQUIRED'); };
  const journal = createStationJournal({ directory: join(config.stateDirectory, 'bridge'), fullSync });
  const nfcJournal = createFileMacNfcJournal({ directory: join(config.stateDirectory, 'nfc'), fullSync });
  let printer = null;
  if (renderer) {
    printer = createCupsPrinter({ config: config.printer,
      journal: createFileCupsJournal({ directory: join(config.stateDirectory, 'cups'), fullSync }),
      transport: createLocalCupsTransport(), renderDocument: renderer });
  }
  return createStationController({ config: protectedConfig, native, journal, nfcJournal, printer, capabilities, key });
}
