namespace TenKings.AiGrader.DinoLiteBridge
{
    public interface IDinoLiteBridgeAdapter
    {
        object Health();
        object SdkInfo();
        object ListDevices();
        object Capabilities();
        object EnumerateDevices();
    }
}
