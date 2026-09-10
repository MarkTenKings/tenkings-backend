// Explicit local/build probe, invoked only after bootstrap closure verification.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { digest, readRegular, ENGINE_PATH } from './verify.mjs';
const require = createRequire(import.meta.url);

export async function smoke(verified) {
    const runtime = await import('../dist/runtime.mjs');
    assert.equal(typeof runtime.createPrivateRuntime, 'function');
    const sharp = require('sharp');
    assert.equal(sharp.versions.sharp, '0.33.5');
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 0]);
    const png = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
    const decoded = await sharp(png).rotate(90).resize(4, 6, { kernel: 'nearest' }).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([decoded.info.width, decoded.info.height, decoded.info.channels], [4, 6, 3]);
    assert.equal(decoded.data.length, 72);
    assert.deepEqual([...decoded.data.subarray(0, 3)], [255, 255, 255]);
    const { PrismaClient, Prisma } = require('../.generated/database/index.js');
    assert.equal(Prisma.prismaVersion.client, '5.22.0');
    const engine = fileURLToPath(new URL(`../${ENGINE_PATH}`, import.meta.url));
    const client = new PrismaClient({
        datasources: { db: { url: 'postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=atlas_staff' } },
        log: [], __internal: { engine: { binaryPath: engine } },
    });
    try {
        // Exact Prisma 5.22 library constructor, without $connect or any query.
        await client._engine.instantiateLibrary();
        assert(client._engine.library && client._engine.engine);
        assert.equal(client._engine.libraryStarted, false);
    } finally { await client.$disconnect(); }
    process.stdout.write(JSON.stringify({ status: 'ATLAS_PRIVATE_CONTAINER_SMOKE_PASS', manifestHash: verified.manifestHash,
        nodeVersion: process.version, nodeSha256: digest(await readRegular(process.execPath, 256 * 1024 * 1024)), platform: process.platform,
        arch: process.arch, uid: process.getuid(), gid: process.getgid(), sharp: sharp.versions.sharp,
        vips: sharp.versions.vips, prisma: Prisma.prismaVersion.client, engineHash: digest(await readRegular(engine)),
        libraryConstructed: true, databaseConnected: false }) + '\n');
}
