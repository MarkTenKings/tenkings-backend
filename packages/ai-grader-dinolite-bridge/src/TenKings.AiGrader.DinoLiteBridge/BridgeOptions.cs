using System;

namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class BridgeOptions
    {
        public string Adapter { get; private set; } = "fake";
        public bool ManualEnumerate { get; private set; }
        public bool ManualHardwareAccess { get; private set; }

        public static BridgeOptions Parse(string[] args)
        {
            var options = new BridgeOptions();
            for (var index = 0; index < args.Length; index += 1)
            {
                var arg = args[index];
                if (arg == "--adapter")
                {
                    options.Adapter = ReadValue(args, index, "--adapter").Trim().ToLowerInvariant();
                    index += 1;
                }
                else if (arg == "--manual-enumerate")
                {
                    options.ManualEnumerate = true;
                    options.ManualHardwareAccess = true;
                }
                else if (arg == "--manual-hardware")
                {
                    options.ManualHardwareAccess = true;
                }
                else
                {
                    throw new ArgumentException("Unknown option: " + arg);
                }
            }

            return options;
        }

        private static string ReadValue(string[] args, int index, string name)
        {
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException(name + " requires a value.");
            }

            return args[index + 1];
        }
    }
}
