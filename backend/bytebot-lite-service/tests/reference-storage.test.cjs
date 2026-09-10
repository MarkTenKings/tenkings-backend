const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createServer } = require("node:http");
const { createSpacesUploader } = require("../dist/storage/spaces");

test("reference cancellation terminates a real S3 SDK request to a stalled loopback service", { timeout: 3000 }, async () => {
  const seen = [];
  let received;
  const requestReceived = new Promise((resolve) => { received = resolve; });
  const server = createServer((req) => {
    seen.push(req.url);
    req.resume();
    received();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const testEnv = {
    SPACES_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    SPACES_REGION: "synthetic", SPACES_BUCKET: "synthetic",
    SPACES_ACCESS_KEY_ID: "synthetic", SPACES_SECRET_ACCESS_KEY: "synthetic",
    SPACES_BASE_URL: "https://synthetic.invalid", SPACES_PREFIX: "test",
  };
  const previous = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));
  Object.assign(process.env, testEnv);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const upload = createSpacesUploader();
    const pending = upload(Buffer.from("fixture"), "reference/crop.jpg", "image/jpeg", controller.signal);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await requestReceived;
    controller.abort();
    await rejected;
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^\/synthetic\/test\/reference\/crop\.jpg/);
  } finally {
    controller.abort();
    clearTimeout(timer);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
