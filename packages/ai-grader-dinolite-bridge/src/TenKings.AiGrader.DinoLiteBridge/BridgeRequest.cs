namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class BridgeRequest
    {
        public string? id { get; set; }
        public string? command { get; set; }
        public string? type { get; set; }
        public string? adapter { get; set; }
    }
}
