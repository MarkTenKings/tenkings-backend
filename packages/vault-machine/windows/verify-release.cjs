"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function assertWindowsRelativePath(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || value.includes("\\")) throw new Error("Invalid release member path");
  const parts = value.split("/");
  for (const part of parts) {
    const basename = part.split(".")[0].replace(/[ ]+$/, "");
    if (!part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part)
      || /^(CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(basename) || part.length > 255) throw new Error("Windows-unsafe release member path");
  }
  return parts;
}

function fileDigest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

function validateRelease(directory, manifestPath, expectedManifestSha256) {
  if (!/^[a-f0-9]{64}$/i.test(expectedManifestSha256)) throw new Error("A manifest digest from the approved release channel is required");
  const root = path.resolve(directory);
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error("Release root must be a real directory");
  if (!fs.lstatSync(manifestPath).isFile() || fs.lstatSync(manifestPath).isSymbolicLink() || fs.statSync(manifestPath).size > 1024 * 1024) throw new Error("Invalid manifest file");
  if (fileDigest(manifestPath) !== expectedManifestSha256.toLowerCase()) throw new Error("Manifest digest mismatch");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(manifest.version) || /[. ]$/.test(manifest.version)) throw new Error("Invalid release version");
  assertWindowsRelativePath(manifest.version);
  if (!/^[a-f0-9]{40}$/i.test(manifest.sourceCommit) || manifest.nodeMajor !== 20) throw new Error("Release must bind an exact source commit and Node 20");
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 10_000) throw new Error("Release manifest requires a bounded nonempty file list");
  const members = new Set();
  for (const file of manifest.files) {
    const parts = assertWindowsRelativePath(file.path);
    const folded = file.path.toLowerCase();
    if (members.has(folded)) throw new Error("Case-insensitive duplicate release member");
    members.add(folded);
    if (!/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 512 * 1024 * 1024) throw new Error("Invalid release member digest or size");
    let member = root;
    for (const [index, part] of parts.entries()) {
      member = path.join(member, part);
      const stat = fs.lstatSync(member);
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error("Release symlink/reparse or non-file member rejected");
    }
    if (fs.statSync(member).size !== file.size || fileDigest(member) !== file.sha256.toLowerCase()) throw new Error(`Release member digest/size mismatch: ${file.path}`);
  }
  // Copying unlisted payloads would bypass the digest boundary.
  function inspect(relative) {
    const names = new Set();
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      assertWindowsRelativePath(rel);
      if (names.has(entry.name.toLowerCase())) throw new Error("Case-insensitive release path collision");
      names.add(entry.name.toLowerCase());
      if (entry.isSymbolicLink()) throw new Error("Release symlink/reparse member rejected");
      if (entry.isDirectory()) inspect(rel);
      else if (!entry.isFile() || !members.has(rel.toLowerCase())) throw new Error(`Unlisted release member: ${rel}`);
    }
  }
  inspect("");
  return { schemaVersion: 1, version: manifest.version, sourceCommit: manifest.sourceCommit, nodeMajor: 20, files: manifest.files.map(({ path: memberPath, sha256, size }) => ({ path: memberPath, sha256: sha256.toLowerCase(), size })) };
}

module.exports = { validateRelease, assertWindowsRelativePath };
if (require.main === module) {
  try {
    if (process.versions.node.split(".")[0] !== "20") throw new Error("Release validation requires Node 20");
    if (process.argv.length !== 5) throw new Error("Usage: node verify-release.cjs RELEASE_DIRECTORY MANIFEST_PATH MANIFEST_SHA256");
    process.stdout.write(JSON.stringify(validateRelease(process.argv[2], process.argv[3], process.argv[4])));
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
