namespace TenKings.AiGrader.NfcHelper;

public sealed record FakeWriteTrace(int Page, byte[] Data);

public sealed class FakeNfcReaderBackend : INfcReaderBackend
{
    private readonly object _gate = new();

    public string Name => "fake";
    public bool ReaderConnected { get; set; } = true;
    public bool PcscReady { get; set; } = true;
    public int TagCount { get; set; } = 1;
    public byte[] Version { get; set; } = Ntag215Layout.GetVersionResponse.ToArray();
    public byte[] CapabilityContainer { get; set; } = Ntag215Layout.WritableCapabilityContainer.ToArray();
    public byte[] DataArea { get; } = CreateFactoryDataArea();
    public byte[] Uid { get; set; } = [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
    public byte[]? LastUidBuffer { get; private set; }
    public int DisconnectAfterWriteCount { get; set; } = -1;
    public int OperationDelayMs { get; set; }
    public bool CorruptReadbackAfterWrite { get; set; }
    public ManualResetEventSlim? WriteBlocker { get; set; }
    public List<FakeWriteTrace> Writes { get; } = [];

    public ReaderBackendStatus GetStatus()
    {
        if (!PcscReady) return new(false, false, "unknown", true, "fake_exact_count", "pcsc_unavailable");
        if (!ReaderConnected) return new(false, true, "unknown", true, "fake_exact_count", "reader_disconnected");
        return new(true, true, TagCount switch { 0 => "absent", 1 => "present", _ => "multiple" }, true, "fake_exact_count");
    }

    public INfcTagSession OpenSession()
    {
        Delay();
        if (!PcscReady) throw new NfcHelperException("pcsc_unavailable", "Windows PC/SC is not ready.", true, 503);
        if (!ReaderConnected) throw new NfcHelperException("reader_disconnected", "The ACR1552U reader is disconnected.", true, 503);
        if (TagCount == 0) throw new NfcHelperException("no_tag", "Place one NTAG215 on the reader.", true, 409);
        if (TagCount > 1) throw new NfcHelperException("multiple_tags", "Remove extra tags and place exactly one NTAG215 on the reader.", true, 409);
        return new FakeSession(this);
    }

    public void LoadUrl(string url)
    {
        var encoded = NdefCodec.EncodeProductionUrl(url);
        var tlv = NdefCodec.EncodeType2Tlv(encoded);
        lock (_gate)
        {
            Array.Clear(DataArea);
            tlv.CopyTo(DataArea, 0);
            Writes.Clear();
        }
    }

    private static byte[] CreateFactoryDataArea()
    {
        var result = new byte[Ntag215Layout.NdefDataAreaBytes];
        result[0] = 0x03;
        result[1] = 0x00;
        result[2] = 0xFE;
        return result;
    }

    private void Delay()
    {
        if (OperationDelayMs > 0) Thread.Sleep(OperationDelayMs);
    }

    private sealed class FakeSession(FakeNfcReaderBackend owner) : INfcTagSession
    {
        private bool _disposed;

        public byte[] GetVersion()
        {
            EnsureAvailable();
            return owner.Version.ToArray();
        }

        public byte[] ReadUid()
        {
            EnsureAvailable();
            owner.LastUidBuffer = owner.Uid.ToArray();
            return owner.LastUidBuffer;
        }

        public byte[] ReadFourPages(int startPage)
        {
            EnsureAvailable();
            if (startPage < 3 || startPage > Ntag215Layout.LastNdefPage - 3)
            {
                throw new NfcHelperException("unsafe_page_read", "The requested NFC page range is outside the safe read boundary.");
            }

            var result = new byte[16];
            lock (owner._gate)
            {
                if (startPage == 3)
                {
                    owner.CapabilityContainer.CopyTo(result, 0);
                    owner.DataArea.AsSpan(0, 12).CopyTo(result.AsSpan(4));
                }
                else
                {
                    var offset = (startPage - Ntag215Layout.FirstNdefPage) * 4;
                    owner.DataArea.AsSpan(offset, 16).CopyTo(result);
                }

                if (owner.CorruptReadbackAfterWrite && owner.Writes.Count > 0 && startPage >= Ntag215Layout.FirstNdefPage)
                {
                    result[0] ^= 0x01;
                }
            }
            return result;
        }

        public void WritePage(int page, ReadOnlySpan<byte> data)
        {
            EnsureAvailable();
            if (page < Ntag215Layout.FirstNdefPage || page > Ntag215Layout.LastNdefPage || data.Length != 4)
            {
                throw new NfcHelperException("unsafe_page_write", "The NFC write was blocked outside pages 4 through 127.");
            }

            owner.WriteBlocker?.Wait(TimeSpan.FromSeconds(30));
            lock (owner._gate)
            {
                if (owner.DisconnectAfterWriteCount >= 0 && owner.Writes.Count >= owner.DisconnectAfterWriteCount)
                {
                    owner.ReaderConnected = false;
                    throw new NfcHelperException("tag_removed_mid_write", "The tag or reader disconnected during programming.", true, 409);
                }
                var bytes = data.ToArray();
                bytes.CopyTo(owner.DataArea, (page - Ntag215Layout.FirstNdefPage) * 4);
                owner.Writes.Add(new FakeWriteTrace(page, bytes));
            }
        }

        public void Dispose() => _disposed = true;

        private void EnsureAvailable()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(FakeSession));
            owner.Delay();
            if (!owner.ReaderConnected) throw new NfcHelperException("reader_disconnected", "The ACR1552U reader is disconnected.", true, 503);
        }
    }
}
