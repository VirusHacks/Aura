import AeroscopeKit
import SwiftUI

struct CompanionRootView: View {
    @Environment(CompanionModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            NavigationStack { StatusView() }
                .tabItem { Label("Status", systemImage: "applewatch.radiowaves.left.and.right") }
            NavigationStack { ActivityView() }
                .tabItem { Label("Activity", systemImage: "list.bullet.rectangle") }
            NavigationStack { AlertSettingsView() }
                .tabItem { Label("Alerts", systemImage: "bell.badge") }
            NavigationStack { DemoControlsView() }
                .tabItem { Label("Demo", systemImage: "play.circle") }
        }
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            model.requestWatchSummary()
            Task {
                await model.flushRelay()
                await model.refreshActivity()
            }
        }
    }
}
