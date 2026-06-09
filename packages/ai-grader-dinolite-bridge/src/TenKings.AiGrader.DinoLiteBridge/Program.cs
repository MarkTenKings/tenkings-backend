using System;

namespace TenKings.AiGrader.DinoLiteBridge
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            var options = BridgeOptions.Parse(args);
            var adapter = BridgeAdapterFactory.Create(options);
            var server = new JsonLineBridgeServer(adapter, Console.In, Console.Out);
            return server.Run();
        }
    }
}
