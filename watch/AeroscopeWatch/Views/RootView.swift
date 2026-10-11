import AeroscopeKit
import SwiftUI

/// Vertical pages: Air quality → Trip → Alerts → Settings. Alerts present
/// as a sheet over whichever page is showing.
struct RootView: View {
    enum Page: Hashable {
        case home, trip, alerts, settings
    }

    @Environment(AeroscopeModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var page: Page = .home

    var body: some View {
        NavigationStack {
            TabView(selection: $page) {
                HomeView(showTrip: { page = .trip }).tag(Page.home)
                TripView().tag(Page.trip)
                AlertsListView().tag(Page.alerts)
                SettingsView().tag(Page.settings)
            }
            .tabViewStyle(.verticalPage)
        }
        .sheet(item: presentedAlert) { alert in
            AlertDetailView(alertId: alert.id)
        }
        .task {
            await model.start()
            await model.runForegroundLoop()
        }
        .onChange(of: scenePhase) { _, phase in
            model.isForeground = phase == .active
            if phase == .active { Task { await model.refreshIfDue() } }
        }
    }

    private var presentedAlert: Binding<PollutionAlert?> {
        Binding(
            get: { model.presentedAlert },
            set: { model.presentedAlertId = $0?.id }
        )
    }
}
