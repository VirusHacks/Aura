// xcode: set sdk=watchOS

import AeroscopeKit
import SwiftUI
import WatchKit

@main
struct AeroscopeWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @State private var services = WatchServices()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services.model)
                .onAppear { services.attach(delegate) }
        }
        .backgroundTask(.appRefresh(WatchServices.refreshTaskIdentifier)) {
            await services.handleBackgroundRefresh()
        }
    }
}

/// Builds the model with the real platform services and wires their callbacks.
@MainActor
final class WatchServices {
    static let refreshTaskIdentifier = "com.aeroscope.watch.refresh"

    let model: AeroscopeModel
    private let notifications = UserNotificationsBridge()
    private let connectivity = WatchConnectivityBridge()
    private let location = CoreLocationProvider()
    private let haptics = WatchHaptics()

    init() {
        notifications.install()
        guard let dataset = try? CityDataset.bundled() else {
            preconditionFailure("delhi-zones.json is missing from the AeroscopeKit bundle")
        }
        let info = Bundle.main.infoDictionary ?? [:]
        let configuredURL = (info["AeroscopeAPIBaseURL"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        #if DEBUG
        let apnsEnvironment = "sandbox"
        #else
        let apnsEnvironment = "production"
        #endif
        model = AeroscopeModel(dependencies: .init(
            store: .applicationSupport(),
            keychain: KeychainStore(),
            location: location,
            notifier: notifications,
            haptics: haptics,
            connectivity: connectivity,
            dataset: dataset,
            defaultBaseURL: configuredURL,
            deviceId: WKInterfaceDevice.current().identifierForVendor?.uuidString ?? "watch-unknown",
            bundleId: Bundle.main.bundleIdentifier ?? "com.aeroscope.companion.watchkitapp",
            apnsEnvironment: apnsEnvironment,
            requestPushRegistration: { WKApplication.shared().registerForRemoteNotifications() }
        ))

        let model = model
        notifications.onAction = { action, alert in
            Task { await model.handleNotificationAction(action, alert: alert) }
        }
        notifications.onForegroundAlert = { alert in model.receiveRemoteAlert(alert) }
        connectivity.onMessage = { message in
            Task { await model.handle(message) }
        }
        connectivity.activate()
    }

    func attach(_ delegate: WatchAppDelegate) {
        let model = model
        delegate.onDeviceToken = { token in Task { await model.registerPushToken(token) } }
        delegate.onRemoteAlert = { alert in model.receiveRemoteAlert(alert) }
        scheduleNextRefresh()
    }

    func handleBackgroundRefresh() async {
        model.isForeground = false
        await model.backgroundRefresh()
        scheduleNextRefresh()
    }

    /// watchOS budgets background refreshes; ask more often during a trip.
    func scheduleNextRefresh() {
        let interval: TimeInterval = model.trip?.phase == .active ? 15 * 60 : 30 * 60
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: Date(timeIntervalSinceNow: interval),
            userInfo: Self.refreshTaskIdentifier as NSString
        ) { _ in }
    }
}
