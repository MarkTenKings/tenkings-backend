import Foundation
import AtlasMacNFC
import CAtlasPCSC
import CAtlasNFCDiagnostic

func finish(_ fields: [String: Any], status: Int32) -> Never {
    var result = fields
    result["qualification"] = "not_established"
    result["productionReady"] = false
    result["tagLockAttempted"] = false
    let data = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        ?? Data("{\"status\":\"encoding_failed\"}".utf8)
    let line = String(decoding: data, as: UTF8.self) + "\n"
    return line.withCString { atlas_finish($0, line.utf8.count, status) }
}

guard atlas_start_deadline(8000) == 0 else {
    finish(["status": "deadline_setup_failed", "tagWriteAttempted": false], status: 70)
}
let args = Array(CommandLine.arguments.dropFirst())
guard args == ["plan"] || (args.count == 3 && args[0] == "execute" && args[1] == "--journal") else {
    finish(["status": "invalid_arguments", "tagWriteAttempted": false], status: 64)
}
var bytes = [UInt8](repeating: 0, count: 64)
let size = Int(atlas_diagnostic_plan(&bytes, UInt32(bytes.count)))
guard size >= 8, size <= 64, size % 4 == 0 else {
    finish(["status": "invalid_fixed_plan", "tagWriteAttempted": false], status: 70)
}
let uri = String(cString: atlas_diagnostic_uri())
let pages = Array(5..<(4 + size / 4)) + [4]
let plan: [String: Any] = [
    "status": "diagnostic_plan", "uri": uri, "paddedNDEFBytes": size,
    "ndefTLVHex": bytes.prefix(size).map { String(format: "%02X", $0) }.joined(),
    "writePagesInOrder": pages, "commitPage": 4, "preflightDataBytes": 64,
    "tagWriteAttempted": false, "permanentLock": false,
    "scope": "one_owner_designated_unused_tag; diagnostic_URI_only; no_report_created"
]
if args == ["plan"] { finish(plan, status: 0) }

let journal: DiagnosticJournal
do {
    journal = try DiagnosticJournal(path: args[2])
    var intent = plan; intent["event"] = "diagnostic_intent"
    try journal.append(intent)
} catch {
    finish(["status": "journal_unavailable", "tagWriteAttempted": false], status: 2)
}
let reader: String
do {
    let backend = ApplePCSCReader()
    let names = try backend.readerNames()
    guard names.count == 2 && Set(names) == Set(["ACS ACR1552 1S CL Reader(1)", "ACS ACR1552 1S CL Reader(2)"]) else {
        throw ProbeFailure.ambiguousReader
    }
    reader = try backend.resolvePresentType2Interface(candidates: names)
} catch {
    var result: [String: Any] = ["status": "reader_preflight_failed", "tagWriteAttempted": false]
    if let failure = error as? ProbeFailure { result["reason"] = failure.rawValue }
    result["journalFinalized"] = (try? journal.append(result)) != nil
    journal.closeFile()
    finish(result, status: 2)
}

let callback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UInt32) -> Int32 = { context, event, page in
    guard let context, let event else { return -1 }
    let writer = Unmanaged<DiagnosticJournal>.fromOpaque(context).takeUnretainedValue()
    do { try writer.append(["event": String(cString: event), "page": page]); return 0 }
    catch { return -1 }
}
var native = AtlasDiagnosticResult()
let code = atlas_write_diagnostic(reader, callback, Unmanaged.passUnretained(journal).toOpaque(), &native)
let stages = ["none", "input", "context", "connect", "status", "atr", "header", "preflight_read",
              "not_empty", "journal", "identity", "write", "page_readback", "final_readback", "disconnect", "release"]
var result: [String: Any] = [
    "status": code == 0 ? "diagnostic_write_readback_verified" : "diagnostic_incomplete",
    "failureStage": native.stage < stages.count ? stages[Int(native.stage)] : "unknown",
    "tagWriteAttempted": native.write_attempts > 0, "writeAttempts": native.write_attempts,
    "readAttempts": native.read_attempts, "commitAttempted": native.commit_attempted != 0,
    "readbackVerified": native.readback_verified != 0, "uri": uri,
    "automaticRetryAllowed": false
]
var finalCode: Int32 = code == 0 ? 0 : 2
do { try journal.append(result); result["journalFinalized"] = true }
catch {
    result["journalFinalized"] = false; result["status"] = "diagnostic_incomplete"; finalCode = 2
}
journal.closeFile()
finish(result, status: finalCode)
