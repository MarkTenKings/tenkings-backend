import Foundation
import CryptoKit
import CAtlasNFCCompanion

public var companionCapabilities: [String: Any] { ["protocol": "atlas-mac-companion-rpc-v1", "qualifiedProfileAvailable": false,
    "productionReady": false, "protectedSignerAvailable": true, "keyCreationAvailable": true, "fullSyncAvailable": true,
    "profile": "atlas-mac-f8215-production-v1"] }

public protocol CompanionDriver {
    var qualifiedProfileAvailable: Bool { get }
    var readbackVerified: Bool { get }
    var lockVerified: Bool { get }
    var removalObserved: Bool { get }
    func perform(_ op: String, input: [String: Any], arm: CompanionArm) throws -> [String: Any]
    func close()
}
/** Actual PC/SC transport. The production qualification registry is deliberately
 * empty: no runtime JSON field can activate an undocumented F8215 lock method. */
public final class NativeCompanionDriver: CompanionDriver {
    public init() {}
    private var session: OpaquePointer?
    private var verifiedSnapshot = false
    public var qualifiedProfileAvailable: Bool { false }
    public var readbackVerified: Bool { verifiedSnapshot || session != nil && atlas_companion_readback_verified(session) != 0 }
    public var lockVerified: Bool { false }
    public private(set) var removalObserved = false
    private func checked(_ value: Int32) throws { try require(value == 0, "COMPANION_NATIVE_OPERATION_FAILED") }
    public func close() { if let session { verifiedSnapshot = atlas_companion_readback_verified(session) != 0; _ = atlas_companion_close(session); self.session = nil } }
    deinit { close() }
    public func perform(_ op: String, input: [String: Any], arm: CompanionArm) throws -> [String: Any] {
        if op == "close" { close(); return ["closed": true] }
        if op == "presence" || op == "observe-empty" {
            var state: UInt32 = 0, selected: UInt32 = 0
            try checked(atlas_companion_presence(0, &state, &selected))
            if op == "observe-empty" { if state == 0 { removalObserved = true }; return ["empty": state == 0] }
            return ["state": state == 0 ? "EMPTY" : "PRESENT", "selected": state == 0 ? NSNull() : NSNumber(value: selected)]
        }
        if op == "identify-qualified" { return ["qualified": qualifiedProfileAvailable] }
        if op == "lock-qualified" || op == "verify-lock" { throw CompanionFailure("COMPANION_LOCK_IMPLEMENTATION_UNAVAILABLE") }
        // This branch is reachable only after a reviewed native qualification
        // implementation is added to this driver, not a configuration boolean.
        try require(qualifiedProfileAvailable, "COMPANION_PROFILE_UNQUALIFIED")
        if op == "open" {
            try require(session == nil, "COMPANION_SESSION_ALREADY_OPEN")
            var state: UInt32 = 0, selected: UInt32 = 0
            try checked(atlas_companion_presence(0, &state, &selected)); try require(state == 1 && selected <= 1, "COMPANION_TAG_NOT_PRESENT")
            let name = "ACS ACR1552 1S CL Reader(\(selected + 1))"
            let status = arm.ndef.withUnsafeBytes { bytes in atlas_companion_open(name, UInt8(integer(arm.claims["firstUserPage"])!),
                UInt8(integer(arm.claims["lastUserPage"])!), bytes.bindMemory(to: UInt8.self).baseAddress, UInt32(bytes.count), &session) }
            try checked(status); return ["opened": true]
        }
        guard let session else { throw CompanionFailure("COMPANION_SESSION_REQUIRED") }
        if op == "same-tag" { try checked(atlas_companion_same_tag(session)); return ["sameTag": true] }
        if op == "read16" {
            var bytes = [UInt8](repeating: 0, count: 16); try checked(atlas_companion_read16(session, UInt32(integer(input["page"])!), &bytes))
            return ["hex": bytes.map { String(format: "%02x", $0) }.joined()]
        }
        if op == "write4" {
            let hex = input["hex"] as! String; let bytes = stride(from: 0, to: 8, by: 2).map { index -> UInt8 in
                let start = hex.index(hex.startIndex, offsetBy: index), end = hex.index(start, offsetBy: 2); return UInt8(hex[start..<end], radix: 16)!
            }
            try checked(atlas_companion_write4(session, UInt32(integer(input["page"])!), bytes)); return ["written": true, "readbackVerified": readbackVerified]
        }
        if op == "wait-removed" {
            var removed: UInt32 = 0; try checked(atlas_companion_wait_removed(session, UInt32(integer(input["timeoutMs"])!), &removed))
            if removed == 1 { removalObserved = true }; return ["removed": removed == 1]
        }
        throw CompanionFailure("COMPANION_OPERATION_INVALID")
    }
}
public final class CompanionRuntime {
    let configuration: CompanionConfiguration, driver: CompanionDriver, keyStore: CompanionKeyStore
    let clock: () -> Int64
    var arm: CompanionArm?, receiptHash: String?, acknowledged = false, restoredReceipt = false
    public init(configuration: CompanionConfiguration, driver: CompanionDriver = NativeCompanionDriver(), keyStore: CompanionKeyStore = ProtectedCompanionKeyStore(), clock: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.configuration = configuration; self.driver = driver; self.keyStore = keyStore; self.clock = clock
    }
    public func close() { driver.close() }
    deinit { close() }
    public func handle(_ input: [String: Any]) -> [String: Any] {
        let id = matches(input["id"], idPattern) ? input["id"] as! String : "invalid"
        do { try require(id != "invalid"); return ["id": id, "ok": true, "result": try execute(input)] }
        catch let error as CompanionFailure { return ["id": id, "ok": false, "error": error.code] }
        catch { return ["id": id, "ok": false, "error": "COMPANION_REQUEST_REFUSED"] }
    }
    private func execute(_ input: [String: Any]) throws -> [String: Any] {
        guard let op = input["op"] as? String else { throw CompanionFailure("COMPANION_OPERATION_INVALID") }
        if op == "restore-receipt" {
            try keys(input, ["id", "op", "envelope", "receipt", "signature"])
            guard let envelope = input["envelope"] as? [String: Any], let receipt = input["receipt"] as? [String: Any] else { throw CompanionFailure("COMPANION_RECEIPT_INVALID") }
            let claims = try verifyCompanionEnvelope(envelope, configuration: configuration)
            let restored = try CompanionArm(claims, configuration: configuration, now: clock())
            try require(arm == nil || arm!.authorizationHash == restored.authorizationHash, "COMPANION_ACTIVE_INTENT_CONFLICT")
            let bytes = try companionCanonical(receipt)
            try require(bytes == companionCanonical(restored.result), "COMPANION_RECEIPT_MISMATCH")
            let identity = try keyStore.identity(configuration)
            guard let encoded = identity["publicKeySpki"] as? String, let spki = Data(base64Encoded: encoded) else { throw CompanionFailure("COMPANION_KEY_UNAVAILABLE") }
            let key = try P256.Signing.PublicKey(derRepresentation: spki)
            let signature = try P256.Signing.ECDSASignature(derRepresentation: decodeURL(input["signature"], maximum: 72))
            try require(key.isValidSignature(signature, for: bytes), "COMPANION_RECEIPT_SIGNATURE_INVALID")
            driver.close(); arm = restored; receiptHash = companionHash(bytes); restoredReceipt = true
            return ["restored": true, "state": "WAITING_FOR_REMOVAL", "authorizationHash": restored.authorizationHash]
        }
        if op == "arm" {
            try keys(input, ["id", "op", "envelope"])
            guard let envelope = input["envelope"] as? [String: Any] else { throw CompanionFailure("COMPANION_AUTHORIZATION_REQUIRED") }
            let claims = try verifyCompanionEnvelope(envelope, configuration: configuration), next = try CompanionArm(claims, configuration: configuration, now: clock())
            try require(arm == nil || arm!.authorizationHash == next.authorizationHash, "COMPANION_ACTIVE_INTENT_CONFLICT")
            arm = next
            return ["state": driver.qualifiedProfileAvailable ? "WAITING_FOR_TAG" : "VERIFIED_UNQUALIFIED", "profileQualified": driver.qualifiedProfileAvailable, "authorizationHash": next.authorizationHash]
        }
        if op == "enrollment-proof" {
            try keys(input, ["id", "op", "envelope"])
            guard let envelope = input["envelope"] as? [String: Any] else { throw CompanionFailure("COMPANION_AUTHORIZATION_REQUIRED") }
            let challenge = try verifyCompanionEnvelope(envelope, configuration: configuration)
            try keys(challenge, ["version", "challengeId", "requestId", "stationId", "origin", "nonce", "issuedAt", "expiresAt"])
            try require(challenge["version"] as? String == "atlas-mac-station-enrollment-challenge-v1" && challenge["origin"] as? String == "https://atlasgrading.com"
                && challenge["stationId"] as? String == configuration.value["stationId"] as? String
                && matches(challenge["challengeId"], uuidPattern) && matches(challenge["requestId"], uuidPattern) && matches(challenge["nonce"], "^[A-Za-z0-9_-]{43}$"))
            guard let issued = integer(challenge["issuedAt"]), let expires = integer(challenge["expiresAt"]) else { throw CompanionFailure("COMPANION_AUTHORIZATION_EXPIRED") }
            try require(issued > 0 && issued <= clock() && expires > clock() && expires - issued <= 120000, "COMPANION_AUTHORIZATION_EXPIRED")
            let identity = try keyStore.identity(configuration)
            let proof: [String: Any] = ["version": "atlas-mac-station-enrollment-proof-v1", "challengeId": challenge["challengeId"]!,
                "challengeHash": companionHash(try companionCanonical(challenge)), "stationId": configuration.value["stationId"]!, "enrollmentId": configuration.value["enrollmentId"]!,
                "keyId": configuration.value["keyId"]!, "publicKeySpki": identity["publicKeySpki"]!, "protectionEvidenceHash": configuration.value["protectionEvidenceHash"]!]
            let signature = try keyStore.sign(companionCanonical(proof), configuration: configuration)
            return ["enrollmentId": proof["enrollmentId"]!, "keyId": proof["keyId"]!, "publicKeySpki": proof["publicKeySpki"]!, "protectionEvidenceHash": proof["protectionEvidenceHash"]!, "signature": companionBase64URL(signature)]
        }
        // Cancellation/LEAVE_CARD cleanup is permitted even after the arm expires.
        if op == "close" { try keys(input, ["id", "op"]); driver.close(); return ["closed": true] }
        guard let arm else { throw CompanionFailure("COMPANION_AUTHORIZATION_REQUIRED") }
        if op == "accept-ack" {
            try keys(input, ["id", "op", "envelope"])
            guard let envelope = input["envelope"] as? [String: Any], let receiptHash else { throw CompanionFailure("COMPANION_RESULT_REQUIRED") }
            let ack = try verifyCompanionEnvelope(envelope, configuration: configuration)
            try keys(ack, ["version", "kind", "intentId", "receiptHash", "enrollmentId", "stationId", "planHash", "authorizationHash", "committed", "recordedAt"])
            try require(ack["version"] as? String == "atlas-mac-nfc-ack-v1" && ack["kind"] as? String == "WRITE"
                && ack["receiptHash"] as? String == receiptHash && ack["authorizationHash"] as? String == arm.authorizationHash
                && ack["committed"] as? Bool == true && (integer(ack["recordedAt"]) ?? 0) > 0)
            for key in ["intentId", "enrollmentId", "stationId", "planHash"] { try require(ack[key] as? String == arm.claims[key] as? String) }
            acknowledged = true; return ["acknowledged": true]
        }
        try arm.current(clock())
        if restoredReceipt { try require(["sign-removal", "observe-empty", "presence", "close"].contains(op), "COMPANION_RECOVERY_READ_ONLY") }
        if op == "sign-receipt" || op == "sign-removal" {
            try keys(input, ["id", "op", "receipt"])
            guard let receipt = input["receipt"] as? [String: Any] else { throw CompanionFailure("COMPANION_RECEIPT_INVALID") }
            try require(restoredReceipt || driver.readbackVerified && driver.lockVerified, "COMPANION_NATIVE_VERIFICATION_REQUIRED")
            var expected = arm.result
            if op == "sign-removal" {
                guard let receiptHash else { throw CompanionFailure("COMPANION_RESULT_REQUIRED") }
                try require(driver.removalObserved && acknowledged, "COMPANION_REMOVAL_ACK_REQUIRED")
                expected = ["version": "atlas-mac-nfc-removal-v1", "stationId": arm.claims["stationId"]!, "enrollmentId": arm.claims["enrollmentId"]!, "keyId": arm.claims["keyId"]!,
                    "intentId": arm.claims["intentId"]!, "planHash": arm.claims["planHash"]!, "authorizationHash": arm.authorizationHash,
                    "nonce": arm.claims["nonce"]!, "receiptHash": receiptHash, "removalObserved": true]
            }
            let bytes = try companionCanonical(receipt); try require(bytes == companionCanonical(expected), "COMPANION_RECEIPT_MISMATCH")
            let signature = try keyStore.sign(bytes, configuration: configuration)
            if op == "sign-receipt" { receiptHash = companionHash(bytes) }
            return ["signature": companionBase64URL(signature)]
        }
        let extras: [String: [String]] = ["presence": [], "open": [], "read16": ["page"], "write4": ["page", "hex"], "same-tag": [],
            "wait-removed": ["timeoutMs"], "observe-empty": [], "close": [], "identify-qualified": [], "lock-qualified": [], "verify-lock": []]
        guard let extra = extras[op] else { throw CompanionFailure("COMPANION_OPERATION_INVALID") }
        try keys(input, ["id", "op"] + extra)
        if extra.contains("page") { guard let page = integer(input["page"]) else { throw CompanionFailure("COMPANION_PAGE_INVALID") }; try require(page >= 4 && page <= 255) }
        if op == "write4" { try require(matches(input["hex"], "^[a-f0-9]{8}$")) }
        if op == "wait-removed" { guard let timeout = integer(input["timeoutMs"]) else { throw CompanionFailure("COMPANION_TIMEOUT_INVALID") }; try require(timeout >= 0 && timeout <= 5000) }
        if ["open", "read16", "write4", "same-tag", "wait-removed"].contains(op) { try require(driver.qualifiedProfileAvailable, "COMPANION_PROFILE_UNQUALIFIED") }
        return try driver.perform(op, input: input, arm: arm)
    }
}
