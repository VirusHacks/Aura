import AeroscopeKit
import SwiftUI

/// Backend connection, watch link, permission guidance and the relay queue.
struct StatusView: View {
    @Environment(CompanionModel.self) private var model
    @Environment(WatchConnectivityBridge.self) private var connectivity
    @State private var editingBackend = false

    var body: some View {
        List {
            Section("Backend") {
                LabeledContent("Server", value: model.backendSettings.hostLabel ?? "Not connected")
                LabeledContent("API key", value: model.hasApiKey ? "Stored in Keychain" : "None")
                connectionRow
                Button(model.backendSettings.isConfigured ? "Edit connection" : "Connect backend") { editingBackend = true }
                if model.backendSettings.isConfigured {
                    Button("Test connection") { Task { await model.testConnection() } }
                }
            }

            Section {
                LabeledContent("Watch paired", value: connectivity.state.paired ? "Yes" : "No")
                LabeledContent("Watch app", value: connectivity.state.counterpartInstalled ? "Installed" : "Not installed")
                LabeledContent("Reachable now", value: connectivity.state.reachable ? "Yes" : "No")
                if let summary = model.watchSummary {
                    LabeledContent("Watch mode", value: summary.mode.label)
                    LabeledContent("Waiting on watch", value: "\(summary.pendingActionCount)")
                    LabeledContent("Last report") { Text("\(Text(summary.generatedAt, style: .relative)) ago") }
                }
            } header: {
                Text("Apple Watch")
            } footer: {
                Text("The watch works on its own. When it can't reach the backend, it hands pending actions to this iPhone to deliver.")
            }

            Section {
                PermissionGuidance(
                    title: "Watch location",
                    status: model.watchSummary?.locationAuthorization.label ?? "Unknown",
                    ok: model.watchSummary?.locationAuthorization.isAuthorized == true,
                    guidance: "Needed to match you to a Delhi zone. On the watch: Settings → Privacy & Security → Location Services → AEROSCOPE → While Using."
                )
                PermissionGuidance(
                    title: "Watch notifications",
                    status: model.watchSummary?.notificationAuthorization.label ?? "Unknown",
                    ok: model.watchSummary?.notificationAuthorization == .authorized,
                    guidance: "Needed for warnings when the app isn't open. In the Watch app on iPhone: Notifications → AEROSCOPE."
                )
                LabeledContent("Push registration", value: model.watchSummary?.pushRegistered == true ? "Registered" : "Not registered")
            } header: {
                Text("Permissions")
            } footer: {
                Text("Without location, the watch shows the last known zone with its age. Without notifications, warnings still appear in the app.")
            }

            Section("Relay") {
                LabeledContent("Queued on iPhone", value: "\(model.relay.count)")
                if model.relay.count > 0 {
                    Button("Deliver now") { Task { await model.flushRelay() } }
                }
                if model.relayLog.isEmpty {
                    Text("Nothing relayed yet.").foregroundStyle(.secondary)
                }
                ForEach(model.relayLog.prefix(8)) { entry in
                    HStack {
                        Image(systemName: entry.outcome.symbolName).foregroundStyle(entry.outcome.tint)
                        VStack(alignment: .leading) {
                            Text(entry.summary)
                            if let detail = entry.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        Text(entry.at, style: .time).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("AEROSCOPE")
        .refreshable {
            model.requestWatchSummary()
            await model.testConnection()
            await model.flushRelay()
        }
        .sheet(isPresented: $editingBackend) { BackendSettingsView() }
    }

    @ViewBuilder
    private var connectionRow: some View {
        switch model.connection {
        case .notConfigured:
            Label("Not configured — the watch can still run Demo mode", systemImage: "bolt.horizontal.circle")
                .foregroundStyle(.secondary)
        case .unknown:
            Label("Not checked", systemImage: "questionmark.circle").foregroundStyle(.secondary)
        case .checking:
            HStack { ProgressView(); Text("Checking…") }
        case .ok(let health, let at):
            VStack(alignment: .leading, spacing: 2) {
                Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Data: \(health.provenance == .verified ? "verified" : "demo baselines") · \(health.scenario.label)")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Push \(health.push ? "on" : "off") · Dashboard updates \(health.realtime ? "on" : "off") · checked \(at.formatted(date: .omitted, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        case .failed(let message, _):
            Label(message, systemImage: "xmark.octagon.fill").foregroundStyle(.red)
        }
    }
}

private struct PermissionGuidance: View {
    let title: String
    let status: String
    let ok: Bool
    let guidance: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .foregroundStyle(ok ? .green : .orange)
                Text(title)
                Spacer()
                Text(status).foregroundStyle(.secondary)
            }
            if !ok {
                Text(guidance).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

extension RelayLogEntry.Outcome {
    var symbolName: String {
        switch self {
        case .delivered: "checkmark.circle.fill"
        case .rejected: "xmark.circle.fill"
        case .waiting: "clock"
        }
    }

    var tint: Color {
        switch self {
        case .delivered: .green
        case .rejected: .red
        case .waiting: .secondary
        }
    }
}

/// Edits the backend URL and API key. The key goes to the Keychain and is
/// shared with the watch over the encrypted WatchConnectivity channel.
struct BackendSettingsView: View {
    @Environment(CompanionModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var apiKey = ""
    @State private var clearKey = false
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://…execute-api…amazonaws.com/prod", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("API URL")
                } footer: {
                    Text("The `WatchApiUrl` output of the watch backend stack, or http://<your-mac>.local:8787 for the local dev server.")
                }
                Section {
                    SecureField(model.hasApiKey ? "Unchanged" : "x-api-key value", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if model.hasApiKey { Toggle("Remove stored key", isOn: $clearKey) }
                } header: {
                    Text("API key")
                } footer: {
                    Text("Stored in the iPhone and watch Keychains. Never shown again.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Backend")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(saving)
                }
            }
            .onAppear { url = model.backendSettings.baseURL ?? "" }
        }
    }

    private func save() {
        saving = true
        // nil keeps the stored key; "" removes it.
        let key: String? = clearKey ? "" : (apiKey.isEmpty ? nil : apiKey)
        Task {
            error = await model.saveBackend(baseURL: url, apiKey: key)
            saving = false
            if error == nil { dismiss() }
        }
    }
}
