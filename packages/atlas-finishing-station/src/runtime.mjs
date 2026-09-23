import { join, isAbsolute } from 'node:path';
import { readProtectedStationFile, verifyNativeExecutable, createNativeCompanion } from './native.mjs';
import { createStationJournal } from './journal.mjs';
import { createStationController } from './controller.mjs';
import { createFileMacNfcJournal } from '@atlas/finishing/mac-nfc-journal';
import { createCupsPrinter, createFileCupsJournal, createLocalCupsTransport } from '@atlas/finishing/cups';
import { createManualLabelPdfRenderer } from '@atlas/finishing/label-pdf';
import { stationAssert as check, stationObject as exact } from '@atlas/finishing/station-protocol';

/** Explicit launcher entry point. No discovery, keys, network requests or
 * devices are touched merely by importing this package. */
export async function createLocalStationRuntime({ configurationPath }) {
  check(process.platform === 'darwin', 'STATION_MAC_REQUIRED');
  const config = JSON.parse(await readProtectedStationFile(configurationPath));
  exact(config, ['version','origin','nativeExecutable','nativeSha256','nativeConfigurationPath','stateDirectory','printer','label']);
  check(config.version === 'atlas-finishing-station-config-v1' && config.origin === 'https://atlasgrading.com'
    && isAbsolute(config.stateDirectory), 'STATION_CONFIGURATION_INVALID');
  await verifyNativeExecutable(config.nativeExecutable, config.nativeSha256);
  const protectedConfig = JSON.parse(await readProtectedStationFile(config.nativeConfigurationPath));
  check(protectedConfig.version === 'atlas-mac-companion-config-v1', 'STATION_NATIVE_CONFIG_INVALID');
  const native = createNativeCompanion({ executable: config.nativeExecutable, configurationPath: config.nativeConfigurationPath });
  const capabilities = await native.capabilities();
  let key = null; try { key = await native.keyInfo(); } catch { /* Missing existing protected key is setup pending; no creation. */ }
  const fullSync = async fd => { check((await native.fullSync(fd)).synced === true, 'STATION_FULLSYNC_REQUIRED'); };
  const journal = createStationJournal({ directory: join(config.stateDirectory, 'bridge'), fullSync });
  const nfcJournal = createFileMacNfcJournal({ directory: join(config.stateDirectory, 'nfc'), fullSync });
  let printer = null;
  if (config.printer !== null && config.label !== null) {
    const renderer = createManualLabelPdfRenderer(config.label);
    check(config.printer.renderProfileHash === renderer.profileHash, 'STATION_RENDER_PROFILE_MISMATCH');
    printer = createCupsPrinter({ config: config.printer,
      journal: createFileCupsJournal({ directory: join(config.stateDirectory, 'cups'), fullSync }),
      transport: createLocalCupsTransport(), renderDocument: renderer });
  } else check(config.printer === null && config.label === null, 'STATION_PRINTER_CONFIGURATION_INVALID');
  return createStationController({ config: protectedConfig, native, journal, nfcJournal, printer, capabilities, key });
}
