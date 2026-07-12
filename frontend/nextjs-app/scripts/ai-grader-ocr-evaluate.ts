import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateAiGraderOcrCases,
  parseAiGraderOcrEvaluationCase,
} from "../lib/server/aiGraderOcrEvaluation";

type EvaluationManifest = {
  schemaVersion: "ai-grader-ocr-evaluation-manifest-v1";
  cases: Array<{
    id: string;
    groundTruthFile: string;
    resultFile: string;
  }>;
};

function safeManifestPath(root: string, candidate: unknown) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error("Evaluation manifest file references must be non-empty relative paths.");
  }
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Evaluation manifest file references must remain inside the private corpus directory.");
  }
  return resolved;
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function main() {
  const manifestArg = process.argv[2];
  if (!manifestArg) {
    throw new Error("Usage: pnpm ocr:evaluate -- <external-private-manifest.json>");
  }
  const manifestPath = path.resolve(manifestArg);
  const corpusRoot = path.dirname(manifestPath);
  const rawManifest = await readJson(manifestPath);
  if (!rawManifest || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
    throw new Error("AI Grader OCR evaluation manifest must be an object.");
  }
  const manifest = rawManifest as Partial<EvaluationManifest>;
  if (manifest.schemaVersion !== "ai-grader-ocr-evaluation-manifest-v1" || !Array.isArray(manifest.cases)) {
    throw new Error("AI Grader OCR evaluation manifest version or cases are invalid.");
  }
  const seenIds = new Set<string>();
  const cases = [];
  for (const entry of manifest.cases) {
    if (!entry || typeof entry.id !== "string" || !entry.id.trim() || seenIds.has(entry.id)) {
      throw new Error("Evaluation manifest case IDs must be unique non-empty strings.");
    }
    seenIds.add(entry.id);
    cases.push(parseAiGraderOcrEvaluationCase({
      groundTruth: await readJson(safeManifestPath(corpusRoot, entry.groundTruthFile)),
      result: await readJson(safeManifestPath(corpusRoot, entry.resultFile)),
    }));
  }
  process.stdout.write(`${JSON.stringify(evaluateAiGraderOcrCases(cases), null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "AI Grader OCR evaluation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
