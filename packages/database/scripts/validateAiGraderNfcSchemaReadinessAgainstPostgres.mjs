#!/usr/bin/env node

import { createRequire } from "node:module";
import { sanitizeAiGraderNfcValidationOutput } from "./aiGraderNfcValidationRedaction.mjs";
import {
  assertDisposableDatabaseTarget,
  requireValidationProof,
} from "./aiGraderNfcValidationSafety.mjs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const {
  readAiGraderNfcSchemaReadiness,
} = require("../dist/database/src/aiGraderNfcSchemaReadiness");

const mode = process.argv.find((argument) => argument.startsWith("--expect="))?.slice("--expect=".length);
requireValidationProof(mode === "absent" || mode === "ready", "READINESS_EXPECTATION_REQUIRED");
assertDisposableDatabaseTarget({
  acknowledgement: process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION,
  databaseUrl: process.env.DATABASE_URL,
  expectedUser: "tenkings_nfc_validation",
  expectedDatabase: "tenkings_ai_grader_nfc_validation",
});

const prisma = new PrismaClient();
try {
  try {
    const result = await readAiGraderNfcSchemaReadiness(prisma);
    requireValidationProof(result?.ready === (mode === "ready"), "READINESS_RESULT_MISMATCH");
    console.log(
      mode === "ready"
        ? "AI_GRADER_NFC_SCHEMA_READY_RUNTIME_VALIDATION_PASS"
        : "AI_GRADER_NFC_SCHEMA_ABSENT_RUNTIME_VALIDATION_PASS",
    );
  } finally {
    await prisma.$disconnect();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "AI_GRADER_NFC_VALIDATION_UNKNOWN_FAILURE";
  console.error(`AI_GRADER_NFC_SCHEMA_RUNTIME_VALIDATION_FAILED: ${sanitizeAiGraderNfcValidationOutput(message)}`);
  process.exitCode = 1;
}
