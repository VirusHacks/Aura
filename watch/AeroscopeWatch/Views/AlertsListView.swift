import AeroscopeKit
import SwiftUI

/// Recent pollution warnings, newest first.
struct AlertsListView: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        List {
            if model.alerts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Image(systemName: "bell.slash").foregroundStyle(.secondary)
                    Text("No alerts yet").font(.headline)
                    Text("You'll be warned here when a zone on your trip reaches \(model.preferences.effectiveThreshold.label) or worse.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
            }
            ForEach(model.alerts) { alert in
                Button {
                    model.presentedAlertId = alert.id
                } label: {
                    AlertRow(alert: alert)
                }
            }
        }
        .navigationTitle("Alerts")
    }
}

private struct AlertRow: View {
    let alert: PollutionAlert

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(alert.category.onDarkColor)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(alert.zoneName).font(.footnote.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 2)
                    AQIBadge(aqi: alert.aqi, compact: true)
                }
                HStack(spacing: 4) {
                    Image(systemName: alert.status.symbolName)
                    Text(alert.kind == .upcoming ? "Ahead" : alert.status.label)
                    Spacer(minLength: 2)
                    Text(alert.createdAt, style: .time)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(alert.title), \(alert.zoneName), AQI \(alert.aqi) \(alert.category.label), \(alert.status.label)")
    }
}
