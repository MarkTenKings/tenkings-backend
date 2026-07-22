const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  MATHEMATICAL_CALIBRATION_V1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_PAGE_HTML,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML,
} = require("../dist/drivers/mathematicalCalibrationV1_1Page");

function assertRenderedInlineScriptsCompile(html, pageName) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, `${pageName} must render at least one inline script`);
  for (const [index, match] of scripts.entries()) {
    assert.doesNotThrow(
      () => new vm.Script(match[1], { filename: `${pageName}-inline-${index + 1}.js` }),
      `${pageName} rendered inline script ${index + 1} must compile`,
    );
  }
}

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createPairingHarness(html, { storedToken, pairingCode, fetchImpl }) {
  const scriptMatch = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, "operator page must contain an inline script");
  const instrumented = scriptMatch[1].replace(
    /\bconnect\(\);\s*\}\)\(\);\s*$/,
    "globalThis.__testPair = pair;\n})();",
  );
  assert.notEqual(instrumented, scriptMatch[1], "pairing test must disable automatic preview connection");

  const tokenKey = "ten-kings-mathematical-calibration-bridge-token";
  const storage = new Map([["unrelated-browser-state", "must-remain"]]);
  if (storedToken) storage.set(tokenKey, storedToken);
  const storageCalls = [];
  const fetchCalls = [];
  const historyCalls = [];
  const consoleCalls = [];
  const elements = new Map();
  const canvasContext = {
    beginPath() {}, closePath() {}, drawImage() {}, lineTo() {}, moveTo() {}, restore() {},
    save() {}, setLineDash() {}, stroke() {}, strokeRect() {},
  };
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, textContent: "", className: "", width: 1200, height: 1680,
      addEventListener() {}, getContext: () => canvasContext,
    });
    return elements.get(id);
  };
  const sessionQuery = "?sessionId=pairing-regression-session";
  const hash = pairingCode ? `#aiGraderBridgePair=${encodeURIComponent(pairingCode)}` : "";
  const location = {
    href: `http://127.0.0.1:47653/calibration/page${sessionQuery}${hash}`,
    hash,
    pathname: "/calibration/page",
    search: sessionQuery,
  };
  const context = vm.createContext({
    AbortController, Blob, TextDecoder, Uint8Array, URL,
    Image: class {},
    console: new Proxy({}, { get: (_target, method) => (...args) => consoleCalls.push({ method, args }) }),
    decodeURIComponent,
    document: { getElementById: element },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return fetchImpl(url, options, fetchCalls.length);
    },
    history: { replaceState: (...args) => historyCalls.push(args) },
    localStorage: {
      clear: () => { throw new Error("calibration pairing must not clear unrelated browser storage"); },
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => { storageCalls.push({ operation: "remove", key }); storage.delete(key); },
      setItem: (key, value) => { storageCalls.push({ operation: "set", key, value }); storage.set(key, value); },
    },
    location,
    setInterval: () => 1,
    setTimeout: () => 1,
  });
  new vm.Script(instrumented, { filename: "calibration-pairing-inline.js" }).runInContext(context);
  assert.equal(typeof context.__testPair, "function");
  return { consoleCalls, context, elements, fetchCalls, historyCalls, location, storage, storageCalls, tokenKey };
}

const pairingPages = [
  ["V1.0.1", MATHEMATICAL_CALIBRATION_V1_PAGE_HTML],
  ["V1.1", MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML],
];

for (const [pageName, html] of pairingPages) {
  test(`${pageName} validates and accepts a valid stored calibration token`, async () => {
    const storedToken = `${pageName}-stored-valid-secret`;
    const harness = createPairingHarness(html, {
      storedToken,
      fetchImpl: (url, options) => {
        assert.equal(url, "/preview/status");
        assert.equal(options.method, undefined, "token validation must be a read-only GET");
        assert.equal(options.headers["X-AI-Grader-Station-Token"], storedToken);
        assert.equal(options.cache, "no-store");
        return response(200, { result: { status: "stopped" } });
      },
    });
    assert.equal(await harness.context.__testPair(), true);
    assert.equal(harness.fetchCalls.length, 1);
    assert.deepEqual(harness.storageCalls, []);
    assert.equal(harness.storage.get(harness.tokenKey), storedToken);
    assert.equal(harness.storage.get("unrelated-browser-state"), "must-remain");
    assert.deepEqual(harness.historyCalls, []);
    assert.deepEqual(harness.consoleCalls, []);
  });

  test(`${pageName} replaces only a stale calibration token through one verified fresh pairing`, async () => {
    const staleToken = `${pageName}-stale-secret`;
    const pairingCode = `${pageName}-fresh-pairing-secret`;
    const replacementToken = `${pageName}-replacement-secret`;
    const harness = createPairingHarness(html, {
      storedToken: staleToken,
      pairingCode,
      fetchImpl: (url, options, callNumber) => {
        if (callNumber === 1) {
          assert.equal(url, "/preview/status");
          assert.equal(options.method, undefined);
          assert.equal(options.headers["X-AI-Grader-Station-Token"], staleToken);
          return response(401);
        }
        if (callNumber === 2) {
          assert.equal(url, "/pair");
          assert.equal(options.method, "POST");
          assert.deepEqual(JSON.parse(options.body), { pairingCode });
          return response(200, { result: { stationToken: replacementToken } });
        }
        assert.equal(callNumber, 3);
        assert.equal(url, "/preview/status");
        assert.equal(options.method, undefined);
        assert.equal(options.headers["X-AI-Grader-Station-Token"], replacementToken);
        return response(200, { result: { status: "stopped" } });
      },
    });
    assert.equal(await harness.context.__testPair(), true);
    assert.equal(harness.fetchCalls.length, 3, "replacement token must be verified before it is stored");
    assert.deepEqual(harness.storageCalls, [
      { operation: "remove", key: harness.tokenKey },
      { operation: "set", key: harness.tokenKey, value: replacementToken },
    ]);
    assert.equal(harness.storage.get("unrelated-browser-state"), "must-remain");
    assert.deepEqual(harness.historyCalls, [[null, "", harness.location.pathname + harness.location.search]]);
    const visibleOutput = JSON.stringify({
      consoleCalls: harness.consoleCalls,
      historyCalls: harness.historyCalls,
      message: harness.elements.get("message")?.textContent ?? "",
      requestUrls: harness.fetchCalls.map((call) => call.url),
    });
    assert.doesNotMatch(visibleOutput, new RegExp(staleToken));
    assert.doesNotMatch(visibleOutput, new RegExp(pairingCode));
    assert.doesNotMatch(visibleOutput, new RegExp(replacementToken));
  });

  test(`${pageName} fails closed on a stale token without a fresh launcher code`, async () => {
    const staleToken = `${pageName}-stale-without-code`;
    const harness = createPairingHarness(html, {
      storedToken: staleToken,
      fetchImpl: (url, options) => {
        assert.equal(url, "/preview/status");
        assert.equal(options.headers["X-AI-Grader-Station-Token"], staleToken);
        return response(401);
      },
    });
    assert.equal(await harness.context.__testPair(), false);
    assert.equal(harness.storage.get(harness.tokenKey), staleToken, "a stale token is removed only when a fresh pairing code exists");
    assert.equal(harness.storage.get("unrelated-browser-state"), "must-remain");
    assert.deepEqual(harness.storageCalls, []);
    assert.deepEqual(harness.historyCalls, []);
    assert.match(harness.elements.get("message").textContent, /protected .*launcher/i);
  });

  test(`${pageName} preserves the fresh fragment and stores no token when pairing is rejected`, async () => {
    const pairingCode = `${pageName}-rejected-pairing-secret`;
    const harness = createPairingHarness(html, {
      pairingCode,
      fetchImpl: (url, options) => {
        assert.equal(url, "/pair");
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), { pairingCode });
        return response(401);
      },
    });
    await assert.rejects(harness.context.__testPair(), /Protected bridge pairing failed/);
    assert.equal(harness.fetchCalls.length, 1, "pairing rejection must not loop or begin token verification");
    assert.equal(harness.storage.has(harness.tokenKey), false);
    assert.equal(harness.storage.get("unrelated-browser-state"), "must-remain");
    assert.deepEqual(harness.storageCalls, []);
    assert.deepEqual(harness.historyCalls, [], "fragment removal is permitted only after verified success");
    assert.equal(harness.location.hash, `#aiGraderBridgePair=${encodeURIComponent(pairingCode)}`);
    assert.deepEqual(harness.consoleCalls, []);
  });

  test(`${pageName} stores nothing and keeps the fragment when a returned pairing token is unauthorized`, async () => {
    const pairingCode = `${pageName}-unverified-pairing-secret`;
    const replacementToken = `${pageName}-unverified-replacement-secret`;
    const harness = createPairingHarness(html, {
      pairingCode,
      fetchImpl: (url, options, callNumber) => {
        if (callNumber === 1) {
          assert.equal(url, "/pair");
          return response(200, { result: { stationToken: replacementToken } });
        }
        assert.equal(callNumber, 2);
        assert.equal(url, "/preview/status");
        assert.equal(options.method, undefined);
        assert.equal(options.headers["X-AI-Grader-Station-Token"], replacementToken);
        return response(401);
      },
    });
    await assert.rejects(harness.context.__testPair(), /returned an unauthorized token/);
    assert.equal(harness.fetchCalls.length, 2);
    assert.equal(harness.storage.has(harness.tokenKey), false);
    assert.equal(harness.storage.get("unrelated-browser-state"), "must-remain");
    assert.deepEqual(harness.storageCalls, []);
    assert.deepEqual(harness.historyCalls, []);
    assert.equal(harness.location.hash, `#aiGraderBridgePair=${encodeURIComponent(pairingCode)}`);
    assert.deepEqual(harness.consoleCalls, []);
  });
}

test("rendered V1.0.1 and V1.1 operator-page inline scripts compile", () => {
  assertRenderedInlineScriptsCompile(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, "mathematical-calibration-v1.0.1");
  assertRenderedInlineScriptsCompile(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, "mathematical-calibration-v1.1");
});

test("V1.0.1 operator page acknowledges only the exact displayed MJPEG frame and exposes no capture authority", () => {
  assert.equal(MATHEMATICAL_CALIBRATION_V1_PAGE_PATH, "/calibration/mathematical-v1");
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Station-Token/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Mathematical-Calibration-Session-Id/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /nextCaptureSlot/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /poseProgress/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /acceptedCaptureHistory/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /failedAttempts/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /Advisory positioning only/i);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /Reconnect fresh preview epoch/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Session-Id/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Preview-Epoch/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Frame-Id/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Captured-At/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /\/calibration\/mathematical-v1\/displayed-frame/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /body:JSON\.stringify\(frame\)/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /const imageUrl=URL\.createObjectURL/);
  assert.equal(
    (MATHEMATICAL_CALIBRATION_V1_PAGE_HTML.match(/URL\.revokeObjectURL\(imageUrl\)/g) ?? []).length,
    3,
    "each preview Blob URL must be revoked for superseded load, displayed load, or error",
  );
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /context\.drawImage\(image.*URL\.revokeObjectURL\(imageUrl\).*acknowledgeDisplayedFrame\(identity\)/s);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /\/capture["']/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /capture-authorization/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /JSON\.stringify\([^)]*(operationId|targetFace|sampleIndex|channelIndex|acceptanceResult)/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /stationToken=/i);
});

test("calibration-only page is bridge-served, paired without URL token, and renders the required overlay fields", () => {
  assert.equal(MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH, "/calibration/mathematical-v1.1");
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /X-AI-Grader-Station-Token/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /X-AI-Grader-Mathematical-Calibration-Session-Id/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /preview\/stream/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /location\.hash\.match\(\/\(\?:\^\|\[#&\]\)aiGraderBridgePair=/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /outerContour/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /sufficientlyDistinct/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /stationToken=/i);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /token=.*location\.search/i);
});
