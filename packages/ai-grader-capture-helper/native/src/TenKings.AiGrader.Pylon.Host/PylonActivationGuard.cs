namespace TenKings.AiGrader.Pylon.Host;

public static class PylonActivationGuard
{
    public const string RequiredAcknowledgement = "TENKINGS_PYLON_HARDWARE_ACK_V1";

    public static bool IsSdkCompiled
    {
        get
        {
#if PYLON_SDK
            return true;
#else
            return false;
#endif
        }
    }

    internal static bool TryAuthorize(string[] args, out PylonActivationPermit? permit, out string publicReason)
    {
        permit = null;
        if (!IsSdkCompiled)
        {
            publicReason = "pylon_sdk_not_compiled";
            return false;
        }

        if (!args.Contains("--enable-native", StringComparer.Ordinal) ||
            !args.Contains("--activate-pylon", StringComparer.Ordinal) ||
            !args.Contains($"--activation-ack={RequiredAcknowledgement}", StringComparer.Ordinal))
        {
            publicReason = "pylon_activation_not_explicitly_authorized";
            return false;
        }

        permit = new PylonActivationPermit();
        publicReason = "authorized";
        return true;
    }
}

internal sealed class PylonActivationPermit
{
    internal PylonActivationPermit()
    {
    }
}
