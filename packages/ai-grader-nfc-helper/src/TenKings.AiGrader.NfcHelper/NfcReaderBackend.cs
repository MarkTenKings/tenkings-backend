namespace TenKings.AiGrader.NfcHelper;

public sealed record ReaderBackendStatus(
    bool Connected,
    bool PcscReady,
    string TagState,
    bool MultipleTagDetectionSupported,
    string TagSelectionEvidence,
    string? ErrorCode = null);

public interface INfcReaderBackend
{
    string Name { get; }
    ReaderBackendStatus GetStatus();
    INfcTagSession OpenSession();
}

public interface INfcTagSession : IDisposable
{
    byte[] GetVersion();
    byte[] ReadUid();
    byte[] ReadFourPages(int startPage);
    void WritePage(int page, ReadOnlySpan<byte> data);
}

public interface ISafeLogger
{
    void Info(string eventCode, string requestId, string? safeDetail = null);
    void Error(string eventCode, string requestId, string safeErrorCode);
}

public sealed class ConsoleSafeLogger : ISafeLogger
{
    public void Info(string eventCode, string requestId, string? safeDetail = null) =>
        Console.WriteLine($"{DateTimeOffset.UtcNow:O} event={Sanitize(eventCode)} request={Sanitize(requestId)} detail={Sanitize(safeDetail ?? "none")}");

    public void Error(string eventCode, string requestId, string safeErrorCode) =>
        Console.Error.WriteLine($"{DateTimeOffset.UtcNow:O} event={Sanitize(eventCode)} request={Sanitize(requestId)} error={Sanitize(safeErrorCode)}");

    private static string Sanitize(string value)
    {
        var chars = value.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch is '_' or '-' or '.').Take(96).ToArray();
        return chars.Length == 0 ? "redacted" : new string(chars);
    }
}

public sealed class CollectingSafeLogger : ISafeLogger
{
    public List<string> Entries { get; } = [];
    public void Info(string eventCode, string requestId, string? safeDetail = null) => Entries.Add($"info:{eventCode}:{requestId}:{safeDetail}");
    public void Error(string eventCode, string requestId, string safeErrorCode) => Entries.Add($"error:{eventCode}:{requestId}:{safeErrorCode}");
}
