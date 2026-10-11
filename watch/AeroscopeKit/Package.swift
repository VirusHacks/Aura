// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AeroscopeKit",
    platforms: [
        .iOS(.v17),
        .watchOS(.v10),
        // macOS is only a host for `swift test`; no macOS app ships.
        .macOS(.v14),
    ],
    products: [
        .library(name: "AeroscopeKit", targets: ["AeroscopeKit"]),
    ],
    targets: [
        .target(
            name: "AeroscopeKit",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "AeroscopeKitTests",
            dependencies: ["AeroscopeKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
