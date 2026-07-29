import type { AiGraderLocalMathematicalAssetSet } from "./aiGraderLocalMathematicalReport";

export type AiGraderLocalReportBusyClaim = {
  readonly kind: "open-report";
  readonly sequence: number;
};

export class AiGraderLocalReportBusyOwner {
  private sequence = 0;
  private current?: AiGraderLocalReportBusyClaim;

  claim(): AiGraderLocalReportBusyClaim {
    const claim = {
      kind: "open-report" as const,
      sequence: ++this.sequence,
    };
    this.current = claim;
    return claim;
  }

  release(
    claim: AiGraderLocalReportBusyClaim | undefined,
    busy: string | null,
  ): string | null {
    if (!claim || this.current !== claim) return busy;
    this.current = undefined;
    return busy === "open-report" ? null : busy;
  }
}

export type AiGraderLocalReportLoad = {
  readonly epoch: number;
  readonly identityKey: string;
  readonly abortController: AbortController;
  readonly busyClaim: AiGraderLocalReportBusyClaim;
};

export class AiGraderLocalReportLifecycle {
  private epoch = 0;
  private identityKey: string | null = null;
  private load?: AiGraderLocalReportLoad;
  private readyAssets?: AiGraderLocalMathematicalAssetSet;

  constructor(
    private readonly revokeAssets: (
      assets: AiGraderLocalMathematicalAssetSet,
    ) => void,
  ) {}

  private resetResources(): AiGraderLocalReportBusyClaim | undefined {
    const retiredClaim = this.load?.busyClaim;
    this.load?.abortController.abort();
    this.load = undefined;
    if (this.readyAssets) this.revokeAssets(this.readyAssets);
    this.readyAssets = undefined;
    return retiredClaim;
  }

  begin(
    identityKey: string,
    busyClaim: AiGraderLocalReportBusyClaim,
  ): {
    load: AiGraderLocalReportLoad;
    retiredClaim?: AiGraderLocalReportBusyClaim;
  } {
    const retiredClaim = this.resetResources();
    this.identityKey = identityKey;
    const load = {
      epoch: ++this.epoch,
      identityKey,
      abortController: new AbortController(),
      busyClaim,
    };
    this.load = load;
    return { load, ...(retiredClaim ? { retiredClaim } : {}) };
  }

  switchIdentity(nextIdentityKey: string | null): {
    changed: boolean;
    retiredClaim?: AiGraderLocalReportBusyClaim;
  } {
    if (nextIdentityKey === this.identityKey) return { changed: false };
    const retiredClaim = this.resetResources();
    this.identityKey = nextIdentityKey;
    this.epoch += 1;
    return { changed: true, ...(retiredClaim ? { retiredClaim } : {}) };
  }

  close(): { retiredClaim?: AiGraderLocalReportBusyClaim } {
    const retiredClaim = this.resetResources();
    this.epoch += 1;
    return retiredClaim ? { retiredClaim } : {};
  }

  isCurrent(load: AiGraderLocalReportLoad, identityKey: string | null): boolean {
    return (
      this.load === load &&
      this.epoch === load.epoch &&
      this.identityKey === load.identityKey &&
      identityKey === load.identityKey &&
      !load.abortController.signal.aborted
    );
  }

  adoptAssets(
    load: AiGraderLocalReportLoad,
    assets: AiGraderLocalMathematicalAssetSet,
  ): boolean {
    if (!this.isCurrent(load, load.identityKey)) {
      this.revokeAssets(assets);
      return false;
    }
    if (this.readyAssets) this.revokeAssets(this.readyAssets);
    this.readyAssets = assets;
    return true;
  }

  finish(
    load: AiGraderLocalReportLoad,
  ): AiGraderLocalReportBusyClaim | undefined {
    if (this.load !== load || this.epoch !== load.epoch) return undefined;
    this.load = undefined;
    return load.busyClaim;
  }
}
