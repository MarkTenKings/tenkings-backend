namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class BridgeRequest
    {
        public string? id { get; set; }
        public string? command { get; set; }
        public string? type { get; set; }
        public string? adapter { get; set; }
        public int? deviceIndex { get; set; }
        public string? outputDir { get; set; }
        public string? sdkRuntimeDir { get; set; }
        public string? label { get; set; }
        public string? plan { get; set; }
        public bool? includeLightingSweep { get; set; }
        public bool? includeFlcSweep { get; set; }
        public bool? includeEdr { get; set; }
        public bool? includeEdof { get; set; }
    }
}
