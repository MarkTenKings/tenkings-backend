const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { createServer } = require("node:http");
const { fetchReferenceBytes, fetchReferenceJson } = require("../dist/reference/request");

let server;
let origin;
before(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/ok": return res.end("12345678");
      case "/json": return res.end('{"ok":true}');
      case "/bad-json": return res.end("{");
      case "/large-header": res.writeHead(200, { "Content-Length": 9 }); return res.end("123456789");
      case "/large-chunks": res.write("1234"); return res.end("56789");
      case "/body-stall": res.writeHead(200); res.write("1"); return;
      case "/header-stall": return;
      default: res.writeHead(503); return res.end("unavailable");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test("bounded requests accept exact-size bytes and parse bounded JSON", async () => {
  assert.equal((await fetchReferenceBytes(`${origin}/ok`, { maxBytes: 8 })).toString(), "12345678");
  assert.deepEqual(await fetchReferenceJson(`${origin}/json`), { ok: true });
  await assert.rejects(fetchReferenceJson(`${origin}/bad-json`), SyntaxError);
  await assert.rejects(fetchReferenceBytes(`${origin}/unavailable`), /Reference request failed/);
});

test("advertised and chunked response sizes both enforce the byte cap", async () => {
  for (const path of ["large-header", "large-chunks"]) {
    await assert.rejects(fetchReferenceBytes(`${origin}/${path}`, { maxBytes: 8 }), /byte limit/);
  }
});

test("deadline covers stalled headers and stalled streamed bodies", { timeout: 3000 }, async () => {
  for (const path of ["header-stall", "body-stall"]) {
    await assert.rejects(fetchReferenceBytes(`${origin}/${path}`, { timeoutMs: 40 }), { name: "AbortError" });
  }
});

test("parent cancellation stops a body read and pre-aborted work never fetches", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40);
  try {
    await assert.rejects(fetchReferenceBytes(`${origin}/body-stall`, { signal: controller.signal }), { name: "AbortError" });
  } finally {
    clearTimeout(timer);
  }
  await assert.rejects(fetchReferenceBytes("http://should-never-be-contacted.invalid", { signal: controller.signal }), { name: "AbortError" });
});
