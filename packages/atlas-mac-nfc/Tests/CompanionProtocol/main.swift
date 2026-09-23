import Foundation
import CryptoKit
import Darwin
import AtlasMacNFCCompanionCore

// Ephemeral CPU-only fixture keys. This target never constructs a Keychain
// provider, invokes production PC/SC methods, or creates an enrolled station key.
final class FixtureKeyStore: CompanionKeyStore {
    let key: P256.Signing.PrivateKey; var signs = 0
    init(key: P256.Signing.PrivateKey = P256.Signing.PrivateKey()) { self.key = key }
    func identity(_ config: CompanionConfiguration) throws -> [String: Any] {
        ["publicKeySpki": key.publicKey.derRepresentation.base64EncodedString()]
    }
    func sign(_ bytes: Data, configuration: CompanionConfiguration) throws -> Data { signs += 1; return try key.signature(for: bytes).derRepresentation }
}
final class FixtureDriver: CompanionDriver {
    var qualifiedProfileAvailable = true, readbackVerified = false, lockVerified = false, removalObserved = false
    var operations: [String] = []
    func close() { operations.append("close") }
    func perform(_ op: String, input: [String: Any], arm: CompanionArm) throws -> [String: Any] {
        operations.append(op)
        if op == "open" { return ["opened": true] }
        if op == "lock-qualified" { lockVerified = true; return ["locked": true] }
        if op == "wait-removed" { removalObserved = true; return ["removed": true] }
        if op == "observe-empty" { removalObserved = true; return ["empty": true] }
        return [:]
    }
}
func requireTest(_ ok: Bool, _ name: String) { if !ok { fputs("fixture failed: \(name)\n", stderr); exit(1) } }
// The separate test executable alone offers a CPU-key/fake-reader RPC fixture.
// The shipping companion has no environment-selected key or hardware provider.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--interop-fixture" {
    let config = try readCompanionConfiguration(CommandLine.arguments[2])
    guard let encoded = ProcessInfo.processInfo.environment["ATLAS_TEST_CPU_KEY"], let bytes = Data(base64Encoded: encoded) else { exit(64) }
    let runtime = CompanionRuntime(configuration: config, driver: FixtureDriver(), keyStore: FixtureKeyStore(key: try P256.Signing.PrivateKey(derRepresentation: bytes)))
    while let line = readLine() {
        let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String:Any]
        print(String(data:try JSONSerialization.data(withJSONObject:runtime.handle(request),options:[.sortedKeys,.withoutEscapingSlashes]),encoding:.utf8)!)
    }
    exit(0)
}
let hostKey = P256.Signing.PrivateKey(), keyStore = FixtureKeyStore(), driver = FixtureDriver()
let qualification = String(repeating: "a", count: 64), planHash = String(repeating: "b", count: 64)
var profile: [String: Any] = ["id": "atlas-mac-f8215-production-v1", "qualificationHash": qualification, "firstUserPage": 4, "lastUserPage": 63]
profile["profileHash"] = companionHash(try companionCanonical(profile))
let rawConfig: [String: Any] = ["version": "atlas-mac-companion-config-v1", "stationId": "fixture-station", "enrollmentId": "11111111-1111-4111-8111-111111111111",
    "keyId": "fixture-key", "hostKeyId": "fixture-host", "hostPublicKeySpki": hostKey.publicKey.derRepresentation.base64EncodedString(),
    "protectionEvidenceHash": String(repeating: "e",count:64), "profile": profile]
let config = try CompanionConfiguration(rawConfig)
func envelope(_ claims: [String: Any]) throws -> [String: Any] {
    let bytes = try companionCanonical(claims)
    return ["version": "atlas-mac-station-signed-v1", "keyId": "fixture-host", "algorithm": "ES256-DER",
        "payload": companionBase64URL(bytes), "signature": companionBase64URL(try hostKey.signature(for: bytes).derRepresentation)]
}
let url = "https://atlasgrading.com/reports/ar_abcdefghijklmnopqrstuvwx?v=3", suffix = Data(url.dropFirst(8).utf8)
var ndef = Data([3,UInt8(suffix.count+5),0xd1,1,UInt8(suffix.count+1),0x55,4]); ndef.append(suffix); ndef.append(0xfe)
while ndef.count % 4 != 0 { ndef.append(0) }
var claims: [String: Any] = ["version":"atlas-mac-nfc-arm-v1", "origin":"https://atlasgrading.com", "stationId":rawConfig["stationId"]!,
    "enrollmentId":rawConfig["enrollmentId"]!, "keyId":rawConfig["keyId"]!, "intentId":"afnfc_\(planHash)", "planHash":planHash,
    "profileHash":profile["profileHash"]!, "qualificationHash":qualification, "activationId":"fixture-activation",
    "cardId":"22222222-2222-4222-8222-222222222222", "approvalActionId":"33333333-3333-4333-8333-333333333333",
    "publicHash":String(repeating:"c",count:64), "reportHash":String(repeating:"d",count:64), "approvalVersion":3,
    "reportNumber":"ATLAS-ABCDEFGHIJKL", "url":url, "ndefHash":companionHash(ndef), "firstUserPage":4, "lastUserPage":63,
    "nonce":String(repeating:"x",count:43), "issuedAt":1000, "expiresAt":100000]
var now: Int64 = 2000
let runtime = CompanionRuntime(configuration:config,driver:driver,keyStore:keyStore,clock:{ now })
@MainActor func call(_ op:String, _ fields:[String:Any]=[:]) -> [String:Any] { runtime.handle(fields.merging(["id":"fixture-request", "op":op]) { _,b in b }) }
func result(_ value:[String:Any]) -> [String:Any] { requireTest(value["ok"] as? Bool == true,"response ok"); return value["result"] as! [String:Any] }
func refused(_ value:[String:Any]) { requireTest(value["ok"] as? Bool == false,"response refused") }
refused(call("open")); requireTest(driver.operations.isEmpty,"cold session")
var forged = try envelope(claims); forged["signature"] = companionBase64URL(Data(repeating:0,count:64)); refused(call("arm",["envelope":forged]))
for key in ["url","ndefHash","profileHash","enrollmentId","origin"] {
    var wrong = claims; wrong[key] = "wrong"; refused(call("arm",["envelope":try envelope(wrong)]))
}
var wrong = claims; wrong["expiresAt"] = 2000; refused(call("arm",["envelope":try envelope(wrong)]))
wrong=claims; wrong["extra"]="refuse"; refused(call("arm",["envelope":try envelope(wrong)]))
let arm = try CompanionArm(claims,configuration:config,now:now)
requireTest(result(call("arm",["envelope":try envelope(claims)]))["state"] as? String == "WAITING_FOR_TAG","signed arm")
refused(call("transmit",["apdu":"ffd600030400000000"])); refused(call("write4",["page":3,"hex":"00000000"])); requireTest(driver.operations.isEmpty,"no arbitrary native operation")
_ = result(call("open")); refused(call("sign-receipt",["receipt":arm.result])); requireTest(keyStore.signs==0,"no unverified receipt")
driver.readbackVerified=true; _ = result(call("lock-qualified"))
let written = result(call("sign-receipt",["receipt":arm.result])); requireTest(keyStore.signs==1,"signed verified result")
let receiptHash = companionHash(try companionCanonical(arm.result))
let removal:[String:Any] = ["version":"atlas-mac-nfc-removal-v1", "stationId":claims["stationId"]!,"enrollmentId":claims["enrollmentId"]!,"keyId":claims["keyId"]!,
    "intentId":claims["intentId"]!,"planHash":planHash,"authorizationHash":arm.authorizationHash,"nonce":claims["nonce"]!,"receiptHash":receiptHash,"removalObserved":true]
refused(call("sign-removal",["receipt":removal]))
let ack:[String:Any] = ["version":"atlas-mac-nfc-ack-v1","kind":"WRITE","intentId":claims["intentId"]!,"receiptHash":receiptHash,
    "enrollmentId":claims["enrollmentId"]!,"stationId":claims["stationId"]!,"planHash":planHash,"authorizationHash":arm.authorizationHash,"committed":true,"recordedAt":3000]
_ = result(call("accept-ack",["envelope":try envelope(ack)])); refused(call("sign-removal",["receipt":removal]))
_ = result(call("wait-removed",["timeoutMs":5000])); _ = result(call("sign-removal",["receipt":removal])); requireTest(keyStore.signs==2,"observed removal signed")
now=200000; _ = result(call("accept-ack",["envelope":try envelope(ack)])); refused(call("write4",["page":5,"hex":"00000000"])); refused(call("sign-removal",["receipt":removal])); requireTest(keyStore.signs==2,"expiry no new signing")
// Cold native capability is authoritative: browser/config cannot supply lock bytes.
let unqualifiedDriver = FixtureDriver(); unqualifiedDriver.qualifiedProfileAvailable=false
let unqualified = CompanionRuntime(configuration:config,driver:unqualifiedDriver,keyStore:keyStore,clock:{ 2000 })
let armed = unqualified.handle(["id":"fixture","op":"arm","envelope":try envelope(claims)])
requireTest(result(armed)["state"] as? String == "VERIFIED_UNQUALIFIED","unqualified state")
refused(unqualified.handle(["id":"fixture","op":"open"])); requireTest(unqualifiedDriver.operations.isEmpty,"unqualified no RF")
now=2000
let recoveryDriver = FixtureDriver()
let recovered = CompanionRuntime(configuration:config,driver:recoveryDriver,keyStore:keyStore,clock:{ 2000 })
let restore:[String:Any] = ["id":"fixture","op":"restore-receipt","envelope":try envelope(claims),"receipt":arm.result,"signature":written["signature"]!]
requireTest(result(recovered.handle(restore))["restored"] as? Bool == true,"signed custody restored")
refused(recovered.handle(["id":"fixture","op":"open"])); refused(recovered.handle(["id":"fixture","op":"write4","page":5,"hex":"00000000"]))
refused(recovered.handle(["id":"fixture","op":"sign-receipt","receipt":arm.result]))
_ = result(recovered.handle(["id":"fixture","op":"accept-ack","envelope":try envelope(ack)]))
refused(recovered.handle(["id":"fixture","op":"sign-removal","receipt":removal]))
_ = result(recovered.handle(["id":"fixture","op":"observe-empty"]))
_ = result(recovered.handle(["id":"fixture","op":"sign-removal","receipt":removal]))
requireTest(!recoveryDriver.operations.contains("open") && !recoveryDriver.operations.contains("write4"),"restart no physical rewrite")
let challenge:[String:Any] = ["version":"atlas-mac-station-enrollment-challenge-v1","challengeId":"44444444-4444-4444-8444-444444444444",
    "requestId":"55555555-5555-4555-8555-555555555555","stationId":claims["stationId"]!,"origin":"https://atlasgrading.com",
    "nonce":String(repeating:"x",count:43),"issuedAt":1000,"expiresAt":110000]
let proof = result(call("enrollment-proof",["envelope":try envelope(challenge)]))
requireTest(proof["enrollmentId"] as? String == rawConfig["enrollmentId"] as? String && proof["publicKeySpki"] as? String == keyStore.key.publicKey.derRepresentation.base64EncodedString(),"native proof identity")
let temp=FileManager.default.temporaryDirectory.appendingPathComponent("atlas-companion-config-fixture-\(UUID().uuidString)")
try FileManager.default.createDirectory(at:temp,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700]); defer { try? FileManager.default.removeItem(at:temp) }
let path=temp.appendingPathComponent("config.json").path
try companionCanonical(rawConfig).write(to:URL(fileURLWithPath:path)); requireTest(chmod(path,0o600)==0,"private file")
_ = try readCompanionConfiguration(path); requireTest(chmod(path,0o644)==0,"unsafe fixture")
do { _=try readCompanionConfiguration(path); requireTest(false,"unsafe config accepted") } catch {}
requireTest(companionCapabilities["qualifiedProfileAvailable"] as? Bool == false,"production registry empty")
requireTest(written["signature"] as? String != nil,"DER signature")
print("{\"test\":\"native_companion_signed_protocol\",\"ok\":true,\"scenarios\":30}")
