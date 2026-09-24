import Foundation
import CryptoKit
import Security
import LocalAuthentication
import CAtlasNFCCompanion
import Darwin

public protocol CompanionKeyStore {
    func identity(_ config: CompanionConfiguration) throws -> [String: Any]
    func sign(_ data: Data, configuration: CompanionConfiguration) throws -> Data
}
public final class ProtectedCompanionKeyStore: CompanionKeyStore {
    public init() {}
    private func context() -> LAContext { let context = LAContext(); context.interactionNotAllowed = true; return context }
    private func key(_ config: CompanionConfiguration) throws -> SecKey {
        let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: config.keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecMatchLimit as String: kSecMatchLimitOne, kSecReturnRef as String: true, kSecUseAuthenticationContext as String: context()]
        var found: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &found)
        try require(status == errSecSuccess && found != nil && CFGetTypeID(found!) == SecKeyGetTypeID(), "COMPANION_KEY_NOT_ENROLLED")
        let key = found as! SecKey
        guard let attributes = SecKeyCopyAttributes(key) as? [String: Any] else { throw CompanionFailure("COMPANION_KEY_ATTRIBUTES_INVALID") }
        try require(attributes[kSecAttrTokenID as String] as? String == kSecAttrTokenIDSecureEnclave as String
            && integer(attributes[kSecAttrKeySizeInBits as String]) == 256
            && attributes[kSecAttrKeyType as String] as? String == kSecAttrKeyTypeECSECPrimeRandom as String,
            "COMPANION_PROTECTED_KEY_REQUIRED")
        return key
    }
    /// Explicit operator command only. Never called by serve, enrollment, or tests.
    /// Existing keys are immutable: no delete, replacement, or private export path.
    public func initialize(_ config: CompanionConfiguration, configurationPath: String) throws -> [String: Any] {
        let reread = try readCompanionConfiguration(configurationPath)
        try require(companionCanonical(reread.value) == companionCanonical(config.value), "COMPANION_CONFIG_CHANGED")
        let directory = open(URL(fileURLWithPath: configurationPath).deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        try require(directory >= 0, "COMPANION_CONFIG_UNSAFE"); defer { close(directory) }
        var info = stat()
        try require(fstat(directory, &info) == 0 && info.st_uid == getuid() && info.st_mode & 0o077 == 0, "COMPANION_CONFIG_UNSAFE")
        // Permanent initialization intent serializes concurrent operator commands.
        // Any interrupted setup requires inspection, never automatic recreation.
        let marker = openat(directory, "key-init-\(companionHash(config.keyTag)).intent", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        try require(marker >= 3, "COMPANION_KEY_INITIALIZATION_ALREADY_ATTEMPTED"); defer { close(marker) }
        try require(atlas_companion_full_sync(marker) == 0 && fsync(directory) == 0, "COMPANION_KEY_INTENT_SYNC_FAILED")
        let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: config.keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context()]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        try require(status == errSecItemNotFound, "COMPANION_KEY_ALREADY_EXISTS_OR_UNAVAILABLE")
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage], &error) else {
            throw CompanionFailure("COMPANION_KEY_ACCESS_CONTROL_FAILED")
        }
        let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: config.keyTag,
                kSecAttrAccessControl as String: access]]
        guard SecKeyCreateRandomKey(attributes as CFDictionary, &error) != nil else { throw CompanionFailure("COMPANION_KEY_CREATION_FAILED") }
        return try identity(config)
    }
    public func identity(_ config: CompanionConfiguration) throws -> [String: Any] {
        let privateKey = try key(config); guard let publicKey = SecKeyCopyPublicKey(privateKey) else { throw CompanionFailure("COMPANION_KEY_UNAVAILABLE") }
        var error: Unmanaged<CFError>?; guard let bytes = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else { throw CompanionFailure("COMPANION_KEY_UNAVAILABLE") }
        let spki = try P256.Signing.PublicKey(x963Representation: bytes).derRepresentation
        return ["stationId": config.value["stationId"]!, "enrollmentId": config.value["enrollmentId"]!, "keyId": config.value["keyId"]!,
            "publicKeySpki": spki.base64EncodedString(), "fingerprint": companionHash(spki), "protectionEvidenceHash": config.value["protectionEvidenceHash"]!,
            "protectedKey": true, "algorithm": "ES256-DER"]
    }
    public func sign(_ data: Data, configuration: CompanionConfiguration) throws -> Data {
        let key = try key(configuration); try require(SecKeyIsAlgorithmSupported(key, .sign, .ecdsaSignatureMessageX962SHA256), "COMPANION_SIGNER_UNAVAILABLE")
        var error: Unmanaged<CFError>?
        guard let bytes = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data as CFData, &error) as Data? else { throw CompanionFailure("COMPANION_SIGNER_UNAVAILABLE") }
        return bytes
    }
}
