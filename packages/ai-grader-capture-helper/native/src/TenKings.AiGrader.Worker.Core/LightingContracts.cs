namespace TenKings.AiGrader.Worker.Core;

public sealed record LightingRequest(
    string RequestToken,
    string EvidenceRole,
    CardSide Side,
    Epochs Epochs,
    long RequestedMonotonicTicks);

public sealed record LightingStableAcknowledgement(
    string RequestToken,
    bool Stable,
    long AcknowledgedMonotonicTicks,
    string PublicReasonCode);

public sealed record GrabAuthorization(
    string RequestToken,
    bool Authorized,
    long AuthorizedMonotonicTicks,
    long ExpiresAtUnixMs,
    string PublicReasonCode);

public sealed record SafeOffResult(
    bool Completed,
    long CompletedMonotonicTicks,
    string PublicReasonCode);

/// <summary>
/// Narrow bridge-owned boundary. Implementations coordinate lighting externally;
/// this worker never talks to Leimac and never treats a request as an acknowledgement.
/// </summary>
public interface ILightingCoordinator
{
    ValueTask<LightingRequest> RequestEvidenceRoleProfileAsync(
        string evidenceRole,
        CardSide side,
        Epochs epochs,
        CancellationToken cancellationToken);

    ValueTask<LightingStableAcknowledgement> WaitForStableAcknowledgementAsync(
        LightingRequest request,
        CancellationToken cancellationToken);

    ValueTask<GrabAuthorization> AuthorizeOneGrabAsync(
        LightingRequest request,
        LightingStableAcknowledgement acknowledgement,
        CancellationToken cancellationToken);

    ValueTask CompleteAuthorizedGrabAsync(
        LightingRequest request,
        GrabAuthorization authorization,
        CameraFrame frame,
        CancellationToken cancellationToken);

    ValueTask<SafeOffResult> SafeOffAsync(string publicReasonCode, CancellationToken cancellationToken);
}

public interface ICaptureScopedLightingCoordinator
{
    void BeginCapture(string captureRequestId);
}

public sealed record LightingProfileRequestedEvent(string CaptureRequestId, string Role, int Ordinal);

public sealed record LightingGrabCompletedEvent(
    string CaptureRequestId,
    string Role,
    string AuthorizationId,
    CameraFrame Frame);

public sealed record SafeOffRequestedEvent(string SafeOffRequestId, string Reason);

/// <summary>
/// Protocol-mediated coordinator used by real worker hosts. It cannot auto-ack:
/// each role waits for an explicit stable acknowledgement/authorization and an
/// explicit completion from the bridge after the authorized grab event.
/// </summary>
public sealed class ProtocolLightingCoordinator : ILightingCoordinator, ICaptureScopedLightingCoordinator
{
    private readonly object _gate = new();
    private PendingRole? _pending;
    private PendingSafeOff? _pendingSafeOff;
    private string? _captureRequestId;
    private int _ordinal;
    private long _safeOffSequence;

    public Func<LightingProfileRequestedEvent, CancellationToken, ValueTask>? ProfileRequested { get; set; }
    public Func<LightingGrabCompletedEvent, CancellationToken, ValueTask>? GrabCompleted { get; set; }
    public Func<SafeOffRequestedEvent, CancellationToken, ValueTask>? SafeOffRequested { get; set; }

    public void BeginCapture(string captureRequestId)
    {
        lock (_gate)
        {
            if (_pending is not null || _captureRequestId is not null)
            {
                throw new InvalidOperationException("lighting_capture_already_active");
            }

            _captureRequestId = captureRequestId;
            _ordinal = 0;
        }
    }

    public async ValueTask<LightingRequest> RequestEvidenceRoleProfileAsync(
        string evidenceRole,
        CardSide side,
        Epochs epochs,
        CancellationToken cancellationToken)
    {
        PendingRole pending;
        lock (_gate)
        {
            if (_captureRequestId is null || _pending is not null)
            {
                throw new InvalidOperationException("lighting_capture_scope_missing_or_busy");
            }

            pending = new PendingRole(_captureRequestId, evidenceRole, _ordinal++);
            _pending = pending;
        }

        var callback = ProfileRequested ?? throw new InvalidOperationException("lighting_profile_event_sink_missing");
        await callback(
            new LightingProfileRequestedEvent(pending.CaptureRequestId, pending.Role, pending.Ordinal),
            cancellationToken).ConfigureAwait(false);
        return new LightingRequest(
            pending.CaptureRequestId,
            evidenceRole,
            side,
            epochs,
            MonotonicClock.NowTicks);
    }

    public async ValueTask<LightingStableAcknowledgement> WaitForStableAcknowledgementAsync(
        LightingRequest request,
        CancellationToken cancellationToken)
    {
        var pending = GetPending(request);
        return await pending.Acknowledgement.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    public ValueTask<GrabAuthorization> AuthorizeOneGrabAsync(
        LightingRequest request,
        LightingStableAcknowledgement acknowledgement,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var pending = GetPending(request);
        if (!acknowledgement.Stable || pending.AuthorizationId is null || pending.AuthorizationExpiresAtUnixMs is null)
        {
            return ValueTask.FromResult(new GrabAuthorization(
                request.RequestToken,
                false,
                MonotonicClock.NowTicks,
                0,
                "lighting_not_authorized"));
        }

        return ValueTask.FromResult(new GrabAuthorization(
            request.RequestToken,
            true,
            MonotonicClock.NowTicks,
            pending.AuthorizationExpiresAtUnixMs.Value,
            pending.AuthorizationId));
    }

    public async ValueTask CompleteAuthorizedGrabAsync(
        LightingRequest request,
        GrabAuthorization authorization,
        CameraFrame frame,
        CancellationToken cancellationToken)
    {
        var pending = GetPending(request);
        if (!authorization.Authorized || !string.Equals(pending.AuthorizationId, authorization.PublicReasonCode, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("lighting_authorization_identity_mismatch");
        }

        var callback = GrabCompleted ?? throw new InvalidOperationException("lighting_completion_event_sink_missing");
        await callback(
            new LightingGrabCompletedEvent(pending.CaptureRequestId, pending.Role, pending.AuthorizationId!, frame),
            cancellationToken).ConfigureAwait(false);
        await pending.Completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        lock (_gate)
        {
            if (ReferenceEquals(_pending, pending))
            {
                _pending = null;
                if (pending.Ordinal == ForensicRoles.Required.Count - 1)
                {
                    _captureRequestId = null;
                }
            }
        }
    }

    public async ValueTask<SafeOffResult> SafeOffAsync(string publicReasonCode, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        PendingSafeOff pending;
        lock (_gate)
        {
            if (_pendingSafeOff is not null)
            {
                throw new InvalidOperationException("safe_off_already_pending");
            }

            var requestId = $"safe-off-{Interlocked.Increment(ref _safeOffSequence)}";
            pending = new PendingSafeOff(requestId, publicReasonCode);
            _pendingSafeOff = pending;
        }

        try
        {
            var callback = SafeOffRequested ?? throw new InvalidOperationException("safe_off_event_sink_missing");
            await callback(new SafeOffRequestedEvent(pending.RequestId, pending.Reason), cancellationToken).ConfigureAwait(false);
            var result = await pending.Completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            if (result.Completed)
            {
                lock (_gate)
                {
                    _pending = null;
                    _captureRequestId = null;
                }
            }

            return result;
        }
        finally
        {
            lock (_gate)
            {
                if (ReferenceEquals(_pendingSafeOff, pending))
                {
                    _pendingSafeOff = null;
                }
            }
        }
    }

    public void AcceptSafeOffCompletion(string safeOffRequestId, bool safe)
    {
        PendingSafeOff pending;
        lock (_gate)
        {
            pending = _pendingSafeOff ?? throw new InvalidOperationException("no_safe_off_pending");
            if (!string.Equals(pending.RequestId, safeOffRequestId, StringComparison.Ordinal))
            {
                throw new InvalidDataException("safe_off_completion_out_of_order");
            }

            if (pending.Accepted)
            {
                throw new InvalidOperationException("duplicate_safe_off_completion");
            }

            pending.Accepted = true;
            pending.Safe = safe;
        }
    }

    public void CompleteSafeOffAcceptance(string safeOffRequestId)
    {
        PendingSafeOff pending;
        lock (_gate)
        {
            pending = _pendingSafeOff ?? throw new InvalidOperationException("no_safe_off_pending");
            if (!string.Equals(pending.RequestId, safeOffRequestId, StringComparison.Ordinal) || !pending.Accepted || pending.Safe is null)
            {
                throw new InvalidDataException("safe_off_acceptance_out_of_order");
            }
        }

        var safe = pending.Safe.Value;
        pending.Completion.TrySetResult(new SafeOffResult(
            safe,
            MonotonicClock.NowTicks,
            safe ? "safe_off_complete" : "safe_off_failed"));
    }

    public void AcceptAcknowledgement(
        string captureRequestId,
        string role,
        string stableAcknowledgementId,
        string authorizationId,
        long expiresAtUnixMs)
    {
        PendingRole pending;
        lock (_gate)
        {
            pending = _pending ?? throw new InvalidOperationException("no_lighting_role_pending");
            if (!string.Equals(pending.CaptureRequestId, captureRequestId, StringComparison.Ordinal) ||
                !string.Equals(pending.Role, role, StringComparison.Ordinal))
            {
                throw new InvalidDataException("lighting_acknowledgement_out_of_order");
            }

            if (pending.AuthorizationId is not null)
            {
                throw new InvalidOperationException("duplicate_lighting_acknowledgement");
            }

            if (expiresAtUnixMs <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            {
                throw new InvalidDataException("lighting_authorization_expired");
            }

            pending.AuthorizationId = authorizationId;
            pending.AuthorizationExpiresAtUnixMs = expiresAtUnixMs;
        }

        pending.Acknowledgement.TrySetResult(new LightingStableAcknowledgement(
            captureRequestId,
            true,
            MonotonicClock.NowTicks,
            stableAcknowledgementId));
    }

    public void AcceptCompletion(string captureRequestId, string role, string authorizationId)
    {
        PendingRole pending;
        lock (_gate)
        {
            pending = _pending ?? throw new InvalidOperationException("no_lighting_grab_pending");
            if (!string.Equals(pending.CaptureRequestId, captureRequestId, StringComparison.Ordinal) ||
                !string.Equals(pending.Role, role, StringComparison.Ordinal) ||
                !string.Equals(pending.AuthorizationId, authorizationId, StringComparison.Ordinal))
            {
                throw new InvalidDataException("lighting_completion_out_of_order");
            }
        }

        pending.Completion.TrySetResult();
    }

    private PendingRole GetPending(LightingRequest request)
    {
        lock (_gate)
        {
            var pending = _pending ?? throw new InvalidOperationException("no_lighting_role_pending");
            if (!string.Equals(pending.CaptureRequestId, request.RequestToken, StringComparison.Ordinal) ||
                !string.Equals(pending.Role, request.EvidenceRole, StringComparison.Ordinal))
            {
                throw new InvalidDataException("lighting_request_identity_mismatch");
            }

            return pending;
        }
    }

    private sealed class PendingRole(string captureRequestId, string role, int ordinal)
    {
        public string CaptureRequestId { get; } = captureRequestId;
        public string Role { get; } = role;
        public int Ordinal { get; } = ordinal;
        public TaskCompletionSource<LightingStableAcknowledgement> Acknowledgement { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public string? AuthorizationId { get; set; }
        public long? AuthorizationExpiresAtUnixMs { get; set; }
    }

    private sealed class PendingSafeOff(string requestId, string reason)
    {
        public string RequestId { get; } = requestId;
        public string Reason { get; } = reason;
        public bool Accepted { get; set; }
        public bool? Safe { get; set; }
        public TaskCompletionSource<SafeOffResult> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}

public sealed class RejectingLightingCoordinator : ILightingCoordinator
{
    public ValueTask<LightingRequest> RequestEvidenceRoleProfileAsync(string evidenceRole, CardSide side, Epochs epochs, CancellationToken cancellationToken) =>
        ValueTask.FromResult(new LightingRequest("disabled", evidenceRole, side, epochs, MonotonicClock.NowTicks));

    public ValueTask<LightingStableAcknowledgement> WaitForStableAcknowledgementAsync(LightingRequest request, CancellationToken cancellationToken) =>
        ValueTask.FromResult(new LightingStableAcknowledgement(request.RequestToken, false, MonotonicClock.NowTicks, "lighting_coordinator_not_injected"));

    public ValueTask<GrabAuthorization> AuthorizeOneGrabAsync(LightingRequest request, LightingStableAcknowledgement acknowledgement, CancellationToken cancellationToken) =>
        ValueTask.FromResult(new GrabAuthorization(request.RequestToken, false, MonotonicClock.NowTicks, 0, "lighting_coordinator_not_injected"));

    public ValueTask CompleteAuthorizedGrabAsync(LightingRequest request, GrabAuthorization authorization, CameraFrame frame, CancellationToken cancellationToken) =>
        ValueTask.FromException(new InvalidOperationException("lighting_coordinator_not_injected"));

    public ValueTask<SafeOffResult> SafeOffAsync(string publicReasonCode, CancellationToken cancellationToken) =>
        ValueTask.FromResult(new SafeOffResult(false, MonotonicClock.NowTicks, "lighting_coordinator_not_injected"));
}
