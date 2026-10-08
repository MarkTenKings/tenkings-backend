import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const windows = resolve(process.cwd(), "../../packages/vault-machine/windows");
const { validateRelease, assertWindowsRelativePath } = require(join(windows, "verify-release.cjs"));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Windows source release staging boundary", () => {
  it("rejects traversal, device names, controls and invalid Windows components", () => {
    for (const name of ["../file", "/file", "C:/x", "x\\y", "NUL.txt", "COM1", "lpt³.bin", "CON .txt", "CONIN$", "conout$.json", "clock$", "x./a", "x /a", "x:stream", "a?b", "x\u0000", "a//b"]) expect(() => assertWindowsRelativePath(name), name).toThrow();
    expect(assertWindowsRelativePath("dist/cli.js")).toEqual(["dist", "cli.js"]);
  });

  it("requires a trusted manifest digest and verifies every copied byte, rejecting extras and links", () => {
    const fixture = mkdtempSync(join(tmpdir(), "vault-release-test-"));
    const release = join(fixture, "release");
    mkdirSync(join(release, "dist"), { recursive: true });
    const payload = "verified-source";
    writeFileSync(join(release, "dist", "cli.js"), payload);
    const manifest = { schemaVersion: 1, version: "1.0.0", sourceCommit: "a".repeat(40), nodeMajor: 20, files: [{ path: "dist/cli.js", sha256: hash(payload), size: Buffer.byteLength(payload) }] };
    const manifestPath = join(fixture, "manifest.json");
    const save = () => { const text = JSON.stringify(manifest); writeFileSync(manifestPath, text); return hash(text); };
    try {
      let digest = save();
      expect(validateRelease(release, manifestPath, digest).files).toHaveLength(1);
      expect(() => validateRelease(release, manifestPath, "0".repeat(64))).toThrow(/Manifest digest/);
      writeFileSync(join(release, "unlisted.exe"), "extra");
      expect(() => validateRelease(release, manifestPath, digest)).toThrow(/Unlisted/);
      rmSync(join(release, "unlisted.exe"));
      manifest.version = "../../current"; digest = save();
      expect(() => validateRelease(release, manifestPath, digest)).toThrow(/version/);
      manifest.version = "1.0.0"; manifest.files.push({ ...manifest.files[0] }); digest = save();
      expect(() => validateRelease(release, manifestPath, digest)).toThrow(/duplicate/);
      manifest.files.pop(); digest = save();
      writeFileSync(join(release, "dist", "cli.js"), "tampered");
      expect(() => validateRelease(release, manifestPath, digest)).toThrow(/digest\/size/);
      rmSync(join(release, "dist", "cli.js"));
      symlinkSync(manifestPath, join(release, "dist", "cli.js"));
      expect(() => validateRelease(release, manifestPath, digest)).toThrow(/symlink/);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it("source scripts cannot stop/restart services, replace current or activate a rollback", () => {
    const install = readFileSync(join(windows, "install.ps1"), "utf8");
    const update = readFileSync(join(windows, "update.ps1"), "utf8");
    const rollback = readFileSync(join(windows, "rollback.ps1"), "utf8");
    expect(install).toContain("Copy-Item -LiteralPath $source");
    expect(install).not.toMatch(/Copy-Item.*\*/);
    expect(`${install}\n${update}\n${rollback}`).not.toMatch(/(?:Stop|Start|Restart)-Service|Rename-Item|ItemType Junction|Remove-Item/i);
    expect(update).toContain("if ($Activate) { throw");
    expect(rollback).toContain("throw 'Rollback activation is not implemented");
    expect(readFileSync(join(windows, "vault-machine-service.xml"), "utf8")).toContain('<arguments>"%BASE%\\current\\dist\\cli.js"</arguments>');
  });
});
