import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
const require = createRequire('/build/package.json');
const yaml = require('/build/node_modules/.pnpm/node_modules/js-yaml');
const lock = yaml.load(readFileSync('/build/pnpm-lock.yaml', 'utf8'));
const manifest = JSON.parse(readFileSync('/build/source-manifest.json', 'utf8'));
const registry = '/build/node_modules/.pnpm';
const entries = readdirSync(registry);
const linked = [];
function link(target, destination) {
  assert(target.startsWith('/build/'));
  assert(existsSync(target), `Missing installed dependency: ${target}`);
  if (existsSync(destination)) {
    assert.equal(realpathSync(destination), realpathSync(target));
    return;
  }
  mkdirSync(dirname(destination), {recursive:true});
  symlinkSync(relative(dirname(destination), target), destination);
  assert(realpathSync(destination).startsWith('/build/'));
}
for (const directory of manifest.packages) {
  const pkg = JSON.parse(readFileSync(`/build/${directory}/package.json`, 'utf8'));
  const importer = lock.importers[directory];
  assert(importer, `Missing lockfile importer ${directory}`);
  const locked = {...importer.dependencies, ...importer.devDependencies};
  for (const [name, specifier] of Object.entries({...pkg.peerDependencies, ...pkg.dependencies, ...pkg.devDependencies})) {
    assert.equal(locked[name]?.specifier, specifier, `Manifest/lock disagreement: ${directory}/${name}`);
    const version = locked[name].version;
    let target;
    if (version.startsWith('link:')) target = resolve('/build', directory, version.slice(5));
    else {
      const prefix = `${name.replaceAll('/', '+')}@${version.split('(')[0]}`;
      const candidates = entries.filter(item => item === prefix || item.startsWith(`${prefix}_`));
      const encoded = `${name}@${version}`.replaceAll('/', '+').replaceAll(')(', '_').replaceAll('(', '_').replaceAll(')', '_').replace(/_$/, '');
      const candidate = candidates.includes(encoded) ? encoded : null;
      assert(candidate, `Unavailable or ambiguous locked dependency ${name}@${version}: ${candidates}`);
      target = `${registry}/${candidate}/node_modules/${name}`;
      assert.equal(JSON.parse(readFileSync(`${target}/package.json`, 'utf8')).version, version.split('(')[0]);
    }
    link(target, `/build/${directory}/node_modules/${name}`);
    linked.push({directory, name, lockedVersion:version, target:relative('/build', target)});
  }
  const bin = `/build/${directory}/node_modules/.bin`;
  mkdirSync(bin, {recursive:true});
  for (const name of Object.keys({...pkg.dependencies, ...pkg.devDependencies})) {
    const root = `/build/${directory}/node_modules/${name}`;
    const dependency = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
    for (const [command, path] of Object.entries(typeof dependency.bin === 'string' ? {[name.split('/').at(-1)]:dependency.bin} : dependency.bin ?? {})) {
      if (existsSync(`${bin}/${command}`)) continue;
      link(resolve(root,path), `${bin}/${command}`);
    }
  }
}
writeFileSync('/build/dependency-links.json', JSON.stringify(linked, null, 2)+'\n');
console.log(JSON.stringify({status:'CURRENT_WORKSPACE_LINKS_PASS',workspacePackages:manifest.packages.length,links:linked.length,externalCheckoutLinks:0}));
