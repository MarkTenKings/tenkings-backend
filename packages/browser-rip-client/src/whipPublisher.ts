export interface WhipPeerConnection {
  localDescription: RTCSessionDescriptionInit | null;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
}

export interface WhipPublishOptions {
  whipUrl: string;
  peerConnection: WhipPeerConnection;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export interface WhipPublishResult {
  answerSdp: string;
  resourceUrl: string | null;
}

export type WhipPublishErrorCode =
  | "WHIP_MISSING_FETCH"
  | "WHIP_MISSING_LOCAL_SDP"
  | "WHIP_REQUEST_FAILED"
  | "WHIP_INVALID_ANSWER";

export class WhipPublishError extends Error {
  code: WhipPublishErrorCode;
  status?: number;

  constructor(code: WhipPublishErrorCode, message: string, status?: number) {
    super(message);
    this.name = "WhipPublishError";
    this.code = code;
    this.status = status;
  }
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof fetch === "function") {
    return fetch;
  }

  throw new WhipPublishError(
    "WHIP_MISSING_FETCH",
    "WHIP publishing requires a fetch implementation.",
  );
}

function resolveOfferSdp(
  offer: RTCSessionDescriptionInit,
  peerConnection: WhipPeerConnection,
): string {
  const localSdp = peerConnection.localDescription?.sdp ?? offer.sdp;
  if (!localSdp || !localSdp.trim()) {
    throw new WhipPublishError(
      "WHIP_MISSING_LOCAL_SDP",
      "Unable to publish to WHIP because the local SDP offer is empty.",
    );
  }

  return localSdp;
}

export async function publishOfferToWhip({
  whipUrl,
  peerConnection,
  fetchImpl,
  headers,
}: WhipPublishOptions): Promise<WhipPublishResult> {
  const effectiveFetch = resolveFetch(fetchImpl);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const offerSdp = resolveOfferSdp(offer, peerConnection);
  const response = await effectiveFetch(whipUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      ...headers,
    },
    body: offerSdp,
  });

  if (!response.ok) {
    throw new WhipPublishError(
      "WHIP_REQUEST_FAILED",
      `WHIP publish failed with status ${response.status}.`,
      response.status,
    );
  }

  const answerSdp = (await response.text()).trim();
  if (!answerSdp) {
    throw new WhipPublishError(
      "WHIP_INVALID_ANSWER",
      "WHIP publish succeeded but the SDP answer was empty.",
      response.status,
    );
  }

  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: answerSdp,
  });

  return {
    answerSdp,
    resourceUrl: response.headers.get("location"),
  };
}
