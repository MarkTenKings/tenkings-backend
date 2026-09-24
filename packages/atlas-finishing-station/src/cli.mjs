#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createStationHttpServer, STATION_PORT, STATION_ORIGIN } from './http.mjs';
import { createLocalStationRuntime, checkLocalStationConfiguration } from './runtime.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || !['--configuration', '--check-configuration'].includes(args[0])) {
  process.stderr.write('Usage: atlas-finishing-station --configuration|--check-configuration /absolute/protected/station.json\n'); process.exitCode = 2;
} else {
  let controller, server;
  try {
    if (args[0] === '--check-configuration') {
      process.stdout.write(JSON.stringify(await checkLocalStationConfiguration({ configurationPath: args[1] })) + '\n');
    } else {
      controller = await createLocalStationRuntime({ configurationPath: args[1] });
      const code = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
      server = createStationHttpServer({ controller, pairing: { code, credential, expiresAt: Date.now() + 120000 } });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(STATION_PORT, '127.0.0.1', resolve); });
      process.stdout.write(`ATLAS station listening on 127.0.0.1:${STATION_PORT}. Open this one-use link within two minutes:\n${STATION_ORIGIN}/admin/station#atlasStationLaunch=v1&atlasStationPair=${code}\n`);
      const shutdown = () => { controller.stop(); server.close(); };
      process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    }
  } catch (error) {
    controller?.stop(); server?.close();
    process.stderr.write(`${/^[A-Z0-9_]{1,100}$/.test(error.code ?? error.message ?? '') ? error.code ?? error.message : 'STATION_STARTUP_REFUSED'}\n`); process.exitCode = 1;
  }
}
