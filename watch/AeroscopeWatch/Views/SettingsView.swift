import AeroscopeKit
import SwiftUI

/// Data source, alert preferences, permissions, demo controls and sync status.
struct SettingsView: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        List {
            Section {
                Picker("Source", selection: modeBinding) {
                    ForEach(DataSourceMode.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .disabled(model.trip?.isOngoing == true)
            } header: {
                Text("Data")
            } footer: {
                Text(model.trip?.isOngoing == true
                     ? "End the trip to switch source."
                     : "Demo replays a deterministic Delhi journey. It is always labelled DEMO.")
            }

            Section("Alerts") {
                Toggle("Alerts", isOn: preference(\.alertsEnabled))
                Picker("Alert at", selection: preference(\.threshold)) {
                    ForEach(AlertPreferences.thresholdChoices, id: \.self) { Text("\($0.label)+").tag($0) }
                }
                Toggle("Sensitive group", isOn: preference(\.sensitiveGroup))
                Toggle("Warn ahead", isOn: preference(\.lookAhead))
                Toggle("Only on trips", isOn: preference(\.onlyDuringTrips))
                Picker("Quiet for", selection: preference(\.cooldownMinutes)) {
                    ForEach([5, 10, 15, 30, 60], id: \.self) { Text("\($0) min").tag($0) }
                }
                Picker("Travel", selection: preference(\.travelMode)) {
                    ForEach(TravelMode.allCases, id: \.self) { Label($0.label, systemImage: $0.symbolName).tag($0) }
                }
            }

            Section("Permissions") {
                permissionRow("Location", status: model.locationAuthorization.label,
                              ok: model.locationAuthorization.isAuthorized,
                              action: model.locationAuthorization == .notDetermined ? { model.requestLocationPermission() } : nil)
                permissionRow("Notifications", status: model.notificationAuthorization.label,
                              ok: model.notificationAuthorization == .authorized,
                              action: model.notificationAuthorization == .notDetermined
                                ? { Task { await model.requestNotificationPermission() } } : nil)
                if model.locationAuthorization == .denied || model.notificationAuthorization == .denied {
                    Text("Change this in the Settings app on your watch → Privacy & Security.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if model.mode == .demo {
                DemoSection()
            }

            Section("Connection") {
                MetricRow(title: "Backend", value: model.backendSettings.hostLabel ?? "Not connected")
                MetricRow(title: "API key", value: model.hasApiKey ? "Set" : "None")
                MetricRow(title: "Waiting to sync", value: "\(model.pendingActionCount)")
                if let error = model.lastSyncError {
                    MetricRow(title: "Last error", value: error)
                }
                MetricRow(title: "Push", value: model.pushRegistered ? "Registered" : "Not registered")
                Button("Sync now") { Task { await model.flushQueue() } }
                    .disabled(model.pendingActionCount == 0)
            }

            Section {
                Text("Readings come from AEROSCOPE's scenario model of Delhi and are simulated, not measured.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
    }

    private var modeBinding: Binding<DataSourceMode> {
        Binding(get: { model.mode }, set: { mode in Task { await model.setMode(mode) } })
    }

    private func preference<Value>(_ keyPath: WritableKeyPath<AlertPreferences, Value>) -> Binding<Value> {
        Binding(
            get: { model.preferences[keyPath: keyPath] },
            set: { value in Task { await model.updatePreferences { $0[keyPath: keyPath] = value } } }
        )
    }

    private func permissionRow(_ title: String, status: String, ok: Bool, action: (() -> Void)?) -> some View {
        HStack {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundStyle(ok ? .green : .yellow)
            VStack(alignment: .leading) {
                Text(title).font(.footnote)
                Text(status).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if let action {
                Button("Allow", action: action).font(.caption2)
            }
        }
    }
}

private struct DemoSection: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        Section {
            Picker("Scenario", selection: scenario(\.preset)) {
                ForEach(ScenarioPresetID.allCases, id: \.self) { Text($0.preset.label).tag($0) }
            }
            Picker("Time", selection: scenario(\.timeIndex)) {
                ForEach(ScenarioEngine.timeSteps, id: \.index) { Text($0.label).tag($0.index) }
            }
            Button { Task { await model.demoStep() } } label: {
                Label("Advance position", systemImage: "forward.frame")
            }
            Button { Task { await model.restartDemoJourney() } } label: {
                Label("Restart route", systemImage: "arrow.counterclockwise")
            }
        } header: {
            Text("Demo")
        } footer: {
            Text("Position moves every few seconds during a demo trip.")
        }
    }

    private func scenario<Value>(_ keyPath: WritableKeyPath<Scenario, Value>) -> Binding<Value> {
        Binding(
            get: { model.demoScenario[keyPath: keyPath] },
            set: { value in
                var updated = model.demoScenario
                updated[keyPath: keyPath] = value
                Task { await model.setDemoScenario(Scenario(preset: updated.preset, timeIndex: updated.timeIndex)) }
            }
        )
    }
}
