import AeroscopeKit
import SwiftUI

/// Remote control for the watch's deterministic demonstration mode.
struct DemoControlsView: View {
    @Environment(CompanionModel.self) private var model
    @Environment(WatchConnectivityBridge.self) private var connectivity
    @State private var preset: ScenarioPresetID = Scenario.demoDefault.preset
    @State private var timeIndex: Int = Scenario.demoDefault.timeIndex

    var body: some View {
        Form {
            Section {
                LabeledContent("Watch mode", value: model.watchSummary?.mode.label ?? "Unknown")
                HStack {
                    Button("Use Demo") { model.send(.setMode(.demo)) }
                    Spacer()
                    Button("Use Live") { model.send(.setMode(.live)) }
                }
                .buttonStyle(.bordered)
            } footer: {
                Text("Demo mode never mixes with live readings: every demo value is labelled DEMO on the watch. The source can't change during a trip.")
            }

            Section {
                Picker("Atmosphere", selection: $preset) {
                    ForEach(ScenarioPresetID.allCases, id: \.self) { Text($0.preset.label).tag($0) }
                }
                Picker("Time of day", selection: $timeIndex) {
                    ForEach(ScenarioEngine.timeSteps, id: \.index) { Text("\($0.label) · \($0.period)").tag($0.index) }
                }
                Button("Apply scenario") { model.send(.setScenario(Scenario(preset: preset, timeIndex: timeIndex))) }
                Text(preset.preset.summary).font(.caption).foregroundStyle(.secondary)
            } header: {
                Text("Scenario")
            } footer: {
                Text("Same presets and time steps as the 3D dashboard, so both show identical numbers.")
            }

            Section {
                Button { model.send(.advance) } label: { Label("Advance position", systemImage: "forward.frame") }
                Button { model.send(.restartJourney) } label: { Label("Restart route", systemImage: "arrow.counterclockwise") }
                Button {
                    model.send(.setScenario(Scenario(preset: .winterStagnation, timeIndex: 5)))
                } label: {
                    Label("Pollution spike (Winter Stagnation, 21:00)", systemImage: "exclamationmark.triangle")
                }
            } header: {
                Text("Journey")
            } footer: {
                Text("The default demo walks Lodhi Garden → India Gate → Connaught Place → Red Fort. Poor air ahead at Connaught Place triggers a warning and a cleaner route via Yamuna Riverfront.")
            }

            if !connectivity.state.reachable {
                Section {
                    Label("Watch not reachable now. Commands are queued and delivered when it is.", systemImage: "applewatch.slash")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Demo")
        .onAppear {
            if let scenario = model.watchSummary?.demoScenario {
                preset = scenario.preset
                timeIndex = scenario.timeIndex
            }
        }
    }
}
