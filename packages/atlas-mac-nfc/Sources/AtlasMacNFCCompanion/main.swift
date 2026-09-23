import Foundation
import Darwin
import AtlasMacNFCCompanionCore
import CAtlasNFCCompanion

func emit(_ value: [String: Any]) {
    let bytes = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{\"error\":\"COMPANION_OUTPUT_FAILED\"}".utf8)
    FileHandle.standardOutput.write(bytes + Data([10]))
}
func boundedLine() throws -> Data? {
    var bytes = Data(), byte: UInt8 = 0
    while true {
        let count = read(STDIN_FILENO, &byte, 1)
        if count == 0 { if bytes.isEmpty { return nil }; throw CompanionFailure("COMPANION_INCOMPLETE_INPUT") }
        if count < 0 { if errno == EINTR { continue }; throw CompanionFailure("COMPANION_INPUT_FAILED") }
        if byte == 10 { return bytes }; bytes.append(byte)
        if bytes.count > 32768 { throw CompanionFailure("COMPANION_INPUT_TOO_LARGE") }
    }
}
guard atlas_companion_start_watchdog() == 0 else { emit(["error": "COMPANION_WATCHDOG_FAILED"]); exit(70) }
let args = Array(CommandLine.arguments.dropFirst())
do {
    if args == ["capabilities"] { emit(companionCapabilities); exit(0) }
    if args.count == 3 && args[0] == "full-sync" && args[1] == "--fd", let descriptor = Int32(args[2]), descriptor >= 3 {
        guard atlas_companion_full_sync(descriptor) == 0 else { throw CompanionFailure("COMPANION_FULL_SYNC_FAILED") }; emit(["synced": true]); exit(0)
    }
    guard args.count == 3 && ["serve", "key-info", "init-key"].contains(args[0]) && args[1] == "--configuration" else { throw CompanionFailure("COMPANION_ARGUMENTS_INVALID") }
    let config = try readCompanionConfiguration(args[2])
    if args[0] == "key-info" { emit(try ProtectedCompanionKeyStore().identity(config)); exit(0) }
    if args[0] == "init-key" { emit(try ProtectedCompanionKeyStore().initialize(config, configurationPath: args[2])); exit(0) }
    let runtime = CompanionRuntime(configuration: config)
    defer { runtime.close() }
    while true {
        guard atlas_companion_deadline(30000) == 0 else { throw CompanionFailure("COMPANION_WATCHDOG_FAILED") }
        guard let bytes = try boundedLine() else { break }
        guard atlas_companion_deadline(6500) == 0 else { throw CompanionFailure("COMPANION_WATCHDOG_FAILED") }
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw CompanionFailure("COMPANION_INPUT_INVALID") }
        emit(runtime.handle(object))
    }
} catch let error as CompanionFailure { emit(["error": error.code]); exit(64) }
catch { emit(["error": "COMPANION_REQUEST_REFUSED"]); exit(64) }
