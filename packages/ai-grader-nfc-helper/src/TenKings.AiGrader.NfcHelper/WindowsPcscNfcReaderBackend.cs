using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace TenKings.AiGrader.NfcHelper;

public sealed class WindowsPcscNfcReaderBackend : INfcReaderBackend
{
    public string Name => "windows_pcsc";

    public ReaderBackendStatus GetStatus()
    {
        if (!OperatingSystem.IsWindows()) return new(false, false, "unknown", false, "pcsc_selected_card_only", "windows_required");
        nint context = 0;
        try
        {
            Pcsc.ThrowIfFailed(Pcsc.SCardEstablishContext(Pcsc.ScopeUser, 0, 0, out context), "pcsc_unavailable");
            var readers = Pcsc.ListAcr1552PiccReaders(context);
            if (readers.Count == 0) return new(false, true, "unknown", false, "pcsc_selected_card_only", "reader_disconnected");
            if (readers.Count > 1) return new(false, true, "unknown", false, "pcsc_selected_card_only", "multiple_readers");
            var result = Pcsc.SCardConnect(context, readers[0], Pcsc.ShareShared, Pcsc.ProtocolT0 | Pcsc.ProtocolT1, out var card, out _);
            if (Pcsc.IsNoCard(result)) return new(true, true, "absent", false, "pcsc_selected_card_only");
            Pcsc.ThrowIfFailed(result, "reader_connect_failed");
            Pcsc.SCardDisconnect(card, Pcsc.LeaveCard);
            return new(true, true, "present", false, "pcsc_selected_card_only");
        }
        catch (NfcHelperException error)
        {
            return new(false, false, "unknown", false, "pcsc_selected_card_only", error.Code);
        }
        finally
        {
            if (context != 0) Pcsc.SCardReleaseContext(context);
        }
    }

    public INfcTagSession OpenSession()
    {
        if (!OperatingSystem.IsWindows()) throw new NfcHelperException("windows_required", "The real NFC backend requires Windows.", false, 503);
        return new WindowsPcscTagSession();
    }

    private sealed class WindowsPcscTagSession : INfcTagSession
    {
        private nint _context;
        private nint _card;
        private readonly uint _activeProtocol;
        private bool _disposed;

        public WindowsPcscTagSession()
        {
            Pcsc.ThrowIfFailed(Pcsc.SCardEstablishContext(Pcsc.ScopeUser, 0, 0, out _context), "pcsc_unavailable");
            try
            {
                var readers = Pcsc.ListAcr1552PiccReaders(_context);
                if (readers.Count == 0) throw new NfcHelperException("reader_disconnected", "The ACR1552U reader is disconnected.", true, 503);
                if (readers.Count > 1) throw new NfcHelperException("multiple_readers", "Connect exactly one ACR1552U reader.", true, 409);
                var result = Pcsc.SCardConnect(_context, readers[0], Pcsc.ShareExclusive, Pcsc.ProtocolT0 | Pcsc.ProtocolT1, out _card, out _activeProtocol);
                if (Pcsc.IsNoCard(result)) throw new NfcHelperException("no_tag", "Place one NTAG215 on the reader.", true, 409);
                Pcsc.ThrowIfFailed(result, "reader_connect_failed");
                Pcsc.ThrowIfFailed(Pcsc.SCardBeginTransaction(_card), "reader_busy");
            }
            catch
            {
                Dispose();
                throw;
            }
        }

        public byte[] GetVersion()
        {
            var response = Transmit(Acr1552NativeCommands.GetVersion());
            return response.Length == 8 ? response : throw Malformed();
        }

        public byte[] ReadUid()
        {
            var response = Transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
            return response.Length == 7 ? response : throw new NfcHelperException("unsupported_tag", "Place one supported NTAG215 on the reader.", false, 422);
        }

        public byte[] ReadFourPages(int startPage)
        {
            if (startPage < 3 || startPage > Ntag215Layout.LastNdefPage - 3)
                throw new NfcHelperException("unsafe_page_read", "The requested NFC page range is outside the safe read boundary.");
            var response = Transmit(Acr1552NativeCommands.Read(startPage));
            return response.Length == 16 ? response : throw new NfcHelperException("short_page_read", "The NTAG215 page read was incomplete.", true, 409);
        }

        public void WritePage(int page, ReadOnlySpan<byte> data)
        {
            if (page < Ntag215Layout.FirstNdefPage || page > Ntag215Layout.LastNdefPage || data.Length != 4)
                throw new NfcHelperException("unsafe_page_write", "The NFC write was blocked outside pages 4 through 127.");
            var command = Acr1552NativeCommands.Write(page, data);
            try
            {
                var response = Transmit(command);
                Acr1552NativeCommands.RequireWriteAck(response);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(command);
            }
        }

        private byte[] Transmit(byte[] command)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var response = new byte[1024];
            try
            {
                var responseLength = response.Length;
                var pci = new PcscIoRequest { Protocol = _activeProtocol, PciLength = checked((uint)Marshal.SizeOf<PcscIoRequest>()) };
                var result = Pcsc.SCardTransmit(_card, ref pci, command, command.Length, 0, response, ref responseLength);
                if (Pcsc.IsRemoved(result)) throw new NfcHelperException("tag_removed_mid_operation", "The tag or reader disconnected during the NFC operation.", true, 409);
                Pcsc.ThrowIfFailed(result, "pcsc_transmit_failed");
                if (responseLength < 2 || response[responseLength - 2] != 0x90 || response[responseLength - 1] != 0x00)
                    throw new NfcHelperException("reader_command_failed", "The reader rejected a fixed NTAG215 operation.", true, 409);
                return response.AsSpan(0, responseLength - 2).ToArray();
            }
            finally
            {
                CryptographicOperations.ZeroMemory(response);
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_card != 0)
            {
                Pcsc.SCardEndTransaction(_card, Pcsc.ResetCard);
                Pcsc.SCardDisconnect(_card, Pcsc.ResetCard);
                _card = 0;
            }
            if (_context != 0)
            {
                Pcsc.SCardReleaseContext(_context);
                _context = 0;
            }
        }

        private static NfcHelperException Malformed() => new("malformed_reader_response", "The reader returned a malformed tag response.", true, 502);
    }
}

public static class Acr1552NativeCommands
{
    public static byte[] GetVersion() => [0xFF, 0x00, 0x00, 0x00, 0x01, 0x60];

    public static byte[] Read(int startPage)
    {
        if (startPage < 3 || startPage > Ntag215Layout.LastNdefPage - 3)
            throw new NfcHelperException("unsafe_page_read", "The requested NFC page range is outside the safe read boundary.");
        return [0xFF, 0x00, 0x00, 0x00, 0x02, 0x30, checked((byte)startPage)];
    }

    public static byte[] Write(int page, ReadOnlySpan<byte> data)
    {
        if (page < Ntag215Layout.FirstNdefPage || page > Ntag215Layout.LastNdefPage || data.Length != 4)
            throw new NfcHelperException("unsafe_page_write", "The NFC write was blocked outside pages 4 through 127.");
        var command = new byte[11];
        command[0] = 0xFF;
        command[4] = 0x06;
        command[5] = 0xA2;
        command[6] = checked((byte)page);
        data.CopyTo(command.AsSpan(7));
        return command;
    }

    public static void RequireWriteAck(ReadOnlySpan<byte> response)
    {
        if (response.Length != 1 || response[0] != 0x0A)
            throw new NfcHelperException("tag_write_nak", "The NTAG215 rejected the page write.", true, 409);
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct PcscIoRequest
{
    public uint Protocol;
    public uint PciLength;
}

internal static partial class Pcsc
{
    internal const uint ScopeUser = 0;
    internal const uint ShareExclusive = 1;
    internal const uint ShareShared = 2;
    internal const uint ProtocolT0 = 1;
    internal const uint ProtocolT1 = 2;
    internal const uint LeaveCard = 0;
    internal const uint ResetCard = 1;
    private const int Success = 0;
    private const int NoSmartcard = unchecked((int)0x8010000C);
    private const int RemovedCard = unchecked((int)0x80100069);
    private const int ReaderUnavailable = unchecked((int)0x80100017);

    [LibraryImport("winscard.dll")]
    internal static partial int SCardEstablishContext(uint scope, nint reserved1, nint reserved2, out nint context);
    [LibraryImport("winscard.dll")]
    internal static partial int SCardReleaseContext(nint context);
    [LibraryImport("winscard.dll", EntryPoint = "SCardListReadersW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int SCardListReaders(nint context, string? groups, [Out] char[]? readers, ref int readersLength);
    [LibraryImport("winscard.dll", EntryPoint = "SCardConnectW", StringMarshalling = StringMarshalling.Utf16)]
    internal static partial int SCardConnect(nint context, string reader, uint shareMode, uint preferredProtocols, out nint card, out uint activeProtocol);
    [LibraryImport("winscard.dll")]
    internal static partial int SCardBeginTransaction(nint card);
    [LibraryImport("winscard.dll")]
    internal static partial int SCardEndTransaction(nint card, uint disposition);
    [LibraryImport("winscard.dll")]
    internal static partial int SCardDisconnect(nint card, uint disposition);
    [LibraryImport("winscard.dll")]
    internal static partial int SCardTransmit(nint card, ref PcscIoRequest sendPci, byte[] sendBuffer, int sendLength, nint receivePci, [Out] byte[] receiveBuffer, ref int receiveLength);

    internal static List<string> ListAcr1552PiccReaders(nint context)
    {
        var length = 0;
        var first = SCardListReaders(context, null, null, ref length);
        if (first != Success)
        {
            if (unchecked((uint)first) == 0x8010002E) return [];
            ThrowIfFailed(first, "reader_list_failed");
        }
        if (length <= 1) return [];
        var buffer = new char[length];
        ThrowIfFailed(SCardListReaders(context, null, buffer, ref length), "reader_list_failed");
        return SelectAcr1552PiccReaders(
            new string(buffer).Split('\0', StringSplitOptions.RemoveEmptyEntries));
    }

    internal static List<string> SelectAcr1552PiccReaders(IEnumerable<string> readerNames)
    {
        ArgumentNullException.ThrowIfNull(readerNames);
        return readerNames.Where(IsAcr1552PiccReader).ToList();
    }

    private static bool IsAcr1552PiccReader(string readerName)
    {
        if (string.IsNullOrWhiteSpace(readerName)) return false;
        var tokens = readerName.Split(
            ' ',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return tokens.Contains("ACR1552", StringComparer.OrdinalIgnoreCase) &&
               tokens.Contains("PICC", StringComparer.OrdinalIgnoreCase) &&
               !tokens.Contains("SAM", StringComparer.OrdinalIgnoreCase);
    }

    internal static bool IsNoCard(int result) => result == NoSmartcard;
    internal static bool IsRemoved(int result) => result is RemovedCard or ReaderUnavailable;

    internal static void ThrowIfFailed(int result, string code)
    {
        if (result == Success) return;
        if (IsRemoved(result)) throw new NfcHelperException("reader_disconnected", "The ACR1552U reader or tag disconnected.", true, 503);
        throw new NfcHelperException(code, "Windows PC/SC could not complete the NFC reader operation.", true, 503);
    }
}
