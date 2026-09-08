import Foundation
import AtlasMacNFC
import CAtlasPCSC

final class FixtureReader: ReadOnlyReader {
    var names = ["ACS ACR1552U PICC Interface 00 00"]
    var response: [UInt8] = [0x04,0x17,0xA9,0x32,0xCA,0x12,0x83,0xBA,0xE1,0x48,0x00,0x01,0xE1,0x10,0x3E,0x00,0x90,0]
    var reads = 0
    var failure: Error?
    var resolutions = 0
    var resolvedReader = "ACS ACR1552 1S CL Reader(2)"
    var resolutionFailure: ProbeFailure?
    var readTarget: String?
    func readerNames() throws -> [String] { names }
    func resolvePresentType2Interface(candidates: [String]) throws -> String {
        resolutions += 1
        if let resolutionFailure { throw resolutionFailure }
        return resolvedReader
    }
    func readType2Header(reader: String) throws -> [UInt8] {
        reads += 1
        readTarget = reader
        if let failure { throw failure }
        return response
    }
}

final class ProbeTests {
    func testMacVendorListDoesNotResolveOrReadAnInterface() {
        let fixture = FixtureReader()
        fixture.names = ["ACS ACR1552 1S CL Reader(1)", "ACS ACR1552 1S CL Reader(2)"]
        let result = Probe.run(inspect: false, backend: fixture)
        XCTAssertEqual(result.status, "reader_interfaces_found")
        XCTAssertEqual(result.candidateInterfaceCount, 2)
        XCTAssertNil(result.supportedReaderCount)
        XCTAssertEqual(fixture.resolutions, 0)
        XCTAssertEqual(fixture.reads, 0)
    }
    func testMacVendorInspectUsesObservedInterfaceRegardlessOfOrder() {
        for reversed in [false, true] {
            for ordinal in [1, 2] {
                let fixture = FixtureReader()
                let names = ["ACS ACR1552 1S CL Reader(1)", "ACS ACR1552 1S CL Reader(2)"]
                fixture.names = reversed ? Array(names.reversed()) : names
                fixture.resolvedReader = "ACS ACR1552 1S CL Reader(\(ordinal))"
                XCTAssertEqual(Probe.run(inspect: true, backend: fixture).status, "header_observed")
                XCTAssertEqual(fixture.readTarget, fixture.resolvedReader)
                XCTAssertEqual(fixture.resolutions, 1)
                XCTAssertEqual(fixture.reads, 1)
            }
        }
    }
    func testMacVendorAmbiguityAndOutOfSetResolutionNeverRead() {
        let pair = ["ACS ACR1552 1S CL Reader(1)", "ACS ACR1552 1S CL Reader(2)"]
        for names in [[pair[0]], [pair[0], pair[0]], pair + ["Other Reader"],
                      [pair[0], "ACS ACR1552 1S CL Reader(3)"], pair + ["ACS ACR1552U PICC 00"]] {
            let fixture = FixtureReader(); fixture.names = names
            XCTAssertNotEqual(Probe.run(inspect: true, backend: fixture).status, "header_observed")
            XCTAssertEqual(fixture.resolutions, 0)
            XCTAssertEqual(fixture.reads, 0)
        }
        let fixture = FixtureReader(); fixture.names = pair; fixture.resolvedReader = "unrelated"
        XCTAssertEqual(Probe.run(inspect: true, backend: fixture).status, "ambiguous_reader")
        XCTAssertEqual(fixture.reads, 0)
    }
    func testMacVendorPresenceFailuresStopBeforeConnectionOrRead() {
        for failure in [ProbeFailure.noTag, .unsupportedATR, .readerBusy, .ambiguousReader, .pcscUnavailable] {
            let fixture = FixtureReader()
            fixture.names = ["ACS ACR1552 1S CL Reader(1)", "ACS ACR1552 1S CL Reader(2)"]
            fixture.resolutionFailure = failure
            let result = Probe.run(inspect: true, backend: fixture)
            XCTAssertEqual(result.status, failure.rawValue)
            XCTAssertEqual(result.failureStage, .interfaceResolution)
            XCTAssertEqual(result.fixedReadAttempted, false)
            XCTAssertNil(result.supportedReaderCount)
            XCTAssertEqual(result.candidateInterfaceCount, 2)
            XCTAssertEqual(fixture.reads, 0)
        }
    }
    func testListsOnlySupportedInterfaceWithoutTouchingTag() {
        let fixture = FixtureReader()
        fixture.names += ["ACS ACR1552U SAM Interface 00 01", "Other Reader 01"]
        let result = Probe.run(inspect: false, backend: fixture)
        XCTAssertEqual(result.status, "reader_found")
        XCTAssertEqual(result.supportedInterfaces, ["ACS ACR1552U PICC"])
        XCTAssertEqual(fixture.reads, 0)
    }
    func testAbsentSamAmbiguousAndMultipleNeverRead() {
        for names in [[], ["ACS ACR1552U SAM 00"], ["ACS ACR1552U"],
                      ["ACS ACR1552U PICC 00", "ACS ACR1552 PICC 01"],
                      ["ACS ACR1552U PICC 00", "ACS ACR1552X PICC 01"],
                      ["Other ACR1552U PICC 00"], ["ACS ACR1552U PICC\nsecret"]] {
            let fixture = FixtureReader(); fixture.names = names
            let result = Probe.run(inspect: true, backend: fixture)
            XCTAssertNotEqual(result.status, "header_observed")
            XCTAssertEqual(fixture.reads, 0)
        }
    }
    func testOversizedNamesAndCountsFailClosed() {
        for names in [Array(repeating: "Other", count: 33), [String(repeating: "A", count: 1025)]] {
            XCTAssertThrowsError(try Probe.selectReader(names))
        }
    }
    func testRedactedHeaderCarriesOnlyNonidentifyingFields() throws {
        let fixture = FixtureReader()
        let result = Probe.run(inspect: true, backend: fixture)
        XCTAssertEqual(result.status, "header_observed")
        XCTAssertEqual(result.qualification, "not_established")
        XCTAssertEqual(result.tag?.manufacturerCode, "04")
        XCTAssertEqual(result.tag?.cc, "E1103E00")
        XCTAssertEqual(result.tag?.advertisedDataBytes, 496)
        XCTAssertEqual(result.tag?.staticLockCandidateBytes, "0001")
        let json = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
        XCTAssertFalse(json.contains("0417A9"))
        XCTAssertFalse(json.contains("CA1283BA"))
        XCTAssertFalse(json.contains("Interface 00 00"))
        XCTAssertFalse(json.lowercased().contains("uid"))
        XCTAssertFalse(json.lowercased().contains("digest"))
        XCTAssertEqual(fixture.reads, 1)
    }
    func testAllUniqueIdentityBytesDoNotAffectOutput() throws {
        let fixture = FixtureReader()
        let reference = try Probe.summarize(fixture.response)
        for position in [1,2,4,5,6,7,9] {
            var changed = fixture.response
            changed[position] ^= 0x57
            changed[3] = 0x88 ^ changed[0] ^ changed[1] ^ changed[2]
            changed[8] = changed[4] ^ changed[5] ^ changed[6] ^ changed[7]
            XCTAssertEqual(try Probe.summarize(changed), reference)
        }
    }
    func testMalformedUnknownOrFailedReadNeverLeaksBuffer() {
        let base = FixtureReader().response
        var cases = [[UInt8](), Array(base.dropLast()), base + [1], [UInt8](repeating: 0, count: 18)]
        for index in [3,8,12,13,14,15,16,17] {
            var changed = base; changed[index] = index == 14 ? 0 : (changed[index] ^ 0xff); cases.append(changed)
        }
        for response in cases {
            let fixture = FixtureReader(); fixture.response = response
            let result = Probe.run(inspect: true, backend: fixture)
            XCTAssertNil(result.tag)
            XCTAssertNotEqual(result.status, "header_observed")
        }
    }
    func testBackendErrorsAreGenericAndNotRetried() throws {
        struct PrivateFailure: Error { let secret = "never-print-me" }
        let fixture = FixtureReader(); fixture.failure = PrivateFailure()
        let result = Probe.run(inspect: true, backend: fixture)
        XCTAssertEqual(result.status, "probe_failed")
        XCTAssertNil(result.failureStage)
        XCTAssertNil(result.fixedReadAttempted)
        XCTAssertEqual(fixture.reads, 1)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(result), as: UTF8.self).contains("never-print"))
    }
    func testNoTagUnsupportedAndBusyRemainExplicit() {
        for failure in [ProbeFailure.noTag, .unsupportedATR, .readerBusy] {
            let fixture = FixtureReader(); fixture.failure = failure
            XCTAssertEqual(Probe.run(inspect: true, backend: fixture).status, failure.rawValue)
            XCTAssertEqual(fixture.reads, 1)
        }
    }
    func testSafeFailureStageAndAttemptArePreservedWithoutGuessing() throws {
        for stage in InspectionStage.allCases {
            let attempted = [.transmit, .responseValidation, .disconnect, .releaseContext, .headerValidation].contains(stage)
            let fixture = FixtureReader()
            fixture.failure = InspectionFailure(reason: .noTag, stage: stage, fixedReadAttempted: attempted)
            let result = Probe.run(inspect: true, backend: fixture)
            XCTAssertEqual(result.status, "no_tag")
            XCTAssertEqual(result.failureStage, stage)
            XCTAssertEqual(result.fixedReadAttempted, attempted)
            XCTAssertEqual(fixture.reads, 1)
            let decoded = try JSONDecoder().decode(ProbeResult.self, from: JSONEncoder().encode(result))
            XCTAssertEqual(decoded, result)
        }
        let fixture = FixtureReader(); fixture.response[16] = 0x63
        let result = Probe.run(inspect: true, backend: fixture)
        XCTAssertEqual(result.failureStage, .headerValidation)
        XCTAssertEqual(result.fixedReadAttempted, true)
    }
    func testATRIsExactDocumentedUltralightAndNeverParsedAsIdentity() {
        var atr: [UInt8] = [0x3B,0x8F,0x80,0x01,0x80,0x4F,0x0C,0xA0,0,0,3,6,3,0,3,0,0,0,0,0x68]
        XCTAssertEqual(atlas_is_ultralight_atr(atr, atr.count), 1)
        for position in atr.indices {
            var changed = atr; changed[position] ^= 1
            XCTAssertEqual(atlas_is_ultralight_atr(changed, changed.count), 0)
        }
        atr.append(1)
        XCTAssertEqual(atlas_is_ultralight_atr(atr, atr.count), 0)
    }
}
