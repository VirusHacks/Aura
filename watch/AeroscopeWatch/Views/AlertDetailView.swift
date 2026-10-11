import AeroscopeKit
import SwiftUI

/// Screen 3 — a pollution warning: what, where, how bad, and what to do.
struct AlertDetailView: View {
    let alertId: String

    @Environment(AeroscopeModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let alert = model.alerts.first(where: { $0.id == alertId }) {
                    content(alert)
                } else {
                    Text("This alert is no longer available.").font(.footnote)
                }
            }
            .navigationDestination(isPresented: showingRoute) {
                RouteComparisonView()
            }
        }
    }

    private var showingRoute: Binding<Bool> {
        Binding(
            get: { model.routeState.alertId == alertId },
            set: { if !$0 { model.closeRoute() } }
        )
    }

    private func content(_ alert: PollutionAlert) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: alert.category.symbolName)
                    Text(alert.title).font(.headline)
                }
                .foregroundStyle(alert.category.onDarkColor)
                .accessibilityAddTraits(.isHeader)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(alert.aqi)")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    Text(alert.category.label)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(alert.category.onDarkColor)
                }
                .accessibilityElement(children: .combine)

                Text(alert.zoneName).font(.footnote.weight(.semibold))
                if alert.kind == .upcoming {
                    Text("Next zone on your route").font(.caption2).foregroundStyle(.secondary)
                }
                if let pm25 = alert.pm25 {
                    MetricRow(title: "PM2.5", value: "\(pm25) µg/m³")
                }
                Text(alert.advice).font(.footnote).fixedSize(horizontal: false, vertical: true)

                HStack {
                    OriginTag(alert: alert)
                    Spacer()
                    Text(alert.createdAt, style: .time).font(.caption2).foregroundStyle(.secondary)
                }
                if alert.simulated, let scenario = alert.scenarioLabel {
                    Text("Simulated · \(scenario)").font(.caption2).foregroundStyle(.secondary)
                }

                if alert.isOpen {
                    actions(alert)
                } else {
                    Label(alert.status.label, systemImage: alert.status.symbolName)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func actions(_ alert: PollutionAlert) -> some View {
        let hasTrip = model.trip?.isOngoing == true
        if hasTrip {
            Button {
                Task { await model.requestRoute(alertId: alert.id) }
            } label: {
                Label(model.trip?.destinationZoneId == nil ? "Cleaner area" : "Cleaner route",
                      systemImage: "arrow.triangle.branch")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        Button {
            Task { await model.acknowledge(alertId: alert.id) }
        } label: {
            Label("Got it", systemImage: "checkmark").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        Button("Dismiss", role: .cancel) {
            Task { await model.dismiss(alertId: alert.id) }
        }
        .font(.footnote)
    }
}
