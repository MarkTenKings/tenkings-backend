using System;

namespace TenKings.AiGrader.DinoLiteBridge
{
    public static class BridgeAdapterFactory
    {
        public static IDinoLiteBridgeAdapter Create(BridgeOptions options)
        {
            if (options.Adapter == "fake")
            {
                return new FakeDinoLiteAdapter();
            }

            if (options.Adapter == "dnvideox")
            {
                return new DnVideoXAdapter(options);
            }

            throw new ArgumentException("Adapter must be fake or dnvideox.");
        }
    }
}
