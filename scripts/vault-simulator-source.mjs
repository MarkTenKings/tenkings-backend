import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Candidate provenance for disposable simulation only. This is not a release
 * signature and deliberately cannot satisfy the physical certification SHA gate. */
export function simulatorSourceIdentity(rootPath, manifestPath) {
  const root = realpathSync(rootPath);
  if (!manifestPath) {
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    assert.match(baseCommit, /^[a-f0-9]{40}$/);
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
    return { sourceCommit: dirty ? "UNCOMMITTED_CANDIDATE" : baseCommit, baseCommit, sourceState: dirty ? "UNCOMMITTED_CANDIDATE" : "CLEAN_CHECKOUT" };
  }
  const manifestBytes = readFileSync(resolve(manifestPath));
  assert.ok(manifestBytes.length <= 1024 * 1024, "Candidate manifest is too large");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceState, "UNCOMMITTED_CANDIDATE");
  assert.match(manifest.baseCommit, /^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 2000);
  const seen = new Set();
  for (const file of manifest.files) {
    assert.ok(typeof file.path === "string" && file.path.length <= 512 && !isAbsolute(file.path) && !file.path.includes("\\"));
    const parts = file.path.split("/");
    assert.ok(parts.every((part) => part && part !== "." && part !== ".."), "Unsafe candidate path");
    assert.ok(!seen.has(file.path), "Duplicate candidate path");
    seen.add(file.path);
    let path = root;
    for (const part of parts) {
      path = resolve(path, part);
      assert.ok(!lstatSync(path).isSymbolicLink(), "Candidate source must not contain symlinks");
    }
    const info = lstatSync(path);
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 64 * 1024 * 1024 && info.isFile() && info.size === file.size, "Candidate file size/type mismatch");
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(readFileSync(path)), file.sha256, `Candidate file changed: ${file.path}`);
  }
  const sourceManifestSha256 = sha256(manifestBytes);
  return { sourceCommit: `CANDIDATE_SHA256:${sourceManifestSha256}`, baseCommit: manifest.baseCommit, sourceState: "UNCOMMITTED_CANDIDATE", sourceManifestSha256 };
}
