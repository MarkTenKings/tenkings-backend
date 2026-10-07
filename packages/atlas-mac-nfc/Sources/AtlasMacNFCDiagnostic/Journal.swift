import Foundation
import Darwin

enum JournalFailure: Error { case unavailable }

// A new file per manually supervised test, never an overwrite or replay. Each
// callback finishes a full drive flush before the native writer can proceed.
final class DiagnosticJournal {
    private var descriptor: Int32 = -1
    private var sequence = 0

    init(path: String) throws {
        guard path.hasPrefix("/"), !path.utf8.contains(0),
              !path.hasSuffix("/"), path.utf8.count < 4096 else { throw JournalFailure.unavailable }
        let url = URL(fileURLWithPath: path)
        let parent = url.deletingLastPathComponent().path
        let name = url.lastPathComponent
        guard name != ".", name != "..", !name.isEmpty else { throw JournalFailure.unavailable }
        let directory = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw JournalFailure.unavailable }
        defer { close(directory) }
        var info = stat()
        guard fstat(directory, &info) == 0, info.st_uid == getuid(),
              info.st_mode & 0o022 == 0 else { throw JournalFailure.unavailable }
        descriptor = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw JournalFailure.unavailable }
        // Retain any created file on failure. Its existence prevents silent reuse.
        guard fsync(descriptor) == 0, fsync(directory) == 0 else {
            close(descriptor); descriptor = -1; throw JournalFailure.unavailable
        }
    }

    func append(_ values: [String: Any]) throws {
        guard descriptor >= 0 else { throw JournalFailure.unavailable }
        var entry = values
        entry["sequence"] = sequence
        entry["recordedAt"] = ISO8601DateFormatter().string(from: Date())
        var data = try JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
        data.append(0x0A)
        let written = data.withUnsafeBytes { bytes -> Bool in
            guard let address = bytes.baseAddress else { return false }
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(descriptor, address.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                if count <= 0 { return false }
                offset += count
            }
            return true
        }
        guard written, fsync(descriptor) == 0, fcntl(descriptor, F_FULLFSYNC) == 0 else {
            throw JournalFailure.unavailable
        }
        sequence += 1
    }

    func closeFile() { if descriptor >= 0 { close(descriptor); descriptor = -1 } }
    deinit { closeFile() }
}
