const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const repositoryRoot = path.resolve(__dirname, "..", "..", "..");
const analyzerRelativePath = "scripts/ai-grader/analyze-mathematical-calibration-v1.py";
const expectedSha256 = "4387cfacd2193e326f06e5cb461d478d293cb1c9e62449ec1c8c28b1c17eb201";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("analyzer authority bytes are LF-canonical and reproduce from a disposable Git archive", async () => {
  const attributes = fs.readFileSync(path.join(repositoryRoot, ".gitattributes"), "utf8");
  assert.match(attributes, /^scripts\/ai-grader\/analyze-mathematical-calibration-v1\.py text eol=lf$/m);
  const analyzerPath = path.join(repositoryRoot, ...analyzerRelativePath.split("/"));
  const workingBytes = fs.readFileSync(analyzerPath);
  assert.equal(workingBytes.includes(Buffer.from("\r\n")), false, "CRLF or mixed-EOL analyzer bytes must fail even when Git normalization would report clean");
  assert.equal(sha256(workingBytes), expectedSha256);
  const indexBytes = execFileSync("git", ["show", `:${analyzerRelativePath}`], { cwd: repositoryRoot, maxBuffer: 2 * 1024 * 1024 });
  assert.deepEqual(workingBytes, indexBytes, "working analyzer bytes must equal the exact LF-canonical index bytes");

  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-analyzer-portable-archive-"));
  try {
    const tree = execFileSync("git", ["write-tree"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    const archivePath = path.join(temporary, "portable-analyzer.tar");
    execFileSync("git", ["archive", "--format=tar", `--output=${archivePath}`, tree, "--", analyzerRelativePath], { cwd: repositoryRoot });
    execFileSync("tar", ["-xf", archivePath, "-C", temporary], { cwd: repositoryRoot });
    const archivedBytes = fs.readFileSync(path.join(temporary, ...analyzerRelativePath.split("/")));
    assert.deepEqual(archivedBytes, workingBytes);
    assert.equal(sha256(archivedBytes), expectedSha256);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});
