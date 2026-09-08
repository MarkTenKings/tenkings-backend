import Foundation
import AtlasMacNFC
import CAtlasPCSC

// An independent native watchdog terminates this one-shot process even when PC/SC
// connect, transmit, or cleanup blocks. No retry and no resident background process.
func finish(_ result: ProbeResult, status: Int32) -> Never {
    let data = (try? JSONEncoder().encode(result)) ?? Data("{\"status\":\"encoding_failed\"}".utf8)
    let line = String(decoding: data, as: UTF8.self) + "\n"
    return line.withCString { atlas_finish($0, line.utf8.count, status) }
}
guard atlas_start_deadline(8000) == 0 else {
    finish(ProbeResult(status: "deadline_setup_failed"), status: 70)
}
let args = Array(CommandLine.arguments.dropFirst())
if args == ["--help"] {
    let help = "Usage: atlas-mac-nfc-probe list|inspect\nRead-only, one shot, eight-second maximum. No UID/ATR output, writes, locks or F8215 qualification.\n"
    help.withCString { atlas_finish($0, help.utf8.count, 0) }
}
guard args == ["list"] || args == ["inspect"] else {
    finish(ProbeResult(status: "invalid_arguments"), status: 64)
}
let result = Probe.run(inspect: args == ["inspect"], backend: ApplePCSCReader())
finish(result, status: ["reader_found", "reader_interfaces_found", "header_observed"].contains(result.status) ? 0 : 2)
