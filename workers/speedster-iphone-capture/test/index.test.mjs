import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleCapture } from "../src/index.mjs";

const API = "https://collect.tenkings.co/api/ai-grader-v2/iphone-capture";
const DEVICE_ID = "device-12345678901234567890";

function captureRequest() {
  const form = new FormData();
  form.set("deviceId", DEVICE_ID);
  form.set("front", new File(["front"], "front.jpg", { type: "image/jpeg" }));
  form.set("back", new File(["back"], "back.jpg", { type: "image/jpeg" }));
  return new Request("https://relay.example", { method: "POST", body: form });
}

test("relays one photo pair through PLAN, parallel PUTs, and COMPLETE", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const call = { url: String(url), method: init.method, body: init.body };
    calls.push(call);
    if (url === API && calls.filter((item) => item.url === API).length === 1) {
      return Response.json({
        uploadVersion: 7,
        frontUploadUrl: "https://spaces.example/front",
        backUploadUrl: "https://spaces.example/back",
      });
    }
    if (String(url).startsWith("https://spaces.example/")) return new Response(null, { status: 200 });
    return Response.json({ readyVersion: 7 });
  };

  const response = await handleCapture(captureRequest(), fetcher);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { readyVersion: 7 });
  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(calls[0].body), { action: "PLAN", deviceId: DEVICE_ID });
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[2].method, "PUT");
  assert.deepEqual(JSON.parse(calls[3].body), {
    action: "COMPLETE",
    deviceId: DEVICE_ID,
    uploadVersion: 7,
  });
});

test("rejects anything except one complete multipart photo pair", async () => {
  const method = await handleCapture(new Request("https://relay.example"), async () => {
    throw new Error("not called");
  });
  const form = new FormData();
  form.set("deviceId", DEVICE_ID);
  const incomplete = await handleCapture(
    new Request("https://relay.example", { method: "POST", body: form }),
    async () => { throw new Error("not called"); },
  );

  assert.equal(method.status, 405);
  assert.equal(incomplete.status, 400);
});

test("Cloudflare runtime arguments are not mistaken for the fetch function", async () => {
  const response = await worker.fetch(new Request("https://relay.example"), {}, {});

  assert.equal(response.status, 405);
});

test("returns PLAN and COMPLETE failures honestly", async () => {
  const planFailure = await handleCapture(captureRequest(), async () => (
    Response.json({ message: "Pair this iPhone with Speedster" }, { status: 404 })
  ));
  let apiCalls = 0;
  const completeFailure = await handleCapture(captureRequest(), async (url) => {
    if (url === API && ++apiCalls === 1) {
      return Response.json({
        uploadVersion: 8,
        frontUploadUrl: "https://spaces.example/front",
        backUploadUrl: "https://spaces.example/back",
      });
    }
    if (String(url).startsWith("https://spaces.example/")) return new Response(null, { status: 200 });
    return Response.json({ message: "This capture is no longer active" }, { status: 409 });
  });

  assert.equal(planFailure.status, 404);
  assert.equal(completeFailure.status, 409);
  assert.deepEqual(await completeFailure.json(), { message: "This capture is no longer active" });
});

test("does not mark a pair complete when either upload fails", async () => {
  let apiCalls = 0;
  const response = await handleCapture(captureRequest(), async (url) => {
    if (url === API) {
      apiCalls += 1;
      if (apiCalls > 1) throw new Error("COMPLETE must not be called");
      return Response.json({
        uploadVersion: 9,
        frontUploadUrl: "https://spaces.example/front",
        backUploadUrl: "https://spaces.example/back",
      });
    }
    if (url === "https://spaces.example/front") return new Response(null, { status: 500 });
    return new Response(null, { status: 200 });
  });

  assert.equal(response.status, 502);
  assert.equal(await response.text(), "Upload failed (front 500, back 200)");
  assert.equal(apiCalls, 1);
});
