// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AtlasMacNFC",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "atlas-mac-nfc-probe", targets: ["AtlasMacNFCProbe"]),
        .executable(name: "atlas-mac-nfc-diagnostic", targets: ["AtlasMacNFCDiagnostic"]),
        .executable(name: "atlas-mac-nfc-tests", targets: ["AtlasMacNFCTests"])
    ],
    targets: [
        .target(name: "CAtlasPCSC", linkerSettings: [.linkedFramework("PCSC")]),
        .target(name: "AtlasMacNFC", dependencies: ["CAtlasPCSC"]),
        .target(name: "CAtlasNFCDiagnostic", dependencies: ["CAtlasPCSC"], linkerSettings: [.linkedFramework("PCSC")]),
        .executableTarget(name: "AtlasMacNFCDiagnostic", dependencies: ["AtlasMacNFC", "CAtlasPCSC", "CAtlasNFCDiagnostic"]),
        .executableTarget(name: "AtlasMacNFCProbe", dependencies: ["AtlasMacNFC", "CAtlasPCSC"]),
        .executableTarget(name: "AtlasMacNFCTests", dependencies: ["AtlasMacNFC", "CAtlasPCSC"], path: "Tests/AtlasMacNFCTests")
    ]
)
