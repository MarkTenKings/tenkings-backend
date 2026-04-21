import { publishOfferToWhip, type WhipPeerConnection } from "./whipPublisher";

export type RipStage =
  | "idle"
  | "permissions"
  | "ready"
  | "countdown"
  | "live"
  | "reveal"
  | "complete"
  | "error";

export interface RipClientConfig {
  sessionId: string;
  whipUrl: string;
  revealVideoUrl: string;
  countdownSeconds: number;
  liveSeconds: number;
  overlayTitle: string;
  onStageChange: (stage: RipStage) => void;
  onError: (error: RipError) => void;
  onReactionBlob: (blob: Blob) => void;
}

export interface RipError {
  code:
    | "PERMISSIONS_DENIED"
    | "NO_CAMERA"
    | "NO_MIC"
    | "WHIP_FAILED"
    | "REVEAL_VIDEO_FAILED"
    | "UNKNOWN";
  message: string;
  recoverable: boolean;
}

function buildStreamConstraints(): MediaStreamConstraints {
  return {
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: true,
  };
}

function mapBrowserError(error: unknown): RipError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return {
      code: "PERMISSIONS_DENIED",
      message: "Camera and microphone permissions are required to continue.",
      recoverable: true,
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "NO_CAMERA",
      message: "No compatible camera and microphone were found on this device.",
      recoverable: true,
    };
  }

  return {
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "Unknown browser rip error.",
    recoverable: true,
  };
}

export class BrowserRipClient {
  private readonly config: RipClientConfig;
  private stage: RipStage = "idle";
  private mediaStream: MediaStream | null = null;
  private previewElement: HTMLVideoElement | null = null;
  private compositeElement: HTMLCanvasElement | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaChunks: Blob[] = [];

  constructor(config: RipClientConfig) {
    this.config = config;
  }

  async requestPermissions(): Promise<void> {
    this.setStage("permissions");

    try {
      const devices = navigator.mediaDevices;
      if (!devices?.getUserMedia) {
        throw new Error("getUserMedia is not available in this browser.");
      }

      this.mediaStream = await devices.getUserMedia(buildStreamConstraints());
      this.syncPreview();
      this.setStage("ready");
    } catch (error) {
      this.handleError(mapBrowserError(error));
      throw error;
    }
  }

  async start(): Promise<void> {
    try {
      if (!this.mediaStream) {
        await this.requestPermissions();
      }

      if (!this.mediaStream) {
        throw new Error("Browser rip media stream was not initialized.");
      }

      if (typeof RTCPeerConnection !== "function") {
        throw new Error("RTCPeerConnection is not available in this browser.");
      }

      this.peerConnection = new RTCPeerConnection();
      for (const track of this.mediaStream.getTracks()) {
        this.peerConnection.addTrack(track, this.mediaStream);
      }

      this.startReactionRecorder(this.mediaStream);
      await publishOfferToWhip({
        whipUrl: this.config.whipUrl,
        peerConnection: this.peerConnection as WhipPeerConnection,
      });

      // Countdown/live/reveal orchestration lands in later steps. The skeleton
      // starts capture + publish and leaves stage choreography to callers.
      this.setStage("countdown");
    } catch (error) {
      if (this.stage !== "error") {
        this.handleError({
          code: "WHIP_FAILED",
          message: error instanceof Error ? error.message : "Failed to publish via WHIP.",
          recoverable: true,
        });
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const recorder = this.mediaRecorder as MediaRecorder;
        recorder.addEventListener(
          "stop",
          () => {
            const reactionBlob = new Blob(this.mediaChunks, {
              type: recorder.mimeType || "video/webm",
            });
            if (reactionBlob.size > 0) {
              this.config.onReactionBlob(reactionBlob);
            }
            resolve();
          },
          { once: true },
        );
        recorder.stop();
      });
    }

    this.mediaRecorder = null;
    this.mediaChunks = [];

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    this.setStage("complete");
  }

  attachPreview(element: HTMLVideoElement): void {
    this.previewElement = element;
    this.syncPreview();
  }

  attachComposite(element: HTMLCanvasElement): void {
    this.compositeElement = element;
  }

  private syncPreview(): void {
    if (!this.previewElement || !this.mediaStream) {
      return;
    }

    this.previewElement.srcObject = this.mediaStream;
    this.previewElement.muted = true;
    this.previewElement.playsInline = true;
    void this.previewElement.play().catch(() => undefined);
  }

  private startReactionRecorder(stream: MediaStream): void {
    if (typeof MediaRecorder !== "function") {
      return;
    }

    this.mediaChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";

    this.mediaRecorder = mimeType
      ? new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2_500_000,
        })
      : new MediaRecorder(stream);

    this.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.mediaChunks.push(event.data);
      }
    });

    this.mediaRecorder.start();
  }

  private setStage(stage: RipStage): void {
    this.stage = stage;
    this.config.onStageChange(stage);
  }

  private handleError(error: RipError): void {
    this.stage = "error";
    this.config.onStageChange("error");
    this.config.onError(error);
  }
}
