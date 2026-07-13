using System.Text.Json.Serialization;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Replay;

public sealed record ReplayManifest(
    string SchemaVersion,
    int Seed,
    string CorpusKind,
    IReadOnlyList<ReplayCaseSpec> Cases,
    IReadOnlyList<string> MissingRealCorpusCategories);

public sealed record ReplayCaseSpec(
    string Id,
    string PairId,
    CardSide Side,
    string Category,
    bool ExpectedCard,
    string Polarity,
    double RotationDegrees,
    double Perspective,
    double TranslationX,
    double TranslationY,
    double Clipping,
    double BorderContrast,
    IReadOnlyList<string> Effects,
    long PreviewEpoch,
    long SideEpoch,
    string? FrozenOf,
    string? PrivateFile,
    string? PermittedSha256,
    int SensorRotationDegrees = 0,
    bool MirrorHorizontal = false,
    bool MirrorVertical = false,
    string SequenceKind = "stable",
    int FrameCount = 5,
    double MotionStepX = 0,
    double MotionStepY = 0,
    bool? ExpectedReady = null,
    IReadOnlyList<PointD>? GroundTruthCorners = null);

public sealed record GeneratedReplayFrame(Mono8Frame Frame, IReadOnlyList<PointD>? GroundTruthCorners);

public sealed record ReplayCaseResult(
    string CaseId,
    string PairId,
    CardSide Side,
    string Category,
    DetectorMode Mode,
    bool CardPresent,
    bool ExpectedDetection,
    bool ExpectedReady,
    GeometryStatus Status,
    GeometryReasonCode Reason,
    bool Detected,
    bool Ready,
    double Confidence,
    double? MeanCornerErrorPixels,
    double ProcessingMs,
    bool Frozen,
    bool SafetyExpectationMet,
    int FramesEvaluated,
    int DetectedFrames,
    int QualifiedFrames,
    int ReadyFrames,
    int? FirstReadyFrame,
    bool MotionResetObserved,
    bool EpochResetObserved,
    bool FrozenResetObserved,
    bool OldEpochReadyObserved,
    bool RemovalFenceObserved);

public sealed record DetectorAggregate(
    DetectorMode Mode,
    int Cases,
    int ExpectedCards,
    int Negatives,
    int TruePositive,
    int FalsePositive,
    int TrueNegative,
    int FalseNegative,
    int FalseDetection,
    int FalseReady,
    double Recall,
    double Precision,
    double ReadyRecall,
    double ReadyPrecision,
    double P50ProcessingMs,
    double P95ProcessingMs,
    double? MeanCornerErrorPixels);

public sealed record ReplayReport(
    string SchemaVersion,
    string DetectorVersion,
    string DecisionDigest,
    string CorpusKind,
    bool SyntheticOnly,
    string AccuracyDisclaimer,
    int Seed,
    IReadOnlyList<string> MissingRealCorpusCategories,
    IReadOnlyList<DetectorAggregate> Aggregates,
    IReadOnlyList<ReplayCaseResult> Cases)
{
    [JsonIgnore]
    public int TotalEvaluations => Cases.Count;
}
