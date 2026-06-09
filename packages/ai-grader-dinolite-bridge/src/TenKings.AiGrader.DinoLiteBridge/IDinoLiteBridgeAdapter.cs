namespace TenKings.AiGrader.DinoLiteBridge
{
    public interface IDinoLiteBridgeAdapter
    {
        object Health();
        object SdkInfo();
        object ListDevices();
        object Capabilities();
        object EnumerateDevices();
        object Status(int deviceIndex);
        object CaptureStillJpg(int deviceIndex, string? outputDir);
        object GetLightingStatus(int deviceIndex);
        object SetLightingRecipe(int deviceIndex, string? recipeName);
        object CapturePackage(int deviceIndex, string? outputDir, string? label, bool includeLightingSweep, bool includeEdr, bool includeEdof);
        object RuntimeDiagnostics();
    }
}
