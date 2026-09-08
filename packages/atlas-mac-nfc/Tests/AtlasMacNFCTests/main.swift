import Foundation
// CLT ships Swift but no XCTest module. These dependency-free executable assertions
// exercise the real Swift core with an injected reader; never call native PC/SC.
func XCTAssertEqual<T: Equatable>(_ a: T, _ b: T, line: UInt = #line) { precondition(a == b, "assertion failed at line \(line)") }
func XCTAssertNotEqual<T: Equatable>(_ a: T, _ b: T, line: UInt = #line) { precondition(a != b, "assertion failed at line \(line)") }
func XCTAssertFalse(_ value: Bool, line: UInt = #line) { precondition(!value, "assertion failed at line \(line)") }
func XCTAssertNil<T>(_ value: T?, line: UInt = #line) { precondition(value == nil, "assertion failed at line \(line)") }
func XCTAssertThrowsError<T>(_ value: @autoclosure () throws -> T, line: UInt = #line) {
    do { _ = try value() } catch { return }
    preconditionFailure("expected rejection at line \(line)")
}
let tests = ProbeTests()
tests.testListsOnlySupportedInterfaceWithoutTouchingTag()
tests.testAbsentSamAmbiguousAndMultipleNeverRead()
tests.testOversizedNamesAndCountsFailClosed()
try tests.testRedactedHeaderCarriesOnlyNonidentifyingFields()
try tests.testAllUniqueIdentityBytesDoNotAffectOutput()
tests.testMalformedUnknownOrFailedReadNeverLeaksBuffer()
try tests.testBackendErrorsAreGenericAndNotRetried()
tests.testNoTagUnsupportedAndBusyRemainExplicit()
try tests.testSafeFailureStageAndAttemptArePreservedWithoutGuessing()
tests.testATRIsExactDocumentedUltralightAndNeverParsedAsIdentity()
print("{\"test\":\"swift_read_only_probe\",\"ok\":true,\"scenarios\":10}")
