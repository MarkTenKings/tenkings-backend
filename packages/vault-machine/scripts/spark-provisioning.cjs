#!/usr/bin/env node
"use strict";
// Offline only: consumes non-secret identity/configuration and optional authority files.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { buildSparkProvisioning, compareSparkCloudBinding, checkSparkSecretPresence, verifySparkPromotion, SPARK_PROMOTION_EVIDENCE } = require("../dist/spark-provisioning.js");
function read(file, limit = 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > limit || info.nlink !== 1) throw new Error("SPARK_PROVISIONING_UNSAFE_INPUT_FILE");
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) throw new Error("SPARK_PROVISIONING_UNSAFE_INPUT_FILE");
    return bytes;
  } finally { fs.closeSync(fd); }
}
function main(args) {
  const [command, inputPath, ...rest] = args;
  if (!["validate", "generate", "compare", "check-secrets", "verify-promotion"].includes(command) || !inputPath) throw new Error("SPARK_PROVISIONING_ARGUMENTS_INVALID");
  const input = JSON.parse(read(inputPath)), plan = buildSparkProvisioning(input);
  if (command === "check-secrets") { if (rest.length) throw new Error("SPARK_PROVISIONING_ARGUMENTS_INVALID"); return checkSparkSecretPresence(process.env, plan.stage); }
  if (command === "compare") { if (rest.length !== 1) throw new Error("SPARK_PROVISIONING_ARGUMENTS_INVALID"); return compareSparkCloudBinding(input, JSON.parse(read(rest[0]))); }
  if (command === "verify-promotion") {
    if (rest.length !== 3) throw new Error("SPARK_PROVISIONING_ARGUMENTS_INVALID");
    const evidence = Object.fromEntries(SPARK_PROMOTION_EVIDENCE.map(kind => [kind, crypto.createHash("sha256").update(read(path.join(rest[2], `${kind}.evidence`), 16 * 1024 * 1024)).digest("hex")]));
    return verifySparkPromotion(input, JSON.parse(read(rest[0])), read(rest[1], 16384).toString("utf8"), evidence);
  }
  if (command === "generate") {
    if (rest.length !== 1) throw new Error("SPARK_PROVISIONING_ARGUMENTS_INVALID");
    const output = path.resolve(rest[0]);
    fs.mkdirSync(output, { mode: 0o700 });
    for (const [name, value] of Object.entries({ "local-profile.json": plan.localProfile, "cloud-bindings.json": plan.cloudBindings,
      "cloud-environment.disabled.json": plan.cloudEnvironment, "provisioning-plan.json": plan })) {
      const fd = fs.openSync(path.join(output, name), "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const fd = fs.openSync(output, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } else if (rest.length) throw new Error("SPARK_PROVISIONING_ARGUMENTS_INVALID");
  // Identities and configuration stay in private output files; stdout has only safe hashes/status.
  return { valid: true, stage: plan.stage, configurationDigest: plan.configurationDigest, bindingDigest: plan.bindingDigest,
    methodProfileDigest: plan.methodProfileDigest, activationAllowed: false, networkRequests: 0 };
}
if (require.main === module) {
  if (process.argv.length === 2 || process.argv[2] === "--help") {
    process.stdout.write("Offline Spark provisioning: validate INPUT | generate INPUT NEW_DIRECTORY | compare INPUT CLOUD_BINDINGS | check-secrets INPUT | verify-promotion INPUT APPROVAL PUBLIC_KEY EVIDENCE_DIRECTORY\n");
    process.exit(0);
  }
  try { process.umask(0o077); const result = main(process.argv.slice(2)); process.stdout.write(JSON.stringify(result) + "\n"); if (result.ready === false) process.exitCode = 1; }
  catch (error) { process.stderr.write(/^SPARK_PROVISIONING_[A-Z_]+$/.test(error.message) ? error.message + "\n" : "SPARK_PROVISIONING_FAILED: inspect input paths and non-secret configuration locally\n"); process.exitCode = 1; }
}
module.exports = { main };
