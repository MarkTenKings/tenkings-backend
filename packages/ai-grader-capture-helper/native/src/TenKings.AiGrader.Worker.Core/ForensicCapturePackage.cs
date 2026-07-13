using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TenKings.AiGrader.Worker.Core;

public sealed class ForensicCapturePackage : IAsyncDisposable
{
    private const string PackageSchema = "tenkings.ai-grader.forensic-side-package.v1";
    private const string OwnerSchema = "tenkings.ai-grader.forensic-staging-owner.v1";
    private const string OwnerFileName = ".tenkings-owner.json";
    private const string LeaseFileName = ".tenkings-lease.lock";
    private const string ManifestFileName = "manifest.json";
    private const string StagePrefix = ".tk-native-stage-v1-";
    private const string CoordinationPrefix = ".tk-native-capture-v1-";

    private static readonly JsonSerializerOptions CanonicalJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private readonly string _sessionSha256;
    private readonly string _captureSha256;
    private readonly string _sideName;
    private readonly string _packageId;
    private readonly string _stagingPath;
    private readonly string _finalPath;
    private readonly string _quarantineRoot;
    private readonly string _coordinationLockPath;
    private readonly string _ownerNonce;
    private readonly ForensicSidePlan _plan;
    private readonly string _planSha256;
    private readonly List<ForensicArtifact> _artifacts = new(ForensicRoles.Required.Count);
    private FileStream? _stagingLease;
    private bool _committed;
    private bool _disposed;

    internal Func<CancellationToken, ValueTask>? AtomicRenameReadyTestHook { get; set; }

    private ForensicCapturePackage(
        string sessionSha256,
        string captureSha256,
        string sideName,
        string packageId,
        string stagingPath,
        string finalPath,
        string quarantineRoot,
        string coordinationLockPath,
        FileStream stagingLease,
        string ownerNonce,
        ForensicSidePlan plan,
        string planSha256)
    {
        _sessionSha256 = sessionSha256;
        _captureSha256 = captureSha256;
        _sideName = sideName;
        _packageId = packageId;
        _stagingPath = stagingPath;
        _finalPath = finalPath;
        _quarantineRoot = quarantineRoot;
        _coordinationLockPath = coordinationLockPath;
        _stagingLease = stagingLease;
        _ownerNonce = ownerNonce;
        _plan = plan;
        _planSha256 = planSha256;
    }

    public string PackageId => _packageId;
    public string CapturePlanSha256 => _planSha256;
    public IReadOnlyList<ForensicArtifact> Artifacts => _artifacts.AsReadOnly();
    internal bool FinalPackageExistsForTest => Directory.Exists(_finalPath);
    internal bool StagingDirectoryExistsForTest => Directory.Exists(_stagingPath);

    internal static async ValueTask<ForensicCapturePackage> CreateAsync(
        string outputRoot,
        string sessionId,
        ForensicSidePlan plan,
        CancellationToken cancellationToken)
    {
        ForensicPlanValidator.Validate(plan);
        ValidateIdentifier(sessionId, 128, "session ID");
        var sideName = SideName(plan.Side);
        var sessionSha256 = HashText(sessionId);
        var captureSha256 = HashText(plan.CaptureId);
        var packageId = $"{captureSha256}.{sideName}";
        var packagesRoot = ContainedPath(outputRoot, "native-evidence-v1");
        var sessionRoot = ContainedPath(packagesRoot, sessionSha256);
        var stagingRoot = ContainedPath(sessionRoot, ".staging");
        var quarantineRoot = ContainedPath(sessionRoot, ".quarantine");
        Directory.CreateDirectory(stagingRoot);
        Directory.CreateDirectory(quarantineRoot);

        var coordinationLockPath = ContainedPath(
            stagingRoot,
            $"{CoordinationPrefix}{captureSha256}-{sideName}.lock");
        using var coordinationLease = AcquireCoordinationLease(coordinationLockPath);
        var liveTransactionExists = ReconcileOwnedOrphans(
            stagingRoot,
            quarantineRoot,
            sessionSha256,
            captureSha256,
            sideName,
            cancellationToken);
        if (liveTransactionExists)
        {
            throw new IOException("A forensic package transaction is already active for this capture and side.");
        }

        var ownerNonce = Guid.NewGuid().ToString("N");
        var stageName = $"{StagePrefix}{captureSha256}-{sideName}-{ownerNonce}";
        var stagingPath = ContainedPath(stagingRoot, stageName);
        if (Directory.Exists(stagingPath))
        {
            throw new IOException("Forensic staging collision.");
        }

        Directory.CreateDirectory(stagingPath);
        FileStream? stagingLease = null;
        var finalPath = ContainedPath(sessionRoot, packageId);
        var planBytes = CreatePlanBytes(plan, sessionSha256, captureSha256);
        var planSha256 = HashBytes(planBytes);
        var ownerBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = OwnerSchema,
            sessionSha256,
            captureSha256,
            side = sideName,
            ownerNonce,
            capturePlanSha256 = planSha256,
        }, CanonicalJson);

        try
        {
            stagingLease = AcquireNewStagingLease(stagingPath);
            await WriteNewDurableAsync(Path.Combine(stagingPath, OwnerFileName), ownerBytes, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            stagingLease?.Dispose();
            Directory.Delete(stagingPath, recursive: true);
            throw;
        }

        return new ForensicCapturePackage(
            sessionSha256,
            captureSha256,
            sideName,
            packageId,
            stagingPath,
            finalPath,
            quarantineRoot,
            coordinationLockPath,
            stagingLease ?? throw new InvalidOperationException("Forensic staging lease was not acquired."),
            ownerNonce,
            plan,
            planSha256);
    }

    public async ValueTask<ForensicArtifact> StageRoleAsync(
        string role,
        CameraFrame frame,
        double grabMilliseconds,
        CancellationToken cancellationToken)
    {
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        frame.Validate();
        if (_artifacts.Count >= ForensicRoles.Required.Count ||
            !string.Equals(role, ForensicRoles.Required[_artifacts.Count], StringComparison.Ordinal))
        {
            throw new InvalidDataException("Forensic roles must be staged once in canonical order.");
        }

        if (_artifacts.Any(artifact => string.Equals(artifact.FrameId, frame.FrameId, StringComparison.Ordinal)) ||
            (frame.BlockId is not null && _artifacts.Any(artifact => string.Equals(artifact.BlockId, frame.BlockId, StringComparison.Ordinal))))
        {
            throw new InvalidDataException("Forensic frame and BlockID identities must be distinct.");
        }

        var extension = _plan.Profile == ForensicCaptureProfile.FullForensic ? ".png" : ".tiff";
        var mimeType = _plan.Profile == ForensicCaptureProfile.FullForensic ? "image/png" : "image/tiff";
        var fileName = $"{role}{extension}";
        var finalRolePath = Path.Combine(_stagingPath, fileName);
        var temporaryPath = Path.Combine(_stagingPath, $".{fileName}.{Guid.NewGuid():N}.tmp");
        if (File.Exists(finalRolePath))
        {
            throw new IOException("Forensic staging role already exists.");
        }

        var writeStart = MonotonicClock.NowTicks;
        var bytes = _plan.Profile == ForensicCaptureProfile.FullForensic
            ? LosslessMono8Encoder.EncodePng(frame)
            : LosslessMono8Encoder.EncodeTiff(frame);
        var hashStart = MonotonicClock.NowTicks;
        var sha256 = HashBytes(bytes);
        var hashMilliseconds = MonotonicClock.ElapsedMilliseconds(hashStart);
        try
        {
            await WriteNewDurableAsync(temporaryPath, bytes, cancellationToken).ConfigureAwait(false);
            await ValidateStoredArtifactAsync(temporaryPath, sha256, bytes.LongLength, mimeType, frame.Width, frame.Height, frame, cancellationToken).ConfigureAwait(false);
            File.Move(temporaryPath, finalRolePath, overwrite: false);
            await ValidateStoredArtifactAsync(finalRolePath, sha256, bytes.LongLength, mimeType, frame.Width, frame.Height, frame, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }

            throw;
        }

        var artifact = new ForensicArtifact(
            role,
            fileName,
            sha256,
            bytes.LongLength,
            mimeType,
            frame.Width,
            frame.Height,
            frame.FrameId,
            frame.BlockId,
            frame.HardwareTimestampTicks,
            frame.ReceiveTimestampUtc,
            grabMilliseconds,
            MonotonicClock.ElapsedMilliseconds(writeStart),
            hashMilliseconds);
        ValidateArtifactIdentity(artifact, role, frame);
        _artifacts.Add(artifact);
        return artifact;
    }

    public async ValueTask<ForensicPackageCommitResult> CommitAsync(
        ForensicPackageBinding binding,
        GeometryResult authoritativeAllOnGeometry,
        ForensicTransformProvenance authoritativeTransform,
        CancellationToken cancellationToken)
    {
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        ValidateBinding(binding);
        ValidateCompleteArtifacts();
        ValidateAuthority(binding, authoritativeAllOnGeometry, authoritativeTransform);

        var payloadBytes = CreateManifestPayload(binding, authoritativeAllOnGeometry, authoritativeTransform);
        using var payloadDocument = JsonDocument.Parse(payloadBytes);
        var canonicalPayloadBytes = JsonSerializer.SerializeToUtf8Bytes(payloadDocument.RootElement, CanonicalJson);
        var packageSha256 = HashBytes(canonicalPayloadBytes);
        var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = PackageSchema,
            packageSha256,
            payload = payloadDocument.RootElement,
        }, CanonicalJson);
        var manifestSha256 = HashBytes(manifestBytes);

        if (Directory.Exists(_finalPath))
        {
            using var coordinationLease = AcquireCoordinationLease(_coordinationLockPath);
            await ValidateExistingPackageAsync(_finalPath, packageSha256, manifestSha256, cancellationToken).ConfigureAwait(false);
            ReleaseStagingLease(deleteLeaseFile: true);
            await DeleteIncompleteOwnedStagingAsync().ConfigureAwait(false);
            _committed = true;
            return new ForensicPackageCommitResult(_packageId, packageSha256, manifestSha256, _planSha256, true, Artifacts);
        }

        var manifestPath = Path.Combine(_stagingPath, ManifestFileName);
        await WriteNewDurableAsync(manifestPath, manifestBytes, cancellationToken).ConfigureAwait(false);
        var persistedManifest = await File.ReadAllBytesAsync(manifestPath, cancellationToken).ConfigureAwait(false);
        if (!persistedManifest.AsSpan().SequenceEqual(manifestBytes) || HashBytes(persistedManifest) != manifestSha256)
        {
            throw new InvalidDataException("Forensic manifest failed durable reread verification.");
        }

        using var commitCoordinationLease = AcquireCoordinationLease(_coordinationLockPath);
        if (Directory.Exists(_finalPath))
        {
            await ValidateExistingPackageAsync(_finalPath, packageSha256, manifestSha256, cancellationToken).ConfigureAwait(false);
            ReleaseStagingLease(deleteLeaseFile: true);
            await QuarantineCurrentStagingAsync().ConfigureAwait(false);
            _committed = true;
            return new ForensicPackageCommitResult(_packageId, packageSha256, manifestSha256, _planSha256, true, Artifacts);
        }

        RemoveStagingOnlyMetadataForCommit();
        await ValidateExistingPackageAsync(_stagingPath, packageSha256, manifestSha256, cancellationToken).ConfigureAwait(false);
        var committedResult = new ForensicPackageCommitResult(
            _packageId,
            packageSha256,
            manifestSha256,
            _planSha256,
            false,
            Artifacts);
        if (AtomicRenameReadyTestHook is not null)
        {
            await AtomicRenameReadyTestHook(cancellationToken).ConfigureAwait(false);
        }
        cancellationToken.ThrowIfCancellationRequested();

        // This same-volume rename is the sole commit point. Every validation,
        // allocation, staging-metadata removal, and cancellation check is
        // complete before it. Once it succeeds, no fallible/cancellable I/O is
        // performed that could report failure while leaving a newly visible
        // final package.
        Directory.Move(_stagingPath, _finalPath);
        _committed = true;
        return committedResult;
    }

    public async ValueTask AbortAsync()
    {
        if (_disposed || _committed)
        {
            _disposed = true;
            return;
        }

        using var coordinationLease = AcquireCoordinationLease(_coordinationLockPath);
        ReleaseStagingLease(deleteLeaseFile: true);
        if (!Directory.Exists(_stagingPath))
        {
            _disposed = true;
            return;
        }

        if (File.Exists(Path.Combine(_stagingPath, ManifestFileName)))
        {
            await QuarantineCurrentStagingAsync().ConfigureAwait(false);
        }
        else
        {
            await DeleteIncompleteOwnedStagingAsync().ConfigureAwait(false);
        }

        _disposed = true;
    }

    public ValueTask DisposeAsync() => AbortAsync();

    private void EnsureActive()
    {
        if (_disposed || _committed || _stagingLease is null || !Directory.Exists(_stagingPath))
        {
            throw new InvalidOperationException("Forensic package transaction is no longer active.");
        }
    }

    private void ValidateCompleteArtifacts()
    {
        if (_artifacts.Count != ForensicRoles.Required.Count)
        {
            throw new InvalidDataException("Forensic package is incomplete.");
        }

        for (var index = 0; index < ForensicRoles.Required.Count; index++)
        {
            if (!string.Equals(_artifacts[index].Role, ForensicRoles.Required[index], StringComparison.Ordinal))
            {
                throw new InvalidDataException("Forensic package roles are missing, duplicated, or out of order.");
            }
        }

        if (_artifacts.Select(artifact => artifact.FrameId).Distinct(StringComparer.Ordinal).Count() != _artifacts.Count)
        {
            throw new InvalidDataException("Forensic package reused a frame identity.");
        }

        if (_artifacts.Any(artifact => string.IsNullOrWhiteSpace(artifact.BlockId)))
        {
            throw new InvalidDataException("Forensic package is missing a required BlockID.");
        }

        var blockIds = _artifacts.Select(artifact => artifact.BlockId!).ToArray();
        if (blockIds.Distinct(StringComparer.Ordinal).Count() != blockIds.Length)
        {
            throw new InvalidDataException("Forensic package reused a BlockID.");
        }
    }

    private void ValidateAuthority(
        ForensicPackageBinding binding,
        GeometryResult geometry,
        ForensicTransformProvenance transform)
    {
        var allOn = _artifacts.Single(artifact => artifact.Role == "all_on");
        if (geometry.Status != "ready" || geometry.ReasonCodes.Count != 1 || geometry.ReasonCodes[0] != "none" ||
            geometry.Side != _plan.Side || geometry.Epochs != _plan.Epochs ||
            !string.Equals(geometry.FrameId, allOn.FrameId, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(allOn.BlockId) || string.IsNullOrWhiteSpace(geometry.BlockId) ||
            !string.Equals(geometry.BlockId, allOn.BlockId, StringComparison.Ordinal) ||
            geometry.SourceWidth != allOn.Width || geometry.SourceHeight != allOn.Height ||
            geometry.NormalizedWidth != 1200 || geometry.NormalizedHeight != 1680 ||
            geometry.CalibrationId != binding.CalibrationId || geometry.CalibrationSha256 != binding.CalibrationSha256 ||
            geometry.SensorOrientation is null ||
            geometry.SensorOrientation.SensorToPortraitRotationDegrees != binding.Orientation.SensorToPortraitRotationDegrees ||
            geometry.SensorOrientation.MirrorHorizontal != binding.Orientation.MirrorHorizontal ||
            geometry.SensorOrientation.MirrorVertical != binding.Orientation.MirrorVertical ||
            geometry.SensorOrientation.SupportsMirrorHorizontal != binding.Orientation.SupportsMirrorHorizontal ||
            geometry.SensorOrientation.SupportsMirrorVertical != binding.Orientation.SupportsMirrorVertical ||
            !geometry.CurrentFrameAuthority.NormalizationSafe || !geometry.CurrentFrameAuthority.CaptureReady ||
            geometry.CurrentFrameAuthority.RejectionCodes.Count != 0 ||
            geometry.Stale || geometry.Frozen || !geometry.Metrics.FullVisibility ||
            !double.IsFinite(geometry.Confidence) || geometry.Confidence < 0.70 ||
            !double.IsFinite(geometry.Metrics.AspectRatio) || !double.IsFinite(geometry.Metrics.Coverage) ||
            !double.IsFinite(geometry.Metrics.ClearanceFraction) || !double.IsFinite(geometry.Metrics.PerspectiveSkew) ||
            geometry.Metrics.AspectRatio is < 1.18 or > 1.72 ||
            geometry.Metrics.Coverage is < 0.12 or > 0.88 || geometry.Metrics.ClearanceFraction < 0.008 ||
            geometry.Metrics.PerspectiveSkew > 0.36 || geometry.Metrics.Edges.Count != 4 ||
            geometry.Metrics.Edges.Any(edge =>
                !double.IsFinite(edge.GradientSupport) || edge.GradientSupport < 0.30 ||
                !double.IsFinite(edge.Continuity) || edge.Continuity < 0.34 ||
                !double.IsFinite(edge.Residual) || edge.Residual is < 0 or > 12) ||
            geometry.SourceCorners.Count != 4 || geometry.NormalizedCorners.Count != 4 ||
            geometry.FittedLines.Count != 4 || geometry.SourceToNormalizedHomography.Count != 9 ||
            geometry.SourceCorners.Any(point => !double.IsFinite(point.X) || !double.IsFinite(point.Y)) ||
            geometry.NormalizedCorners.Any(point => !double.IsFinite(point.X) || !double.IsFinite(point.Y)) ||
            geometry.FittedLines.Any(line => !double.IsFinite(line.A) || !double.IsFinite(line.B) || !double.IsFinite(line.C)) ||
            !CornersAreOrderedConvex(geometry.SourceCorners) || !CornersAreOrderedConvex(geometry.NormalizedCorners) ||
            !CornersAreInsideSourceFrame(geometry.SourceCorners, allOn.Width, allOn.Height) ||
            !PhysicalLongEdgeMapsToHeight(geometry.SourceCorners) || !NormalizedCornersMatchContract(geometry.NormalizedCorners) ||
            !LinesMatchCorners(geometry.FittedLines, geometry.SourceCorners) ||
            !IsNonsingularHomography(geometry.SourceToNormalizedHomography) ||
            !HomographyMapsCorners(geometry.SourceToNormalizedHomography, geometry.SourceCorners, geometry.NormalizedCorners))
        {
            throw new InvalidDataException("Forensic package authority is unsafe or incoherent.");
        }

        if (transform.SourceRole != "all_on" ||
            !string.Equals(transform.SourceFrameId, allOn.FrameId, StringComparison.Ordinal) ||
            !string.Equals(transform.SourceSha256, allOn.Sha256, StringComparison.Ordinal) ||
            transform.SourceWidth != allOn.Width || transform.SourceHeight != allOn.Height ||
            transform.NormalizedWidth != 1200 || transform.NormalizedHeight != 1680 ||
            !transform.Homography.SequenceEqual(geometry.SourceToNormalizedHomography) ||
            !transform.ReusedByRoles.SequenceEqual(ForensicRoles.Required.Skip(2), StringComparer.Ordinal))
        {
            throw new InvalidDataException("Forensic transform provenance is not bound to all_on.");
        }
    }

    private static bool CornersAreInsideSourceFrame(IReadOnlyList<PointD> corners, int width, int height) =>
        width > 0 && height > 0 && corners.Count == 4 && corners.All(point =>
            double.IsFinite(point.X) && double.IsFinite(point.Y) &&
            point.X >= 0 && point.X <= width - 1 &&
            point.Y >= 0 && point.Y <= height - 1);

    private byte[] CreateManifestPayload(
        ForensicPackageBinding binding,
        GeometryResult geometry,
        ForensicTransformProvenance transform) =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            packageId = _packageId,
            sessionSha256 = _sessionSha256,
            captureSha256 = _captureSha256,
            captureRequestId = _plan.CaptureRequestId,
            captureId = _plan.CaptureId,
            side = _sideName,
            profile = _plan.Profile == ForensicCaptureProfile.FullForensic ? "full_forensic" : "production_fast",
            capturePlanSha256 = _planSha256,
            configuration = new { id = binding.ConfigurationId, sha256 = binding.ConfigurationSha256 },
            calibration = new { id = binding.CalibrationId, sha256 = binding.CalibrationSha256 },
            orientation = new
            {
                rotationDegrees = binding.Orientation.SensorToPortraitRotationDegrees,
                mirrorHorizontal = binding.Orientation.MirrorHorizontal,
                mirrorVertical = binding.Orientation.MirrorVertical,
                supportsMirrorHorizontal = binding.Orientation.SupportsMirrorHorizontal,
                supportsMirrorVertical = binding.Orientation.SupportsMirrorVertical,
            },
            epochs = new
            {
                worker = _plan.Epochs.WorkerEpoch,
                session = _plan.Epochs.SessionEpoch,
                preview = _plan.Epochs.PreviewEpoch,
                side = _plan.Epochs.SideEpoch,
            },
            normalized = new { width = 1200, height = 1680 },
            artifacts = _artifacts.Select(artifact => new
            {
                role = artifact.Role,
                fileName = artifact.FileName,
                sha256 = artifact.Sha256,
                byteSize = artifact.ByteSize,
                mimeType = artifact.MimeType,
                width = artifact.Width,
                height = artifact.Height,
                frameId = artifact.FrameId,
                blockId = artifact.BlockId,
                hardwareTimestampTicks = artifact.HardwareTimestampTicks,
                receiveTimestampUtc = artifact.ReceiveTimestampUtc,
            }).ToArray(),
            authority = new
            {
                sourceRole = transform.SourceRole,
                sourceFrameId = transform.SourceFrameId,
                sourceBlockId = geometry.BlockId,
                sourceSha256 = transform.SourceSha256,
                status = geometry.Status,
                confidence = geometry.Confidence,
                sourceCorners = geometry.SourceCorners,
                normalizedCorners = geometry.NormalizedCorners,
                fittedLines = geometry.FittedLines,
                homography = transform.Homography,
                reusedByRoles = transform.ReusedByRoles,
            },
        }, CanonicalJson);

    private async ValueTask DeleteIncompleteOwnedStagingAsync()
    {
        if (!TryReadOwner(_stagingPath, _sessionSha256, _captureSha256, _sideName, _ownerNonce) ||
            File.Exists(Path.Combine(_stagingPath, ManifestFileName)))
        {
            await QuarantineCurrentStagingAsync().ConfigureAwait(false);
            return;
        }

        Directory.Delete(_stagingPath, recursive: true);
    }

    private ValueTask QuarantineCurrentStagingAsync()
    {
        if (!Directory.Exists(_stagingPath))
        {
            return ValueTask.CompletedTask;
        }

        Directory.CreateDirectory(_quarantineRoot);
        var destination = ContainedPath(_quarantineRoot, $"{Path.GetFileName(_stagingPath)}-{Guid.NewGuid():N}");
        Directory.Move(_stagingPath, destination);
        return ValueTask.CompletedTask;
    }

    private static bool ReconcileOwnedOrphans(
        string stagingRoot,
        string quarantineRoot,
        string sessionSha256,
        string captureSha256,
        string sideName,
        CancellationToken cancellationToken)
    {
        var liveTransactionExists = false;
        var prefix = $"{StagePrefix}{captureSha256}-{sideName}-";
        foreach (var directory in Directory.EnumerateDirectories(stagingRoot, $"{prefix}*", SearchOption.TopDirectoryOnly))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var stagingLease = TryAcquireOrphanLease(directory);
            if (stagingLease is null)
            {
                liveTransactionExists = true;
                continue;
            }

            var fileName = Path.GetFileName(directory);
            var nonce = fileName.Length > prefix.Length ? fileName[prefix.Length..] : string.Empty;
            var isOwnedIncomplete = nonce.Length == 32 && nonce.All(IsLowerHex) &&
                TryReadOwner(directory, sessionSha256, captureSha256, sideName, nonce) &&
                !File.Exists(Path.Combine(directory, ManifestFileName));
            stagingLease.Dispose();
            if (isOwnedIncomplete)
            {
                Directory.Delete(directory, recursive: true);
                continue;
            }

            Directory.CreateDirectory(quarantineRoot);
            var destination = ContainedPath(quarantineRoot, $"{fileName}-{Guid.NewGuid():N}");
            Directory.Move(directory, destination);
        }

        return liveTransactionExists;
    }

    private void ReleaseStagingLease(bool deleteLeaseFile)
    {
        var lease = Interlocked.Exchange(ref _stagingLease, null);
        lease?.Dispose();
        if (deleteLeaseFile)
        {
            var leasePath = Path.Combine(_stagingPath, LeaseFileName);
            if (File.Exists(leasePath))
            {
                File.Delete(leasePath);
            }
        }
    }

    private void RemoveStagingOnlyMetadataForCommit()
    {
        if (!TryReadOwner(_stagingPath, _sessionSha256, _captureSha256, _sideName, _ownerNonce))
        {
            throw new InvalidDataException("Forensic staging ownership metadata is invalid.");
        }

        ReleaseStagingLease(deleteLeaseFile: true);
        var ownerPath = Path.Combine(_stagingPath, OwnerFileName);
        File.Delete(ownerPath);
        if (File.Exists(ownerPath) || File.Exists(Path.Combine(_stagingPath, LeaseFileName)))
        {
            throw new IOException("Forensic staging-only metadata was not removed before commit.");
        }
    }

    private static FileStream AcquireCoordinationLease(string path)
    {
        IOException? lastException = null;
        for (var attempt = 0; attempt < 40; attempt++)
        {
            try
            {
                return new FileStream(
                    path,
                    FileMode.OpenOrCreate,
                    FileAccess.ReadWrite,
                    FileShare.None,
                    bufferSize: 1,
                    FileOptions.WriteThrough);
            }
            catch (IOException exception)
            {
                lastException = exception;
                Thread.Sleep(5);
            }
        }

        throw new IOException("Forensic package coordination is busy.", lastException);
    }

    private static FileStream AcquireNewStagingLease(string stagingPath)
    {
        var stream = new FileStream(
            Path.Combine(stagingPath, LeaseFileName),
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None,
            bufferSize: 1,
            FileOptions.WriteThrough);
        stream.Flush(flushToDisk: true);
        return stream;
    }

    private static FileStream? TryAcquireOrphanLease(string stagingPath)
    {
        try
        {
            return new FileStream(
                Path.Combine(stagingPath, LeaseFileName),
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.None,
                bufferSize: 1,
                FileOptions.WriteThrough);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static bool TryReadOwner(
        string directory,
        string sessionSha256,
        string captureSha256,
        string sideName,
        string ownerNonce)
    {
        try
        {
            var bytes = File.ReadAllBytes(Path.Combine(directory, OwnerFileName));
            if (bytes.Length > 4096)
            {
                return false;
            }

            using var document = JsonDocument.Parse(bytes);
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object && root.EnumerateObject().Count() == 6 &&
                root.GetProperty("schemaVersion").GetString() == OwnerSchema &&
                root.GetProperty("sessionSha256").GetString() == sessionSha256 &&
                root.GetProperty("captureSha256").GetString() == captureSha256 &&
                root.GetProperty("side").GetString() == sideName &&
                root.GetProperty("ownerNonce").GetString() == ownerNonce &&
                IsSha256(root.GetProperty("capturePlanSha256").GetString());
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or KeyNotFoundException)
        {
            return false;
        }
    }

    private static async ValueTask ValidateExistingPackageAsync(
        string packagePath,
        string expectedPackageSha256,
        string expectedManifestSha256,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(packagePath, ManifestFileName);
        if (!File.Exists(manifestPath))
        {
            throw new IOException("Immutable forensic package conflict: final package is incomplete.");
        }

        var manifestBytes = await File.ReadAllBytesAsync(manifestPath, cancellationToken).ConfigureAwait(false);
        if (manifestBytes.Length > 1024 * 1024)
        {
            throw new InvalidDataException("Forensic manifest is oversized.");
        }
        if (HashBytes(manifestBytes) != expectedManifestSha256)
        {
            throw new IOException("Immutable forensic package conflict: manifest digest differs.");
        }

        using var document = JsonDocument.Parse(manifestBytes, new JsonDocumentOptions { MaxDepth = 32 });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 3 ||
            root.GetProperty("schemaVersion").GetString() != PackageSchema)
        {
            throw new InvalidDataException("Forensic manifest schema is invalid.");
        }

        var persistedDigest = root.GetProperty("packageSha256").GetString();
        var payload = root.GetProperty("payload");
        var payloadBytes = JsonSerializer.SerializeToUtf8Bytes(payload, CanonicalJson);
        if (!IsSha256(persistedDigest) || HashBytes(payloadBytes) != persistedDigest || persistedDigest != expectedPackageSha256)
        {
            throw new IOException("Immutable forensic package conflict: digest differs.");
        }

        var artifactElements = payload.GetProperty("artifacts").EnumerateArray().ToArray();
        if (artifactElements.Length != ForensicRoles.Required.Count)
        {
            throw new InvalidDataException("Final forensic package is missing roles.");
        }

        var expectedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ManifestFileName };
        for (var index = 0; index < artifactElements.Length; index++)
        {
            var artifact = artifactElements[index];
            var role = artifact.GetProperty("role").GetString();
            var fileName = artifact.GetProperty("fileName").GetString();
            var sha256 = artifact.GetProperty("sha256").GetString();
            var mimeType = artifact.GetProperty("mimeType").GetString();
            var byteSize = artifact.GetProperty("byteSize").GetInt64();
            var width = artifact.GetProperty("width").GetInt32();
            var height = artifact.GetProperty("height").GetInt32();
            if (role != ForensicRoles.Required[index] || fileName is null || Path.GetFileName(fileName) != fileName ||
                !expectedFiles.Add(fileName) || !IsSha256(sha256) || mimeType is null)
            {
                throw new InvalidDataException("Final forensic artifact metadata is invalid.");
            }

            await ValidateStoredArtifactAsync(
                Path.Combine(packagePath, fileName),
                sha256!,
                byteSize,
                mimeType,
                width,
                height,
                expectedFrame: null,
                cancellationToken).ConfigureAwait(false);
        }

        var actualFiles = Directory.EnumerateFileSystemEntries(packagePath, "*", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!actualFiles.SetEquals(expectedFiles))
        {
            throw new InvalidDataException("Final forensic package contains unexpected or missing files.");
        }
    }

    private static async ValueTask ValidateStoredArtifactAsync(
        string path,
        string expectedSha256,
        long expectedByteSize,
        string expectedMimeType,
        int expectedWidth,
        int expectedHeight,
        CameraFrame? expectedFrame,
        CancellationToken cancellationToken)
    {
        var stored = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
        if (stored.LongLength != expectedByteSize || HashBytes(stored) != expectedSha256)
        {
            throw new InvalidDataException("Stored forensic bytes failed size or SHA-256 verification.");
        }

        var decoded = LosslessMono8Decoder.Decode(stored);
        if (decoded.MimeType != expectedMimeType || decoded.Width != expectedWidth || decoded.Height != expectedHeight)
        {
            throw new InvalidDataException("Stored forensic MIME or dimensions are incoherent.");
        }

        if (expectedFrame is not null)
        {
            for (var y = 0; y < expectedFrame.Height; y++)
            {
                if (!decoded.Pixels.AsSpan(y * expectedFrame.Width, expectedFrame.Width)
                    .SequenceEqual(expectedFrame.Mono8.AsSpan(y * expectedFrame.Stride, expectedFrame.Width)))
                {
                    throw new InvalidDataException("Stored forensic Mono8 pixels are not lossless.");
                }
            }
        }
    }

    private static void ValidateArtifactIdentity(ForensicArtifact artifact, string role, CameraFrame frame)
    {
        if (artifact.Role != role || artifact.FrameId != frame.FrameId || artifact.BlockId != frame.BlockId ||
            artifact.Width != frame.Width || artifact.Height != frame.Height || artifact.ByteSize <= 0 || !IsSha256(artifact.Sha256))
        {
            throw new InvalidDataException("Forensic artifact identity is incoherent.");
        }
    }

    private static void ValidateBinding(ForensicPackageBinding binding)
    {
        ValidateIdentifier(binding.ConfigurationId, 128, "configuration ID");
        ValidateIdentifier(binding.CalibrationId, 128, "calibration ID");
        if (!IsSha256(binding.ConfigurationSha256) || !IsSha256(binding.CalibrationSha256) ||
            binding.Orientation.SensorToPortraitRotationDegrees is not (0 or 90 or 180 or 270) ||
            (binding.Orientation.MirrorHorizontal && !binding.Orientation.SupportsMirrorHorizontal) ||
            (binding.Orientation.MirrorVertical && !binding.Orientation.SupportsMirrorVertical))
        {
            throw new InvalidDataException("Configuration, calibration, or sensor orientation binding is invalid.");
        }
    }

    private static byte[] CreatePlanBytes(ForensicSidePlan plan, string sessionSha256, string captureSha256) =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "tenkings.ai-grader.forensic-side-plan.v1",
            sessionSha256,
            captureSha256,
            plan.CaptureRequestId,
            plan.CaptureId,
            side = SideName(plan.Side),
            profile = plan.Profile == ForensicCaptureProfile.FullForensic ? "full_forensic" : "production_fast",
            epochs = new
            {
                worker = plan.Epochs.WorkerEpoch,
                session = plan.Epochs.SessionEpoch,
                preview = plan.Epochs.PreviewEpoch,
                side = plan.Epochs.SideEpoch,
            },
            roles = plan.Roles,
        }, CanonicalJson);

    private static async ValueTask WriteNewDurableAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            131_072,
            FileOptions.Asynchronous | FileOptions.WriteThrough);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        stream.Flush(flushToDisk: true);
    }

    private static bool IsNonsingularHomography(IReadOnlyList<double> values)
    {
        if (values.Count != 9 || values.Any(value => !double.IsFinite(value)))
        {
            return false;
        }

        var determinant =
            values[0] * ((values[4] * values[8]) - (values[5] * values[7])) -
            values[1] * ((values[3] * values[8]) - (values[5] * values[6])) +
            values[2] * ((values[3] * values[7]) - (values[4] * values[6]));
        return double.IsFinite(determinant) && Math.Abs(determinant) > 1e-12;
    }

    private static bool HomographyMapsCorners(
        IReadOnlyList<double> matrix,
        IReadOnlyList<PointD> source,
        IReadOnlyList<PointD> destination)
    {
        for (var index = 0; index < 4; index++)
        {
            var denominator = (matrix[6] * source[index].X) + (matrix[7] * source[index].Y) + matrix[8];
            if (!double.IsFinite(denominator) || Math.Abs(denominator) <= 1e-12)
            {
                return false;
            }

            var x = ((matrix[0] * source[index].X) + (matrix[1] * source[index].Y) + matrix[2]) / denominator;
            var y = ((matrix[3] * source[index].X) + (matrix[4] * source[index].Y) + matrix[5]) / denominator;
            if (!double.IsFinite(x) || !double.IsFinite(y) ||
                Math.Abs(x - destination[index].X) > 1 || Math.Abs(y - destination[index].Y) > 1)
            {
                return false;
            }
        }

        return true;
    }

    private static bool CornersAreOrderedConvex(IReadOnlyList<PointD> corners)
    {
        double sign = 0;
        for (var index = 0; index < 4; index++)
        {
            var first = corners[index];
            var second = corners[(index + 1) % 4];
            var third = corners[(index + 2) % 4];
            var cross = ((second.X - first.X) * (third.Y - second.Y)) -
                ((second.Y - first.Y) * (third.X - second.X));
            if (!double.IsFinite(cross) || Math.Abs(cross) <= 1e-6)
            {
                return false;
            }

            sign = sign == 0 ? Math.Sign(cross) : sign;
            if (Math.Sign(cross) != Math.Sign(sign))
            {
                return false;
            }
        }

        return true;
    }

    private static bool PhysicalLongEdgeMapsToHeight(IReadOnlyList<PointD> corners) =>
        (Distance(corners[1], corners[2]) + Distance(corners[3], corners[0])) >
        (Distance(corners[0], corners[1]) + Distance(corners[2], corners[3]));

    private static bool NormalizedCornersMatchContract(IReadOnlyList<PointD> corners)
    {
        PointD[] expected = [new(0, 0), new(1199, 0), new(1199, 1679), new(0, 1679)];
        return corners.Select((point, index) => Distance(point, expected[index])).All(distance => distance <= 1e-6);
    }

    private static bool LinesMatchCorners(IReadOnlyList<LineD> lines, IReadOnlyList<PointD> corners)
    {
        for (var index = 0; index < 4; index++)
        {
            var line = lines[index];
            var norm = Math.Sqrt((line.A * line.A) + (line.B * line.B));
            var first = corners[index];
            var second = corners[(index + 1) % 4];
            if (!double.IsFinite(norm) || norm is < 0.999 or > 1.001 ||
                Math.Abs((line.A * first.X) + (line.B * first.Y) + line.C) > 1 ||
                Math.Abs((line.A * second.X) + (line.B * second.Y) + line.C) > 1)
            {
                return false;
            }
        }

        return true;
    }

    private static double Distance(PointD first, PointD second)
    {
        var x = first.X - second.X;
        var y = first.Y - second.Y;
        return Math.Sqrt((x * x) + (y * y));
    }

    private static string SideName(CardSide side) => side switch
    {
        CardSide.Front => "front",
        CardSide.Back => "back",
        _ => throw new InvalidDataException("Forensic package requires front or back."),
    };

    private static string HashText(string value) => HashBytes(Encoding.UTF8.GetBytes(value));
    private static string HashBytes(ReadOnlySpan<byte> value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(IsLowerHex);

    private static bool IsLowerHex(char value) => value is >= '0' and <= '9' or >= 'a' and <= 'f';

    private static void ValidateIdentifier(string value, int maximumLength, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength ||
            !value.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-'))
        {
            throw new InvalidDataException($"Invalid {name}.");
        }
    }

    private static string ContainedPath(string root, string child)
    {
        var fullRoot = Path.GetFullPath(root);
        var candidate = Path.GetFullPath(Path.Combine(fullRoot, child));
        var prefix = fullRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Forensic package path escaped its configured root.");
        }

        return candidate;
    }
}

internal sealed record DecodedMono8(string MimeType, int Width, int Height, byte[] Pixels);

internal static class LosslessMono8Decoder
{
    private const int MaximumImagePixels = 64 * 1024 * 1024;
    private static ReadOnlySpan<byte> PngSignature => [137, 80, 78, 71, 13, 10, 26, 10];

    public static DecodedMono8 Decode(byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith(PngSignature))
        {
            return DecodePng(bytes);
        }

        if (bytes.Length >= 4 && bytes[0] == (byte)'I' && bytes[1] == (byte)'I' && bytes[2] == 42 && bytes[3] == 0)
        {
            return DecodeTiff(bytes);
        }

        throw new InvalidDataException("Stored forensic image has an unsupported MIME signature.");
    }

    private static DecodedMono8 DecodePng(byte[] bytes)
    {
        var offset = PngSignature.Length;
        int? width = null;
        int? height = null;
        using var idat = new MemoryStream();
        var foundEnd = false;
        while (offset < bytes.Length)
        {
            if (offset > bytes.Length - 12)
            {
                throw new InvalidDataException("Truncated PNG chunk.");
            }

            var length = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(offset, 4));
            if (length < 0 || length > bytes.Length - offset - 12)
            {
                throw new InvalidDataException("Invalid PNG chunk length.");
            }

            var type = bytes.AsSpan(offset + 4, 4);
            var data = bytes.AsSpan(offset + 8, length);
            var storedCrc = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(offset + 8 + length, 4));
            if (storedCrc != Crc32(type, data))
            {
                throw new InvalidDataException("PNG chunk CRC mismatch.");
            }

            if (type.SequenceEqual("IHDR"u8))
            {
                if (length != 13 || width is not null || data[8] != 8 || data[9] != 0 ||
                    data[10] != 0 || data[11] != 0 || data[12] != 0)
                {
                    throw new InvalidDataException("PNG is not lossless non-interlaced Mono8.");
                }

                width = BinaryPrimitives.ReadInt32BigEndian(data[..4]);
                height = BinaryPrimitives.ReadInt32BigEndian(data.Slice(4, 4));
            }
            else if (type.SequenceEqual("IDAT"u8))
            {
                idat.Write(data);
            }
            else if (type.SequenceEqual("IEND"u8))
            {
                if (length != 0 || offset + 12 != bytes.Length)
                {
                    throw new InvalidDataException("PNG end chunk is invalid.");
                }

                foundEnd = true;
                break;
            }

            offset += 12 + length;
        }

        ValidateDimensions(width, height);
        if (!foundEnd || idat.Length == 0)
        {
            throw new InvalidDataException("PNG is incomplete.");
        }

        var rowSize = checked(width!.Value + 1);
        var rawLength = checked(rowSize * height!.Value);
        var raw = new byte[rawLength];
        idat.Position = 0;
        using (var zlib = new ZLibStream(idat, CompressionMode.Decompress, leaveOpen: true))
        {
            var read = 0;
            while (read < raw.Length)
            {
                var count = zlib.Read(raw, read, raw.Length - read);
                if (count == 0)
                {
                    break;
                }

                read += count;
            }

            if (read != raw.Length || zlib.ReadByte() != -1)
            {
                throw new InvalidDataException("PNG decompressed byte count is invalid.");
            }
        }

        var pixels = new byte[checked(width.Value * height.Value)];
        for (var y = 0; y < height.Value; y++)
        {
            if (raw[y * rowSize] != 0)
            {
                throw new InvalidDataException("PNG uses an unexpected row filter.");
            }

            raw.AsSpan((y * rowSize) + 1, width.Value).CopyTo(pixels.AsSpan(y * width.Value, width.Value));
        }

        return new DecodedMono8("image/png", width.Value, height.Value, pixels);
    }

    private static DecodedMono8 DecodeTiff(byte[] bytes)
    {
        if (bytes.Length < 8 || BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(2, 2)) != 42)
        {
            throw new InvalidDataException("TIFF header is invalid.");
        }

        var ifdOffset = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4, 4)));
        if (ifdOffset < 8 || ifdOffset > bytes.Length - 2)
        {
            throw new InvalidDataException("TIFF IFD offset is invalid.");
        }

        var count = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(ifdOffset, 2));
        if (count is 0 or > 64 || ifdOffset + 2 + (count * 12) + 4 > bytes.Length)
        {
            throw new InvalidDataException("TIFF IFD is invalid.");
        }

        var tags = new Dictionary<ushort, (ushort Type, uint Count, uint Value)>();
        var offset = ifdOffset + 2;
        for (var index = 0; index < count; index++, offset += 12)
        {
            var tag = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset, 2));
            var type = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset + 2, 2));
            var itemCount = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset + 4, 4));
            var value = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset + 8, 4));
            if (!tags.TryAdd(tag, (type, itemCount, value)))
            {
                throw new InvalidDataException("TIFF contains duplicate tags.");
            }
        }

        var width = RequiredTag(tags, 256, 4);
        var height = RequiredTag(tags, 257, 4);
        ValidateDimensions(checked((int)width), checked((int)height));
        if (RequiredTag(tags, 258, 3) != 8 || RequiredTag(tags, 259, 3) != 1 ||
            RequiredTag(tags, 262, 3) != 1 || RequiredTag(tags, 277, 3) != 1 ||
            RequiredTag(tags, 278, 4) != height)
        {
            throw new InvalidDataException("TIFF is not uncompressed single-channel Mono8.");
        }

        var stripOffset = RequiredTag(tags, 273, 4);
        var byteCount = RequiredTag(tags, 279, 4);
        var expectedCount = checked(width * height);
        if (byteCount != expectedCount || stripOffset > bytes.LongLength || byteCount > bytes.LongLength - stripOffset)
        {
            throw new InvalidDataException("TIFF strip is incomplete.");
        }

        var pixels = bytes.AsSpan(checked((int)stripOffset), checked((int)byteCount)).ToArray();
        return new DecodedMono8("image/tiff", checked((int)width), checked((int)height), pixels);
    }

    private static uint RequiredTag(Dictionary<ushort, (ushort Type, uint Count, uint Value)> tags, ushort tag, ushort type)
    {
        if (!tags.TryGetValue(tag, out var value) || value.Type != type || value.Count != 1)
        {
            throw new InvalidDataException("TIFF required tag is missing or invalid.");
        }

        return value.Value;
    }

    private static void ValidateDimensions(int? width, int? height)
    {
        if (width is null or <= 0 || height is null or <= 0 || (long)width.Value * height.Value > MaximumImagePixels)
        {
            throw new InvalidDataException("Forensic image dimensions are unsafe.");
        }
    }

    private static uint Crc32(ReadOnlySpan<byte> first, ReadOnlySpan<byte> second)
    {
        var crc = uint.MaxValue;
        foreach (var value in first)
        {
            crc = UpdateCrc(crc, value);
        }

        foreach (var value in second)
        {
            crc = UpdateCrc(crc, value);
        }

        return ~crc;
    }

    private static uint UpdateCrc(uint crc, byte value)
    {
        crc ^= value;
        for (var bit = 0; bit < 8; bit++)
        {
            crc = (crc & 1) == 1 ? (crc >> 1) ^ 0xedb88320U : crc >> 1;
        }

        return crc;
    }
}
