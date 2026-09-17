import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// No downloads, global installation, shell or implicit package-manager scripts.
// Call with explicit reviewed dependency locations (see native/README.md).
const args = process.argv.slice(2);
if (args.length !== 3) throw new Error('Usage: node scripts/build-native.mjs HEIF_INCLUDE HEIF_LIB NODE_INCLUDE');
const [heifInclude, heifLib, nodeInclude] = args.map(value => resolve(value));
const root = fileURLToPath(new URL('../', import.meta.url));
const version = readFileSync(join(heifInclude, 'libheif/heif_version.h'), 'utf8');
if (!/^#define LIBHEIF_VERSION "1\.23\.2"$/m.test(version)) throw new Error('Pinned libheif 1.23.2 headers required');
if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Only macOS and Linux builds are supported');
const output = join(root, 'native/build');
mkdirSync(output, { recursive: true });
const source = join(root, 'native/heif.cc'), binary = join(output, 'heif.node');
const compiler = process.env.CXX || 'c++';
const flags = ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared',
  '-DNAPI_VERSION=8', `-I${heifInclude}`, `-I${nodeInclude}`, source,
  `-L${heifLib}`, '-lheif', `-Wl,-rpath,${heifLib}`, '-o', binary];
if (process.platform === 'darwin') flags.push('-undefined', 'dynamic_lookup');
const result = spawnSync(compiler, flags, { stdio: 'inherit', timeout: 60_000 });
if (result.error || result.status !== 0) throw new Error('Native decoder build failed');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(join(output, 'build.json'), JSON.stringify({ libheif: '1.23.2', napi: 8,
  platform: process.platform, arch: process.arch, compiler, flags,
  sourceSha256: sha(source), binarySha256: sha(binary) }, null, 2) + '\n');
console.log(`Built ${binary}`);
