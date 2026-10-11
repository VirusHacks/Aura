import AeroscopeKit
import SwiftUI

@main
struct AeroscopeCompanionApp: App {
    @State private var services = CompanionServices()

    var body: some Scene {
        WindowGroup {
            CompanionRootView()
                .environment(services.model)
                .environment(services.connectivity)
        }
    }
}

@MainActor
final class CompanionServices {
    let model: CompanionModel
    let connectivity = WatchConnectivityBridge()

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        let configuredURL = (info["AeroscopeAPIBaseURL"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        model = CompanionModel(dependencies: .init(
            store: .applicationSupport(),
            keychain: KeychainStore(),
            connectivity: connectivity,
            defaultBaseURL: configuredURL
        ))
        let model = model
        connectivity.onMessage = { message in
            Task { await model.handle(message) }
        }
        connectivity.activate()
    }
}
