const test = require("node:test");
const assert = require("node:assert/strict");
const {
  publishOfferToWhip,
  WhipPublishError,
} = require("../dist/whipPublisher");

function createPeerConnection(overrides = {}) {
  const peerConnection = {
    localDescription: null,
    remoteDescription: null,
    async createOffer() {
      return {
        type: "offer",
        sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=tenkings\r\n",
      };
    },
    async setLocalDescription(description) {
      this.localDescription = description;
    },
    async setRemoteDescription(description) {
      this.remoteDescription = description;
    },
    ...overrides,
  };

  return peerConnection;
}

test("publishOfferToWhip posts the local SDP and applies the remote answer", async () => {
  const peerConnection = createPeerConnection();
  const fetchCalls = [];

  const result = await publishOfferToWhip({
    whipUrl: "https://mux.example/whip",
    peerConnection,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 201,
        async text() {
          return "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=mux-answer\r\n";
        },
        headers: {
          get(name) {
            return name.toLowerCase() === "location"
              ? "https://mux.example/resource/123"
              : null;
          },
        },
      };
    },
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://mux.example/whip");
  assert.equal(fetchCalls[0].init.method, "POST");
  assert.equal(fetchCalls[0].init.headers["Content-Type"], "application/sdp");
  assert.equal(fetchCalls[0].init.body, peerConnection.localDescription.sdp);
  assert.deepEqual(peerConnection.remoteDescription, {
    type: "answer",
    sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=mux-answer",
  });
  assert.equal(result.answerSdp, "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=mux-answer");
  assert.equal(result.resourceUrl, "https://mux.example/resource/123");
});

test("publishOfferToWhip fails when the local SDP is missing", async () => {
  const peerConnection = createPeerConnection({
    async createOffer() {
      return { type: "offer", sdp: "" };
    },
    async setLocalDescription() {
      this.localDescription = { type: "offer", sdp: "" };
    },
  });

  await assert.rejects(
    publishOfferToWhip({
      whipUrl: "https://mux.example/whip",
      peerConnection,
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      },
    }),
    (error) => {
      assert.equal(error instanceof WhipPublishError, true);
      assert.equal(error.code, "WHIP_MISSING_LOCAL_SDP");
      return true;
    },
  );
});

test("publishOfferToWhip surfaces non-2xx WHIP responses", async () => {
  const peerConnection = createPeerConnection();

  await assert.rejects(
    publishOfferToWhip({
      whipUrl: "https://mux.example/whip",
      peerConnection,
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        async text() {
          return "bad gateway";
        },
        headers: {
          get() {
            return null;
          },
        },
      }),
    }),
    (error) => {
      assert.equal(error instanceof WhipPublishError, true);
      assert.equal(error.code, "WHIP_REQUEST_FAILED");
      assert.equal(error.status, 502);
      return true;
    },
  );
});
