using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed partial class NfcOperationsService
{
    private readonly INfcReaderBackend _backend;
    private readonly ISafeLogger _logger;
    private readonly IWorkstationAttestationSigner? _attestationSigner;
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _operationTimeout;
    private readonly SemaphoreSlim _operationGate = new(1, 1);
    private readonly ConcurrentDictionary<string, IdempotencyEntry> _idempotency = new(StringComparer.Ordinal);
    private ReaderBackendStatus? _lastBackendStatus;
    private long _idempotencySequence;

    public NfcOperationsService(
        INfcReaderBackend backend,
        IWorkstationAttestationSigner? attestationSigner = null,
        ISafeLogger? logger = null,
        int operationTimeoutMs = NfcProtocol.DefaultOperationTimeoutMs,
        TimeProvider? timeProvider = null)
    {
        if (operationTimeoutMs is < 100 or > 30_000) throw new ArgumentOutOfRangeException(nameof(operationTimeoutMs));
        _backend = backend;
        _attestationSigner = attestationSigner;
        _logger = logger ?? new ConsoleSafeLogger();
        _operationTimeout = TimeSpan.FromMilliseconds(operationTimeoutMs);
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public bool Busy => _operationGate.CurrentCount == 0;

    public HelperStatusResponse Status()
    {
        var busy = Busy;
        var status = busy
            ? Volatile.Read(ref _lastBackendStatus) ??
              new ReaderBackendStatus(false, false, "unknown", false, "operation_in_progress")
            : _backend.GetStatus();
        if (!busy) Volatile.Write(ref _lastBackendStatus, status);
        return new HelperStatusResponse(
            NfcProtocol.ProtocolVersion,
            status.Connected,
            status.PcscReady,
            status.TagState,
            busy,
            status.Connected ? "ACS ACR1552U" : "unavailable",
            new ReaderCapability(
                NfcProtocol.ChipType,
                NfcProtocol.SecurityMode,
                true,
                true,
                status.MultipleTagDetectionSupported,
                status.TagSelectionEvidence),
            status.ErrorCode);
    }

    public async Task<NfcReadResponse> ReadAsync(NfcReadRequest request, string requestId, CancellationToken cancellationToken)
    {
        ValidateContext(request.AttemptId, "attemptId");
        if (!await _operationGate.WaitAsync(0, cancellationToken))
            throw new NfcHelperException("reader_busy", "Another NFC operation is already active.", true, 409);
        var releaseNow = true;
        try
        {
            var operation = Task.Run(ReadCore, CancellationToken.None);
            try
            {
                var result = await operation.WaitAsync(_operationTimeout, cancellationToken);
                _logger.Info("nfc_read_complete", requestId, result.ReaderResultCode);
                return result;
            }
            catch (TimeoutException)
            {
                releaseNow = false;
                _ = operation.ContinueWith(
                    _ => _operationGate.Release(),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
                throw new NfcHelperException("reader_timeout", "The NFC reader operation timed out.", true, 504);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                releaseNow = false;
                _ = operation.ContinueWith(
                    _ => _operationGate.Release(),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
                throw new NfcHelperException("request_cancelled", "The request ended while the NFC read was still running; wait until status is no longer busy before retrying.", true, 409);
            }
        }
        catch (NfcHelperException error)
        {
            _logger.Error("nfc_read_failed", requestId, error.Code);
            throw;
        }
        finally
        {
            if (releaseNow) _operationGate.Release();
        }
    }

    public async Task<NfcWriteResponse> WriteAsync(NfcWriteRequest request, string requestId, CancellationToken cancellationToken)
    {
        ValidateWriteRequest(request);
        if (_attestationSigner is null)
            throw new NfcHelperException(
                "attestation_signer_unavailable",
                "The NFC workstation operational attestation signer is unavailable.",
                false,
                503);
        var digest = RequestDigest(request);
        var entry = _idempotency.GetOrAdd(request.IdempotencyKey, _ =>
            new IdempotencyEntry(
                digest,
                Interlocked.Increment(ref _idempotencySequence),
                current => ExecuteWriteWithLockAsync(request, requestId, current)));
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(entry.RequestDigest), Encoding.ASCII.GetBytes(digest)))
        {
            throw new NfcHelperException("idempotency_conflict", "The idempotency key was already used for a different NFC write request.", false, 409);
        }
        TrimIdempotencyCache();
        var operation = entry.GetOrStart();
        try
        {
            return await operation.WaitAsync(_operationTimeout, cancellationToken);
        }
        catch (TimeoutException)
        {
            _logger.Error("nfc_write_wait_failed", requestId, "reader_timeout");
            throw new NfcHelperException("reader_timeout", "The NFC write timed out. Keep the same physical tag on the reader, wait until status is no longer busy, then retry the same attempt.", true, 504);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _logger.Error("nfc_write_wait_failed", requestId, "request_cancelled");
            throw new NfcHelperException("request_cancelled", "The request ended while the NFC write was still running. Keep the same physical tag on the reader, wait until status is no longer busy, then retry the same attempt.", true, 409);
        }
    }

    public async Task<HardwareGateResult> RunHardwareGateTestAsync(
        bool confirmOverwrite,
        string requestId,
        CancellationToken cancellationToken)
    {
        if (!await _operationGate.WaitAsync(0, cancellationToken))
            throw new NfcHelperException("writer_busy", "Another NFC operation is already active.", true, 409);
        var releaseNow = true;
        try
        {
            var operation = Task.Run(() =>
            {
                var request = new NfcWriteRequest(
                    "hardware_gate_test",
                    "hardware_gate_test_write",
                    "hardware_gate_test",
                    "hardware_gate_test",
                    NfcProtocol.HardwareGateTestUrl);
                var result = WriteCore(request, hardwareGateTest: true);
                if (result.OverwriteRequired && confirmOverwrite && result.ObservedPayloadSha256 is not null)
                {
                    request = request with
                    {
                        OverwriteConfirmation = new OverwriteConfirmationRequest(true, result.ObservedPayloadSha256)
                    };
                    result = WriteCore(request, hardwareGateTest: true);
                }
                return new HardwareGateResult(
                    result.OverwriteRequired ? "overwrite_confirmation_required" : "hardware_gate_exact_readback_verified",
                    true,
                    true,
                    result.ReaderResultCode == "write_verified_pcsc_readback",
                    !result.OverwriteRequired,
                    result.OverwriteRequired);
            }, CancellationToken.None);
            try
            {
                return await operation.WaitAsync(_operationTimeout, cancellationToken);
            }
            catch (TimeoutException)
            {
                releaseNow = false;
                _ = operation.ContinueWith(
                    _ => _operationGate.Release(),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
                throw new NfcHelperException("reader_timeout", "The NFC hardware-gate operation timed out; wait until the reader is no longer busy.", true, 504);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                releaseNow = false;
                _ = operation.ContinueWith(
                    _ => _operationGate.Release(),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
                throw new NfcHelperException("request_cancelled", "The NFC hardware-gate operation is still finishing; wait until the reader is no longer busy.", true, 409);
            }
        }
        finally
        {
            if (releaseNow) _operationGate.Release();
        }
    }

    private async Task<NfcWriteResponse> ExecuteWriteWithLockAsync(
        NfcWriteRequest request,
        string requestId,
        IdempotencyEntry entry)
    {
        if (!await _operationGate.WaitAsync(0, CancellationToken.None))
        {
            throw new NfcHelperException("writer_busy", "Another NFC write is already active.", true, 409);
        }

        try
        {
            var result = await Task.Run(() => WriteCore(request, entry: entry), CancellationToken.None);
            entry.MarkExecutionSuccess();
            _logger.Info("nfc_write_complete", requestId, result.ReaderResultCode);
            return result;
        }
        catch (NfcHelperException error)
        {
            entry.MarkExecutionFailure();
            _logger.Error("nfc_write_failed", requestId, error.Code);
            throw;
        }
        catch
        {
            entry.MarkExecutionFailure();
            throw;
        }
        finally
        {
            _operationGate.Release();
        }
    }

    private NfcReadResponse ReadCore()
    {
        using var session = _backend.OpenSession();
        var snapshot = ReadSnapshot(session, requireWritable: false);
        ParsedNdefUrl? parsed = null;
        if (snapshot.Location.Exists && snapshot.Location.ValueLength > 0)
            parsed = NdefCodec.ParseProductionUrl(snapshot.DataArea.AsSpan(snapshot.Location.ValueOffset, snapshot.Location.ValueLength));
        return new NfcReadResponse(
            NfcProtocol.ProtocolVersion,
            NfcProtocol.ChipType,
            parsed?.Url,
            parsed?.PayloadSha256,
            snapshot.UidFingerprint,
            parsed is null ? "blank_ntag215" : "read_verified_pcsc");
    }

    private NfcWriteResponse WriteCore(
        NfcWriteRequest request,
        bool hardwareGateTest = false,
        IdempotencyEntry? entry = null)
    {
        var target = hardwareGateTest
            ? NdefCodec.EncodeHardwareGateTestUrl()
            : NdefCodec.EncodeProductionUrl(request.Url);
        var tlv = NdefCodec.EncodeType2Tlv(target);
        using var session = _backend.OpenSession();
        var snapshot = ReadSnapshot(session, requireWritable: true);
        var location = snapshot.Location;
        var observedDigest = ObservedPayloadDigest(snapshot);
        var recoverableInterruptedWrite =
            entry?.CanRecoverInterruptedWrite(snapshot.UidFingerprint) == true &&
            IsRecoverableInterruptedWrite(snapshot, tlv);
        ParsedNdefUrl? existing = null;
        if (location.Exists && location.ValueLength > 0)
        {
            try
            {
                existing = hardwareGateTest
                    ? NdefCodec.ParseHardwareGateTestUrl(snapshot.DataArea.AsSpan(location.ValueOffset, location.ValueLength))
                    : NdefCodec.ParseProductionUrl(snapshot.DataArea.AsSpan(location.ValueOffset, location.ValueLength));
            }
            catch (NfcHelperException)
            {
                // A malformed or non-Ten-Kings NDEF is still nonblank and requires explicit overwrite evidence.
            }
        }

        if (existing is not null && existing.Url == target.Url && existing.Message.AsSpan().SequenceEqual(target.Message))
        {
            return hardwareGateTest
                ? UnsignedVerifiedResponse(target, snapshot.UidFingerprint, "already_programmed_exact")
                : VerifiedResponse(request, target, snapshot.UidFingerprint, "already_programmed_exact");
        }

        if (IsNonBlank(snapshot) && !recoverableInterruptedWrite)
        {
            var confirmation = request.OverwriteConfirmation;
            if (confirmation is null || !confirmation.Confirmed)
            {
                return new NfcWriteResponse(
                    NfcProtocol.ProtocolVersion,
                    NfcProtocol.ChipType,
                    target.Url,
                    target.PayloadSha256,
                    snapshot.UidFingerprint,
                    "overwrite_confirmation_required",
                    null,
                    true,
                    observedDigest);
            }
            var confirmedDigest = confirmation.ObservedPayloadSha256;
            if (!IsSha256(confirmedDigest) ||
                !CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(confirmedDigest!.ToLowerInvariant()),
                    Encoding.ASCII.GetBytes(observedDigest)))
            {
                throw new NfcHelperException("overwrite_confirmation_mismatch", "The tag changed after overwrite confirmation. Read it again before retrying.", true, 409);
            }
        }

        if (location.HasFollowingTlv && !recoverableInterruptedWrite)
            throw new NfcHelperException("unsupported_tlv_layout", "The tag contains additional TLVs that this helper will not overwrite.", false, 409);
        var typeOffset = location.TypeOffset;
        if (typeOffset < 0 || typeOffset + tlv.Length > snapshot.DataArea.Length)
            throw new NfcHelperException("ndef_capacity_exceeded", "The NFC URL does not fit within the NTAG215 Capability Container boundary.", false, 422);

        var oldOccupiedEnd = location.Exists
            ? Math.Max(location.EndOffset, location.TerminatorOffset is int terminator ? terminator + 1 : location.EndOffset)
            : typeOffset;
        var changedEnd = Math.Max(oldOccupiedEnd, typeOffset + tlv.Length);
        var finalArea = snapshot.DataArea.ToArray();
        finalArea.AsSpan(typeOffset, changedEnd - typeOffset).Clear();
        tlv.CopyTo(finalArea, typeOffset);
        var lengthOffset = typeOffset + 1;
        var interimArea = finalArea.ToArray();
        interimArea[lengthOffset] = 0;

        var firstPage = Ntag215Layout.PageForDataOffset(lengthOffset);
        entry?.MarkWriteStarted(snapshot.UidFingerprint);
        WriteAreaPage(session, interimArea, firstPage);
        var lastPage = Ntag215Layout.PageForDataOffset(changedEnd - 1);
        for (var page = Ntag215Layout.PageForDataOffset(typeOffset); page <= lastPage; page++)
        {
            if (page != firstPage) WriteAreaPage(session, interimArea, page);
        }
        // The final non-zero NDEF TLV length is committed last.
        WriteAreaPage(session, finalArea, firstPage);

        try
        {
            var readback = ReadDataArea(session);
            var readbackLocation = NdefCodec.LocateNdef(readback);
            if (!readbackLocation.Exists || readbackLocation.ValueLength != target.Message.Length)
                throw ReadbackMismatch();
            var parsedReadback = hardwareGateTest
                ? NdefCodec.ParseHardwareGateTestUrl(readback.AsSpan(readbackLocation.ValueOffset, readbackLocation.ValueLength))
                : NdefCodec.ParseProductionUrl(readback.AsSpan(readbackLocation.ValueOffset, readbackLocation.ValueLength));
            if (parsedReadback.Url != target.Url ||
                !parsedReadback.Message.AsSpan().SequenceEqual(target.Message) ||
                parsedReadback.PayloadSha256 != target.PayloadSha256)
                throw ReadbackMismatch();
        }
        catch (NfcHelperException error) when (error.Code != "readback_mismatch")
        {
            throw ReadbackMismatch();
        }
        return hardwareGateTest
            ? UnsignedVerifiedResponse(target, snapshot.UidFingerprint, "write_verified_pcsc_readback")
            : VerifiedResponse(request, target, snapshot.UidFingerprint, "write_verified_pcsc_readback");
    }

    private NfcWriteResponse VerifiedResponse(
        NfcWriteRequest request,
        EncodedNdefUrl target,
        string uidFingerprint,
        string resultCode)
    {
        var signer = _attestationSigner ??
            throw new NfcHelperException(
                "attestation_signer_unavailable",
                "The NFC workstation operational attestation signer is unavailable.",
                false,
                503);
        var fields = new WorkstationAttestationFields(
            request.AttemptId,
            request.AttestationChallenge,
            target.PublicTagId,
            target.Url,
            uidFingerprint,
            target.PayloadSha256,
            resultCode,
            NfcProtocol.ProtocolVersion,
            WorkstationAttestation.FormatObservedAt(_timeProvider.GetUtcNow()));
        var attestation = WorkstationAttestation.Create(signer, fields);
        return new NfcWriteResponse(
            NfcProtocol.ProtocolVersion,
            NfcProtocol.ChipType,
            target.Url,
            target.PayloadSha256,
            uidFingerprint,
            resultCode,
            attestation);
    }

    private static NfcWriteResponse UnsignedVerifiedResponse(
        EncodedNdefUrl target,
        string uidFingerprint,
        string resultCode) =>
        new(
            NfcProtocol.ProtocolVersion,
            NfcProtocol.ChipType,
            target.Url,
            target.PayloadSha256,
            uidFingerprint,
            resultCode);

    private static TagSnapshot ReadSnapshot(INfcTagSession session, bool requireWritable)
    {
        Ntag215Layout.ValidateGetVersion(session.GetVersion());
        var firstRead = session.ReadFourPages(3);
        Ntag215Layout.ValidateCapabilityContainer(firstRead.AsSpan(0, 4), requireWritable);
        var dataArea = ReadDataArea(session);
        var rawUid = session.ReadUid();
        string uidFingerprint;
        try
        {
            if (rawUid.Length != 7) throw new NfcHelperException("unsupported_tag", "Place one supported NTAG215 on the reader.", false, 422);
            uidFingerprint = NdefCodec.Sha256Hex(rawUid);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(rawUid);
        }
        return new TagSnapshot(dataArea, NdefCodec.LocateNdef(dataArea), uidFingerprint);
    }

    private static byte[] ReadDataArea(INfcTagSession session)
    {
        var dataArea = new byte[Ntag215Layout.NdefDataAreaBytes];
        for (var page = Ntag215Layout.FirstNdefPage; page <= Ntag215Layout.LastNdefPage; page += 4)
        {
            var bytes = session.ReadFourPages(page);
            if (bytes.Length != 16) throw new NfcHelperException("short_page_read", "The NTAG215 page read was incomplete.", true, 409);
            bytes.CopyTo(dataArea, (page - Ntag215Layout.FirstNdefPage) * 4);
            CryptographicOperations.ZeroMemory(bytes);
        }
        return dataArea;
    }

    private static void WriteAreaPage(INfcTagSession session, byte[] area, int page)
    {
        if (page < Ntag215Layout.FirstNdefPage || page > Ntag215Layout.LastNdefPage)
            throw new NfcHelperException("unsafe_page_write", "The NFC write was blocked outside pages 4 through 127.");
        var offset = (page - Ntag215Layout.FirstNdefPage) * 4;
        session.WritePage(page, area.AsSpan(offset, 4));
    }

    private static bool IsNonBlank(TagSnapshot snapshot)
    {
        if (snapshot.Location.Exists && snapshot.Location.ValueLength > 0) return true;
        for (var index = 0; index < snapshot.DataArea.Length; index++)
        {
            if (index == snapshot.Location.TypeOffset || index == snapshot.Location.LengthOffset) continue;
            var value = snapshot.DataArea[index];
            if (value is not 0x00 and not 0xFE) return true;
        }
        return false;
    }

    private static string ObservedPayloadDigest(TagSnapshot snapshot)
    {
        if (snapshot.Location.Exists && snapshot.Location.ValueLength > 0)
            return NdefCodec.Sha256Hex(snapshot.DataArea.AsSpan(snapshot.Location.ValueOffset, snapshot.Location.ValueLength));
        return NdefCodec.Sha256Hex(snapshot.DataArea);
    }

    private static bool IsRecoverableInterruptedWrite(TagSnapshot snapshot, ReadOnlySpan<byte> targetTlv)
    {
        var location = snapshot.Location;
        if (!location.Exists ||
            location.ValueLength != 0 ||
            location.TypeOffset < 0 ||
            location.LengthOffset != location.TypeOffset + 1 ||
            location.TypeOffset + 4 > snapshot.DataArea.Length ||
            targetTlv.Length < 4)
            return false;
        var observedPrefix = snapshot.DataArea.AsSpan(location.TypeOffset, 4);
        return observedPrefix[0] == 0x03 &&
               observedPrefix[1] == 0x00 &&
               observedPrefix[2] == targetTlv[2] &&
               observedPrefix[3] == targetTlv[3];
    }

    private static void ValidateWriteRequest(NfcWriteRequest request)
    {
        ValidateContext(request.AttemptId, "attemptId");
        ValidateContext(request.IdempotencyKey, "idempotencyKey");
        WorkstationAttestation.ValidateChallenge(request.AttestationChallenge);
        var encoded = NdefCodec.EncodeProductionUrl(request.Url);
        if (!string.Equals(encoded.PublicTagId, request.PublicTagId, StringComparison.Ordinal))
            throw new NfcHelperException(
                "invalid_request_context",
                "publicTagId must exactly match the server-constructed NFC URL.",
                false,
                400);
    }

    private static void ValidateContext(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || !ContextPattern().IsMatch(value))
            throw new NfcHelperException("invalid_request_context", $"{field} must be 8 to 128 URL-safe characters.");
    }

    private static string RequestDigest(NfcWriteRequest request)
    {
        var confirmation = request.OverwriteConfirmation;
        var canonical = string.Join('\n',
            "nfc-write-v2",
            request.AttemptId,
            request.IdempotencyKey,
            request.PublicTagId,
            request.AttestationChallenge,
            request.Url,
            confirmation?.Confirmed == true ? "confirmed" : "not_confirmed",
            confirmation?.ObservedPayloadSha256?.ToLowerInvariant() ?? string.Empty);
        return NdefCodec.Sha256Hex(Encoding.UTF8.GetBytes(canonical));
    }

    private void TrimIdempotencyCache()
    {
        if (_idempotency.Count <= 256) return;
        foreach (var stale in _idempotency
                     .Where(item => item.Value.IsCompleted)
                     .OrderBy(item => item.Value.Sequence)
                     .Take(_idempotency.Count - 256))
            RemoveIdempotencyEntry(stale.Key, stale.Value);
    }

    private void RemoveIdempotencyEntry(string key, IdempotencyEntry entry) =>
        ((ICollection<KeyValuePair<string, IdempotencyEntry>>)_idempotency)
        .Remove(new KeyValuePair<string, IdempotencyEntry>(key, entry));

    private static bool IsSha256(string? value) => value is not null && Sha256Pattern().IsMatch(value);

    private static NfcHelperException ReadbackMismatch() =>
        new("readback_mismatch", "The NTAG215 readback did not match the requested NDEF payload.", true, 409);

    [GeneratedRegex("^[A-Za-z0-9_-]{8,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContextPattern();
    [GeneratedRegex("^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();

    private sealed record TagSnapshot(byte[] DataArea, Type2NdefLocation Location, string UidFingerprint);
    private sealed class IdempotencyEntry
    {
        private readonly object _gate = new();
        private readonly Func<IdempotencyEntry, Task<NfcWriteResponse>> _operationFactory;
        private Task<NfcWriteResponse>? _operation;
        private string? _writeStartedUidFingerprint;
        private string? _recoveryUidFingerprint;

        public IdempotencyEntry(
            string requestDigest,
            long sequence,
            Func<IdempotencyEntry, Task<NfcWriteResponse>> operation)
        {
            RequestDigest = requestDigest;
            Sequence = sequence;
            _operationFactory = operation;
        }

        public string RequestDigest { get; }
        public long Sequence { get; }
        public bool IsCompleted
        {
            get
            {
                lock (_gate) return _operation?.IsCompleted == true;
            }
        }

        public Task<NfcWriteResponse> GetOrStart()
        {
            lock (_gate)
            {
                if (_operation is null || _operation.IsCompleted && !_operation.IsCompletedSuccessfully)
                {
                    // A task cannot become completed until ExecuteWriteWithLockAsync has
                    // released the global writer gate in its finally block. Restarting a
                    // failed exact request here therefore cannot overlap the prior write.
                    _writeStartedUidFingerprint = null;
                    _operation = _operationFactory(this);
                }
                return _operation;
            }
        }

        public void MarkWriteStarted(string uidFingerprint)
        {
            lock (_gate) _writeStartedUidFingerprint = uidFingerprint;
        }

        public void MarkExecutionFailure()
        {
            lock (_gate)
            {
                if (_writeStartedUidFingerprint is not null)
                    _recoveryUidFingerprint = _writeStartedUidFingerprint;
            }
        }

        public void MarkExecutionSuccess()
        {
            lock (_gate) _recoveryUidFingerprint = null;
        }

        public bool CanRecoverInterruptedWrite(string uidFingerprint)
        {
            lock (_gate)
            {
                if (_recoveryUidFingerprint is null) return false;
                return CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(_recoveryUidFingerprint),
                    Encoding.ASCII.GetBytes(uidFingerprint));
            }
        }
    }
}
