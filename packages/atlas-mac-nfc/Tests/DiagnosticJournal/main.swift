import Foundation
import Darwin

let root = FileManager.default.temporaryDirectory.appendingPathComponent("atlas-diagnostic-journal-" + UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
defer { try? FileManager.default.removeItem(at: root) }
let path = root.appendingPathComponent("intent.jsonl").path
let journal = try DiagnosticJournal(path: path)
try journal.append(["event": "intent", "page": 5])
try journal.append(["event": "verified", "page": 5])
journal.closeFile()
let original = try Data(contentsOf: URL(fileURLWithPath: path))
let lines = original.split(separator: 10)
assert(lines.count == 2)
for (index, line) in lines.enumerated() {
    let record = try JSONSerialization.jsonObject(with: Data(line)) as! [String: Any]
    assert(record["sequence"] as? Int == index && record["page"] as? Int == 5)
}
var info = stat(); assert(stat(path, &info) == 0 && info.st_mode & 0o777 == 0o600)
func rejected(_ operation: () throws -> Void) {
    do { try operation(); fatalError("expected rejection") } catch {}
}
rejected { _ = try DiagnosticJournal(path: path) }
let afterExisting = try Data(contentsOf: URL(fileURLWithPath: path))
assert(afterExisting == original)
let link = root.appendingPathComponent("link.jsonl").path
assert(symlink(path, link) == 0)
rejected { _ = try DiagnosticJournal(path: link) }
let afterSymlink = try Data(contentsOf: URL(fileURLWithPath: path))
assert(afterSymlink == original)
rejected { _ = try DiagnosticJournal(path: "relative.jsonl") }
rejected { _ = try DiagnosticJournal(path: root.appendingPathComponent("missing/intent.jsonl").path) }
rejected { try journal.append(["event": "closed"]) }
assert(chmod(root.path, 0o777) == 0)
rejected { _ = try DiagnosticJournal(path: root.appendingPathComponent("unsafe-parent.jsonl").path) }
assert(chmod(root.path, 0o700) == 0)
print("{\"test\":\"durable_diagnostic_journal\",\"ok\":true,\"scenarios\":7}")
