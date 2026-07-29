import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { aiGraderReportBundleV03Schema } from "@tenkings/shared";
import { parseBody } from "next/dist/server/api-utils/node/parse-body";
import {
  buildStrictAiGraderMathematicalReleaseV1Fixture,
  buildStrictAiGraderReportBundleV03Fixture,
} from "./fixtures/strictAiGraderReportBundleV03";

const MEBIBYTE = 1024 * 1024;
const PRODUCTION_REQUEST_BYTES = Math.round(2.71 * MEBIBYTE);
const routeSource = readFileSync(
  new URL("../pages/api/admin/ai-grader/production/[...action].ts", import.meta.url),
  "utf8",
);

test("Production create-card-from-report parser accepts the current 2.71 MiB envelope under an explicit 4 MiB bound", async () => {
  const configuredLimit = routeSource.match(/bodyParser:\s*\{\s*sizeLimit:\s*"([^"]+)"/)?.[1];
  assert.equal(configuredLimit, "4mb");

  const reportBundle = buildStrictAiGraderReportBundleV03Fixture();
  reportBundle.geometry = {
    ...(reportBundle.geometry ?? {}),
    productionTransportPadding: "",
  };
  const productionRelease =
    buildStrictAiGraderMathematicalReleaseV1Fixture(reportBundle);
  const payload = {
    queueItemId: "production-payload-limit-rapid-card",
    publicationStatus: "finalized",
    reportBundle,
    productionRelease,
    identity: {
      category: "tcg",
      playerName: "",
      year: "2022",
      manufacturer: "The Pokemon Company",
      sport: "",
      game: "Pokemon",
      productSet: "Pokemon GO",
      cardNumber: "017/078",
    },
  };
  const unpaddedBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const paddingBytes = PRODUCTION_REQUEST_BYTES - unpaddedBytes;
  assert.ok(paddingBytes > 0);
  reportBundle.geometry.productionTransportPadding = "x".repeat(paddingBytes);

  assert.equal(aiGraderReportBundleV03Schema.safeParse(reportBundle).success, true);
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  assert.equal(bodyBytes, PRODUCTION_REQUEST_BYTES);
  assert.ok(bodyBytes > MEBIBYTE);
  assert.ok(bodyBytes < 4 * MEBIBYTE);

  const request = Readable.from([Buffer.from(body, "utf8")]) as Readable & {
    headers: IncomingMessage["headers"];
    method: string;
    url: string;
  };
  request.headers = {
    "content-type": "application/json",
    "content-length": String(bodyBytes),
  };
  request.method = "POST";
  request.url =
    "/api/admin/ai-grader/production/create-card-from-report";

  const parsed = await parseBody(
    request as unknown as IncomingMessage,
    configuredLimit,
  );
  assert.equal(parsed.queueItemId, payload.queueItemId);
  assert.equal(parsed.reportBundle.reportId, reportBundle.reportId);
  assert.equal(parsed.productionRelease.reportId, productionRelease.reportId);
  assert.equal(Buffer.byteLength(JSON.stringify(parsed), "utf8"), bodyBytes);
});
