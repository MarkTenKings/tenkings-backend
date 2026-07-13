namespace TenKings.AiGrader.Worker.Core;

/// <summary>Single-reader latest-value slot. Publishing replaces an unread value.</summary>
public sealed class LatestFrameQueue<T> : IDisposable where T : class
{
    private readonly object _gate = new();
    private readonly SemaphoreSlim _available = new(0, 1);
    private T? _latest;
    private bool _disposed;
    private long _dropped;

    public long Dropped => Interlocked.Read(ref _dropped);

    public void Publish(T value)
    {
        ArgumentNullException.ThrowIfNull(value);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_latest is not null)
            {
                Interlocked.Increment(ref _dropped);
                if (_latest is IDisposable disposable)
                {
                    disposable.Dispose();
                }
            }

            _latest = value;
            if (_available.CurrentCount == 0)
            {
                _available.Release();
            }
        }
    }

    public async ValueTask<T> ReadAsync(CancellationToken cancellationToken)
    {
        await _available.WaitAsync(cancellationToken).ConfigureAwait(false);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var value = _latest ?? throw new InvalidOperationException("Latest-frame slot was signaled without a value.");
            _latest = null;
            return value;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            if (_latest is IDisposable disposable)
            {
                disposable.Dispose();
            }

            _latest = null;
            if (_available.CurrentCount > 0)
            {
                _available.Wait(0);
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            if (_latest is IDisposable disposable)
            {
                disposable.Dispose();
            }

            _latest = null;
            _available.Dispose();
        }
    }
}
