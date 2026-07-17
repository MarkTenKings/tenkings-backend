namespace TenKings.AiGrader.NfcHelper;

/// <summary>One physical NFC operation across every adapter.</summary>
public sealed class NfcOperationGate : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    public bool Busy => _gate.CurrentCount == 0;

    public Task<bool> TryEnterAsync(CancellationToken cancellationToken) =>
        _gate.WaitAsync(0, cancellationToken);

    public void Exit()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _gate.Release();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _gate.Dispose();
    }
}
