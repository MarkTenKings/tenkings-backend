import Foundation
import CAtlasPCSC

public enum ProbeFailure: String, Error {
    case noSupportedReader = "no_supported_reader"
    case ambiguousReader = "ambiguous_reader"
    case multipleReaders = "multiple_supported_readers"
    case malformedReaderList = "malformed_reader_list"
    case pcscUnavailable = "pcsc_unavailable"
    case readerUnavailable = "reader_unavailable"
    case readerBusy = "reader_busy"
    case noTag = "no_tag"
    case unsupportedATR = "unsupported_tag_atr"
    case readFailed = "read_failed"
    case invalidResponse = "invalid_response"
    case unsupportedLayout = "unsupported_header_layout"
}

public enum InspectionStage: String, Codable, CaseIterable, Sendable {
    case inputValidation = "input_validation"
    case establishContext = "establish_context"
    case connect
    case status
    case protocolValidation = "protocol_validation"
    case atrValidation = "atr_validation"
    case transmit
    case responseValidation = "response_validation"
    case disconnect
    case releaseContext = "release_context"
    case headerValidation = "header_validation"
}

public struct InspectionFailure: Error {
    public let reason: ProbeFailure
    public let stage: InspectionStage
    public let fixedReadAttempted: Bool
    public init(reason: ProbeFailure, stage: InspectionStage, fixedReadAttempted: Bool) {
        self.reason = reason; self.stage = stage; self.fixedReadAttempted = fixedReadAttempted
    }
}

// This interface intentionally has no arbitrary transmit/UID/write facility.
public protocol ReadOnlyReader {
    func readerNames() throws -> [String]
    func readType2Header(reader: String) throws -> [UInt8]
}

public struct HeaderSummary: Codable, Equatable {
    public let manufacturerCode: String
    public let cc: String
    public let ccMappingVersion: String
    public let advertisedDataBytes: Int
    public let ccWriteAccess: String
    public let staticLockCandidateBytes: String
    public let lockInterpretation: String
}

public struct ProbeResult: Codable, Equatable {
    public let status: String
    public let readOnly: Bool
    public let qualification: String
    public let supportedReaderCount: Int?
    public let supportedInterfaces: [String]?
    public let tag: HeaderSummary?
    public let failureStage: InspectionStage?
    public let fixedReadAttempted: Bool?

    public init(status: String, count: Int? = nil, tag: HeaderSummary? = nil, failure: InspectionFailure? = nil) {
        self.status = status
        self.readOnly = true
        self.qualification = "not_established"
        self.supportedReaderCount = count
        self.supportedInterfaces = count.map { Array(repeating: "ACS ACR1552U PICC", count: min($0, 32)) }
        self.tag = tag
        self.failureStage = failure?.stage
        self.fixedReadAttempted = failure?.fixedReadAttempted
    }
}

public enum Probe {
    public static func selectReader(_ names: [String]) throws -> String {
        guard names.count <= 32 else { throw ProbeFailure.malformedReaderList }
        var supported: [String] = []
        var ambiguous = false
        for name in names {
            guard !name.isEmpty, name.utf8.count <= 1024,
                  name.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value <= 126 }) else {
                throw ProbeFailure.malformedReaderList
            }
            let tokens = name.uppercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
            // An ACR1552-looking unknown interface is not silently ignored.
            guard tokens.contains(where: { $0.hasPrefix("ACR1552") }) else { continue }
            if tokens.contains("SAM") { continue }
            guard tokens.contains("ACS"), tokens.contains(where: { $0 == "ACR1552" || $0 == "ACR1552U" }),
                  tokens.contains("PICC") else { ambiguous = true; continue }
            supported.append(name)
        }
        if ambiguous { throw ProbeFailure.ambiguousReader }
        guard supported.count < 2 else { throw ProbeFailure.multipleReaders }
        guard let reader = supported.first else { throw ProbeFailure.noSupportedReader }
        return reader
    }

    public static func summarize(_ response: [UInt8]) throws -> HeaderSummary {
        guard response.count == 18 else { throw ProbeFailure.invalidResponse }
        guard response[16] == 0x90 && response[17] == 0 else { throw ProbeFailure.readFailed }
        // Standard seven-byte Type 2 header checks, with both UID BCC bytes.
        // Bytes 1...9 never enter the returned DTO. Byte 0 is only a manufacturer code.
        guard response[0] != 0, response[0] != 0xff,
              response[3] == (0x88 ^ response[0] ^ response[1] ^ response[2]),
              response[8] == (response[4] ^ response[5] ^ response[6] ^ response[7]),
              response[12] == 0xe1, response[13] == 0x10, response[14] > 0,
              response[15] == 0 || response[15] == 0x0f else { throw ProbeFailure.unsupportedLayout }
        func hex(_ bytes: ArraySlice<UInt8>) -> String { bytes.map { String(format: "%02X", $0) }.joined() }
        return HeaderSummary(manufacturerCode: String(format: "%02X", response[0]),
            cc: hex(response[12...15]), ccMappingVersion: "1.0",
            advertisedDataBytes: Int(response[14]) * 8,
            ccWriteAccess: response[15] == 0 ? "advertised_unrestricted" : "advertised_read_only",
            staticLockCandidateBytes: hex(response[10...11]),
            lockInterpretation: "unverified_for_F8215; no_dynamic_lock_read; not_write_authorization")
    }

    public static func run(inspect: Bool, backend: any ReadOnlyReader) -> ProbeResult {
        do {
            let reader = try selectReader(backend.readerNames())
            if !inspect { return ProbeResult(status: "reader_found", count: 1) }
            var response = try backend.readType2Header(reader: reader)
            defer { response.withUnsafeMutableBytes { if let base = $0.baseAddress { atlas_clear(base, $0.count) } } }
            let header: HeaderSummary
            do { header = try summarize(response) }
            catch let failure as ProbeFailure {
                throw InspectionFailure(reason: failure, stage: .headerValidation, fixedReadAttempted: true)
            }
            return ProbeResult(status: "header_observed", count: 1, tag: header)
        } catch let failure as InspectionFailure {
            return ProbeResult(status: failure.reason.rawValue, count: 1, failure: failure)
        } catch let failure as ProbeFailure {
            return ProbeResult(status: failure.rawValue, count: failure == .noSupportedReader ? 0 : nil)
        } catch {
            // Never serialize backend exceptions, reader names, ATR, buffers or digests.
            return ProbeResult(status: "probe_failed")
        }
    }
}

public final class ApplePCSCReader: ReadOnlyReader {
    public init() {}
    private func check(_ status: Int32) throws {
        if status == 0 { return }
        switch UInt32(bitPattern: status) {
        case 0x8010000c, 0x80100069: throw ProbeFailure.noTag
        case 0x8010000b: throw ProbeFailure.readerBusy
        case 0x80100017: throw ProbeFailure.readerUnavailable
        case 0xa7100001: throw ProbeFailure.unsupportedATR
        case 0xa7100002: throw ProbeFailure.invalidResponse
        default: throw ProbeFailure.pcscUnavailable
        }
    }
    public func readerNames() throws -> [String] {
        var buffer = [CChar](repeating: 0, count: 32768)
        defer { buffer.withUnsafeMutableBytes { atlas_clear($0.baseAddress!, $0.count) } }
        var length: UInt32 = 0
        try check(atlas_list_readers(&buffer, UInt32(buffer.count), &length))
        if length == 0 { return [] }
        guard length >= 2, length <= buffer.count,
              buffer[Int(length)-1] == 0, buffer[Int(length)-2] == 0 else { throw ProbeFailure.malformedReaderList }
        if length == 2 { return [] }
        let bytes = buffer.prefix(Int(length)-2).map { UInt8(bitPattern: $0) }
        return try bytes.split(separator: 0, omittingEmptySubsequences: false).map {
            guard let string = String(bytes: $0, encoding: .utf8) else { throw ProbeFailure.malformedReaderList }
            return string
        }
    }
    public func readType2Header(reader: String) throws -> [UInt8] {
        var response = [UInt8](repeating: 0, count: 18)
        var length: UInt32 = 0
        var diagnostics = AtlasInspectionDiagnostics(failure_stage: 0, fixed_read_attempted: 0)
        let status = atlas_read_type2_header(reader, &response, &length, &diagnostics)
        do { try check(status) }
        catch let failure as ProbeFailure {
            let stages: [UInt32: InspectionStage] = [
                ATLAS_STAGE_INPUT.rawValue: .inputValidation, ATLAS_STAGE_CONTEXT.rawValue: .establishContext, ATLAS_STAGE_CONNECT.rawValue: .connect, ATLAS_STAGE_STATUS.rawValue: .status,
                ATLAS_STAGE_PROTOCOL.rawValue: .protocolValidation, ATLAS_STAGE_ATR.rawValue: .atrValidation, ATLAS_STAGE_TRANSMIT.rawValue: .transmit,
                ATLAS_STAGE_RESPONSE.rawValue: .responseValidation, ATLAS_STAGE_DISCONNECT.rawValue: .disconnect, ATLAS_STAGE_RELEASE.rawValue: .releaseContext
            ]
            guard let stage = stages[diagnostics.failure_stage], diagnostics.fixed_read_attempted <= 1 else {
                // Unknown diagnostics must not invent a stage or claim no read occurred.
                throw failure
            }
            throw InspectionFailure(reason: failure, stage: stage,
                                    fixedReadAttempted: diagnostics.fixed_read_attempted == 1)
        }
        guard length == 18 else {
            throw InspectionFailure(reason: .invalidResponse, stage: .responseValidation,
                                    fixedReadAttempted: diagnostics.fixed_read_attempted == 1)
        }
        return response
    }
}
