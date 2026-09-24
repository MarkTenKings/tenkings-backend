import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { checkLocalStationConfiguration } from '../src/runtime.mjs';

test('setup check is cold to journals, hardware and keys; printer selection stays absent', async () => {
  if (process.platform !== 'darwin' || process.versions.node.split('.')[0] !== '20') {
    await assert.rejects(checkLocalStationConfiguration({ configurationPath: '/missing/config.json' }),
      process.platform !== 'darwin' ? /STATION_MAC_REQUIRED/ : /STATION_NODE20_REQUIRED/);
    return;
  }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'atlas-station-check-')));
  try {
    // This fixture refuses every command with a possible runtime/device/key
    // effect; only the two read-only commands may succeed.
    const executable = join(directory, 'native');
    const bytes = '#!/bin/sh\ncase "$1" in\nvalidate-configuration) echo \'{"configurationValid":true}\';;\ncapabilities) echo \'{"productionReady":false,"qualifiedProfileAvailable":false}\';;\n*) exit 93;;\nesac\n';
    await writeFile(executable, bytes, { mode: 0o700 });
    const nativeConfigurationPath = join(directory, 'native.json');
    await writeFile(nativeConfigurationPath, JSON.stringify({ version: 'atlas-mac-companion-config-v1' }), { mode: 0o600 });
    const configurationPath = join(directory, 'station.json');
    const config = { version: 'atlas-finishing-station-config-v1', origin: 'https://atlasgrading.com', nativeExecutable: executable,
      nativeSha256: createHash('sha256').update(bytes).digest('hex'), nativeConfigurationPath,
      stateDirectory: join(directory, 'never-created'), printer: null, label: null };
    await writeFile(configurationPath, JSON.stringify(config), { mode: 0o600 });
    const before = await readdir(directory);
    const result = await checkLocalStationConfiguration({ configurationPath });
    assert.deepEqual(result, { configurationValid: true, nativeCapabilities: { productionReady: false, qualifiedProfileAvailable: false },
      printerConfigured: false, hardwareInspected: false, keychainInspected: false, hostedActivationChecked: false });
    assert.deepEqual(await readdir(directory), before);
    await writeFile(configurationPath, JSON.stringify({ ...config, label: {} }));
    await assert.rejects(checkLocalStationConfiguration({ configurationPath }), /STATION_PRINTER_CONFIGURATION_INVALID/);
    await writeFile(configurationPath, JSON.stringify({ ...config, printer: {}, label: {} }));
    await assert.rejects(checkLocalStationConfiguration({ configurationPath }), /CUPS_QUALIFIED_CONFIGURATION_REQUIRED/);
    await writeFile(configurationPath, JSON.stringify({ ...config, nativeSha256: '0'.repeat(64) }));
    await assert.rejects(checkLocalStationConfiguration({ configurationPath }), /STATION_NATIVE_BUILD_MISMATCH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
