import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("Speedster image publication waits for every protected evidence gate", () => {
  const workflow = readFileSync(`${repositoryRoot}/.github/workflows/ci.yml`, "utf8");
  const releaseJob = workflow.split("  speedster-tested-release-image:")[1]?.split("\n  docker-images:")[0] ?? "";

  assert.match(releaseJob, /needs:\s*\n\s*- quality\s*\n\s*- disposable-postgres-migration-chain\s*\n\s*- speedster-frontend-tests/);
  assert.match(releaseJob, /if: github\.event_name == 'push'[\s\S]*docker push/);
  assert.match(releaseJob, /\$\{GITHUB_SHA\}-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(releaseJob, /image_name="ghcr\.io\/\$\{IMAGE_REPOSITORY\}-speedster-v2"/);
  assert.match(releaseJob, /org\.opencontainers\.image\.source=\$\{GITHUB_SERVER_URL\}\/\$\{GITHUB_REPOSITORY\}/);
  assert.match(releaseJob, /org\.opencontainers\.image\.revision=\$\{GITHUB_SHA\}/);
  assert.doesNotMatch(releaseJob, /\$\{IMAGE_REPOSITORY\}\/ai-grader-speedster-service/);
  assert.doesNotMatch(releaseJob, /image="\$\{image_name\}:\$\{GITHUB_SHA\}"/);
});

test("Speedster release artifacts are pinned, signed, attested, and verified by digest", () => {
  const workflow = readFileSync(`${repositoryRoot}/.github/workflows/ci.yml`, "utf8");
  const releaseJob = workflow.split("  speedster-tested-release-image:")[1]?.split("\n  docker-images:")[0] ?? "";
  const dockerfile = readFileSync(
    `${repositoryRoot}/backend/ai-grader-speedster-service/Dockerfile`,
    "utf8",
  );

  assert.doesNotMatch(workflow, /uses:\s+[^\s#]+@(v\d|main|master)\b/);

  for (const action of [
    "actions/checkout",
    "anchore/sbom-action",
    "docker/login-action",
    "sigstore/cosign-installer",
    "actions/attest-build-provenance",
  ]) {
    assert.match(releaseJob, new RegExp(`${action}@[a-f0-9]{40}`));
  }
  assert.match(releaseJob, /cosign sign --yes "\$\{SPEEDSTER_IMAGE_NAME\}@\$\{digest\}"/);
  assert.match(
    releaseJob,
    /timeout 120s cosign verify [\s\S]*"\$\{SPEEDSTER_IMAGE_NAME\}@\$\{digest\}" > \/dev\/null/,
  );
  assert.match(releaseJob, /timeout 120s cosign verify-attestation --type spdxjson/);
  assert.match(
    releaseJob,
    /cosign verify-attestation[\s\S]*"\$\{SPEEDSTER_IMAGE_NAME\}@\$\{digest\}" > \/dev\/null/,
  );
  assert.match(releaseJob, /subject-digest: \$\{\{ env\.SPEEDSTER_IMAGE_DIGEST \}\}/);
  assert.match(dockerfile, /^ARG PYTHON_BASE_IMAGE=python@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /^ARG SAM3_CHECKPOINT_REVISION=[a-f0-9]{40}$/m);
  assert.match(dockerfile, /^ARG SAM3_CHECKPOINT_SHA256=[a-f0-9]{64}$/m);
});
