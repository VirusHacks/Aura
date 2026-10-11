import AeroscopeKit
import SwiftUI

/// Alert preferences, shared with the watch and the backend.
struct AlertSettingsView: View {
    @Environment(CompanionModel.self) private var model

    var body: some View {
        Form {
            Section {
                Toggle("Pollution alerts", isOn: preference(\.alertsEnabled))
                Picker("Alert at", selection: preference(\.threshold)) {
                    ForEach(AlertPreferences.thresholdChoices, id: \.self) { category in
                        Text("\(category.label) (\(category.band.range.lowerBound)+)").tag(category)
                    }
                }
                Toggle("I'm in a sensitive group", isOn: preference(\.sensitiveGroup))
            } footer: {
                Text("Sensitive groups (children, older adults, asthma, heart or lung disease) are alerted one category earlier: currently at \(model.preferences.effectiveThreshold.label) (AQI \(model.preferences.effectiveThresholdAQI)+).")
            }

            Section {
                Toggle("Warn about the next zone", isOn: preference(\.lookAhead))
                Toggle("Only during trips", isOn: preference(\.onlyDuringTrips))
                Picker("Minimum gap between alerts", selection: preference(\.cooldownMinutes)) {
                    ForEach([5, 10, 15, 30, 60], id: \.self) { Text("\($0) min").tag($0) }
                }
                Picker("Usual travel mode", selection: preference(\.travelMode)) {
                    ForEach(TravelMode.allCases, id: \.self) { Label($0.label, systemImage: $0.symbolName).tag($0) }
                }
            } footer: {
                Text("A zone that gets worse always alerts, even within the gap. Readings older than \(model.preferences.staleAfterMinutes) minutes never trigger alerts.")
            }

            Section("Indian AQI categories") {
                ForEach(AQIScale.bands, id: \.category) { band in
                    HStack {
                        Text(band.category.label)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(band.category.inkColor)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(band.category.color, in: Capsule())
                        Text("\(band.range.lowerBound)–\(band.range.upperBound)").monospacedDigit()
                        Spacer()
                    }
                    Text(band.advice).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Alerts")
    }

    private func preference<Value>(_ keyPath: WritableKeyPath<AlertPreferences, Value>) -> Binding<Value> {
        Binding(
            get: { model.preferences[keyPath: keyPath] },
            set: { value in Task { await model.updatePreferences { $0[keyPath: keyPath] = value } } }
        )
    }
}
