import Foundation
import CryptoKit
import Darwin

public struct CompanionFailure: Error { public let code: String; public init(_ code: String) { self.code = code } }
func require(_ ok: Bool, _ code: String = "COMPANION_INPUT_INVALID") throws { if !ok { throw CompanionFailure(code) } }
func matches(_ value: Any?, _ pattern: String) -> Bool { guard let value = value as? String else { return false }; return value.range(of: pattern, options: .regularExpression) != nil }
func keys(_ value: [String: Any], _ expected: [String]) throws { try require(Set(value.keys) == Set(expected)) }
func integer(_ value: Any?) -> Int64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite, number.doubleValue == floor(number.doubleValue), abs(number.doubleValue) <= 9007199254740991 else { return nil }
    return number.int64Value
}
public func companionCanonical(_ value: [String: Any]) throws -> Data {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]); try require(bytes.count <= 16384); return bytes
}
public func companionHash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
public func companionBase64URL(_ bytes: Data) -> String { bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
func decodeURL(_ value: Any?, maximum: Int) throws -> Data {
    try require(matches(value, "^[A-Za-z0-9_-]+$")); let text = value as! String;
    try require(text.utf8.count <= (maximum * 4 / 3 + 4));
    let padded = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - text.count % 4) % 4)
    guard let bytes = Data(base64Encoded: padded) else { throw CompanionFailure("COMPANION_ENCODING_INVALID") }
    try require(bytes.count <= maximum && companionBase64URL(bytes) == text); return bytes
}
let idPattern = "^[A-Za-z0-9_-]{1,128}$", shaPattern = "^[a-f0-9]{64}$", uuidPattern = "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
public struct CompanionConfiguration {
    public let value: [String: Any]
    public let hostKey: P256.Signing.PublicKey
    public init(_ value: [String: Any]) throws {
        try keys(value, ["version", "stationId", "enrollmentId", "keyId", "hostKeyId", "hostPublicKeySpki", "protectionEvidenceHash", "profile"])
        try require(value["version"] as? String == "atlas-mac-companion-config-v1")
        for key in ["stationId", "keyId", "hostKeyId"] { try require(matches(value[key], idPattern)) }
        try require(matches(value["enrollmentId"], uuidPattern) && matches(value["protectionEvidenceHash"], shaPattern))
        guard let encoded = value["hostPublicKeySpki"] as? String, let bytes = Data(base64Encoded: encoded), bytes.base64EncodedString() == encoded else { throw CompanionFailure("COMPANION_HOST_KEY_INVALID") }
        hostKey = try P256.Signing.PublicKey(derRepresentation: bytes)
        guard let profile = value["profile"] as? [String: Any] else { throw CompanionFailure("COMPANION_PROFILE_INVALID") }
        try keys(profile, ["id", "profileHash", "qualificationHash", "firstUserPage", "lastUserPage"])
        try require(profile["id"] as? String == "atlas-mac-f8215-production-v1" && matches(profile["profileHash"], shaPattern) && matches(profile["qualificationHash"], shaPattern))
        guard let first = integer(profile["firstUserPage"]), let last = integer(profile["lastUserPage"]) else { throw CompanionFailure("COMPANION_PROFILE_INVALID") }
        try require(first >= 4 && last >= first + 3 && last <= 255)
        let expected: [String: Any] = ["id": profile["id"]!, "qualificationHash": profile["qualificationHash"]!, "firstUserPage": first, "lastUserPage": last]
        try require(companionHash(try companionCanonical(expected)) == profile["profileHash"] as? String)
        self.value = value
    }
    public var profile: [String: Any] { value["profile"] as! [String: Any] }
    public var keyTag: Data { Data("com.atlasgrading.station.\(value["enrollmentId"]!).\(value["keyId"]!)".utf8) }
}
public func readCompanionConfiguration(_ path: String) throws -> CompanionConfiguration {
    try require(path.hasPrefix("/") && !path.utf8.contains(0) && path.utf8.count < 4096 && !path.split(separator: "/").contains(".."))
    let parent = URL(fileURLWithPath: path).deletingLastPathComponent().path
    let directory = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); try require(directory >= 0, "COMPANION_CONFIG_UNSAFE")
    defer { close(directory) }; var info = stat()
    try require(fstat(directory, &info) == 0 && info.st_uid == getuid() && info.st_mode & 0o077 == 0, "COMPANION_CONFIG_UNSAFE")
    let descriptor = openat(directory, URL(fileURLWithPath: path).lastPathComponent, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); try require(descriptor >= 0, "COMPANION_CONFIG_UNSAFE")
    defer { close(descriptor) }
    try require(fstat(descriptor, &info) == 0 && info.st_mode & S_IFMT == S_IFREG && info.st_uid == getuid()
        && info.st_mode & 0o077 == 0 && info.st_size > 0 && info.st_size <= 16384, "COMPANION_CONFIG_UNSAFE")
    var bytes = [UInt8](repeating: 0, count: Int(info.st_size)), offset = 0
    while offset < bytes.count { let remaining = bytes.count - offset; let count = bytes.withUnsafeMutableBytes { read(descriptor, $0.baseAddress!.advanced(by: offset), remaining) }; try require(count > 0); offset += count }
    guard let object = try JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any] else { throw CompanionFailure("COMPANION_CONFIG_INVALID") }
    return try CompanionConfiguration(object)
}
public func verifyCompanionEnvelope(_ envelope: [String: Any], configuration: CompanionConfiguration) throws -> [String: Any] {
    try keys(envelope, ["version", "keyId", "algorithm", "payload", "signature"])
    try require(envelope["version"] as? String == "atlas-mac-station-signed-v1" && envelope["algorithm"] as? String == "ES256-DER"
        && envelope["keyId"] as? String == configuration.value["hostKeyId"] as? String, "COMPANION_HOST_SIGNATURE_INVALID")
    let bytes = try decodeURL(envelope["payload"], maximum: 16384), signature = try P256.Signing.ECDSASignature(derRepresentation: decodeURL(envelope["signature"], maximum: 72))
    try require(configuration.hostKey.isValidSignature(signature, for: bytes), "COMPANION_HOST_SIGNATURE_INVALID")
    guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw CompanionFailure("COMPANION_CLAIMS_INVALID") }
    try require(try companionCanonical(object) == bytes, "COMPANION_CLAIMS_NONCANONICAL"); return object
}
public struct CompanionArm {
    public let claims: [String: Any], ndef: Data, authorizationHash: String
    public init(_ claims: [String: Any], configuration: CompanionConfiguration, now: Int64) throws {
        try keys(claims, ["version", "origin", "stationId", "enrollmentId", "keyId", "intentId", "planHash", "profileHash", "qualificationHash", "activationId", "cardId", "approvalActionId", "publicHash", "reportHash", "approvalVersion", "reportNumber", "url", "ndefHash", "firstUserPage", "lastUserPage", "nonce", "issuedAt", "expiresAt"])
        try require(claims["version"] as? String == "atlas-mac-nfc-arm-v1" && claims["origin"] as? String == "https://atlasgrading.com")
        for key in ["stationId", "enrollmentId", "keyId"] { try require(claims[key] as? String == configuration.value[key] as? String) }
        for key in ["stationId", "keyId", "intentId", "activationId", "nonce"] { try require(matches(claims[key], idPattern)) }
        for key in ["enrollmentId", "cardId", "approvalActionId"] { try require(matches(claims[key], uuidPattern)) }
        for key in ["planHash", "profileHash", "qualificationHash", "publicHash", "reportHash", "ndefHash"] { try require(matches(claims[key], shaPattern)) }
        for key in ["profileHash", "qualificationHash"] { try require(claims[key] as? String == configuration.profile[key] as? String) }
        for key in ["firstUserPage", "lastUserPage"] { try require(integer(claims[key]) == integer(configuration.profile[key])) }
        guard let version = integer(claims["approvalVersion"]), let issued = integer(claims["issuedAt"]), let expires = integer(claims["expiresAt"]), let url = claims["url"] as? String else { throw CompanionFailure("COMPANION_ARM_INVALID") }
        try require(version > 0 && version <= 2147483647 && issued > 0 && issued <= now && expires > now && expires - issued <= 900000, "COMPANION_AUTHORIZATION_EXPIRED")
        try require(claims["intentId"] as? String == "afnfc_\(claims["planHash"]!)" && matches(claims["reportNumber"], "^ATLAS-[A-Z0-9]{12}$")
            && matches(url, "^https://atlasgrading[.]com/reports/ar_[A-Za-z0-9_-]{24,64}[?]v=\(version)$"))
        let suffix = Data(url.dropFirst(8).utf8), length = suffix.count + 5
        try require(length <= 254)
        var data = Data([3, UInt8(length), 0xd1, 1, UInt8(suffix.count + 1), 0x55, 4]); data.append(suffix); data.append(0xfe)
        while data.count % 4 != 0 { data.append(0) }
        try require(companionHash(data) == claims["ndefHash"] as? String, "COMPANION_NDEF_MISMATCH")
        self.claims = claims; ndef = data; authorizationHash = companionHash(try companionCanonical(claims))
    }
    public func current(_ now: Int64) throws { try require(integer(claims["expiresAt"])! > now, "COMPANION_AUTHORIZATION_EXPIRED") }
    public var result: [String: Any] { ["version": "atlas-mac-nfc-result-v1", "intentId": claims["intentId"]!, "planHash": claims["planHash"]!, "profileHash": claims["profileHash"]!, "stationId": claims["stationId"]!, "enrollmentId": claims["enrollmentId"]!, "keyId": claims["keyId"]!, "authorizationHash": authorizationHash, "nonce": claims["nonce"]!, "ndefHash": claims["ndefHash"]!, "readbackVerified": true, "lockVerified": true] }
}
