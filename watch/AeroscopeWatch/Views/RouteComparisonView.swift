import AeroscopeKit
import SwiftUI

/// Screen 4 — current route versus the cleaner alternative.
struct RouteComparisonView: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        ScrollView {
            switch model.routeState {
            case .idle:
                EmptyView()
            case .loading:
                ProgressView("Comparing routes…")
            case .loaded(let comparison, _, let offlineEstimate):
                loaded(comparison, offlineEstimate: offlineEstimate)
            case .noDestination(let suggestion, _):
                noDestination(suggestion)
            case .failed(let message, _):
                VStack(alignment: .leading, spacing: 8) {
                    Label(message, systemImage: "exclamationmark.triangle").font(.footnote)
                    Button("Close") { model.closeRoute() }
                }
            }
        }
        .navigationTitle("Routes")
    }

    private func loaded(_ comparison: RouteComparison, offlineEstimate: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let alternative = comparison.alternative {
                RouteCard(title: "Cleaner route", option: alternative, highlighted: true)
                HStack(spacing: 6) {
                    if let reduction = comparison.exposureReductionPercent {
                        Text("−\(reduction)% exposure").foregroundStyle(.green)
                    }
                    if let extra = comparison.extraMinutes {
                        Text(extra > 0 ? "+\(extra) min" : extra < 0 ? "\(extra) min" : "same time")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.footnote.weight(.semibold))
                Button {
                    Task { await model.chooseRoute(comparison, choice: .alternative) }
                } label: {
                    Label("Take cleaner route", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                RouteCard(title: "Current route", option: comparison.current, highlighted: false)
                Button("Keep current route") {
                    Task { await model.chooseRoute(comparison, choice: .current) }
                }
            } else {
                Text(comparison.note).font(.footnote)
                RouteCard(title: "Your route", option: comparison.current, highlighted: false)
                Button("OK") { Task { await model.chooseRoute(comparison, choice: .current) } }
            }
            if offlineEstimate {
                Label("Estimate from cached data", systemImage: "clock.arrow.circlepath")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let scenario = comparison.scenarioLabel {
                Text("Simulated · \(scenario)").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func noDestination(_ suggestion: NeighborSuggestion?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No destination set").font(.headline)
            if let suggestion {
                Text("Nearest cleaner area").font(.caption2).foregroundStyle(.secondary)
                HStack {
                    Text(suggestion.zoneName).font(.footnote.weight(.semibold))
                    Spacer()
                    AQIBadge(aqi: suggestion.aqi, compact: true)
                }
                Text("\(Formatting.km(suggestion.distanceKm)) · about \(suggestion.minutes) min")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("No cleaner neighbouring zone right now. Consider a mask or limiting time outdoors.")
                    .font(.footnote)
            }
            Button("OK") { model.closeRoute() }
        }
    }
}

private struct RouteCard: View {
    let title: String
    let option: RouteOption
    let highlighted: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title).font(.caption2.weight(.semibold)).foregroundStyle(highlighted ? .green : .secondary)
                Spacer()
                AQIBadge(aqi: option.averageAqi, compact: true)
            }
            if !option.viaNames.isEmpty {
                Text("via \(option.viaNames.joined(separator: ", "))")
                    .font(.footnote)
                    .lineLimit(3)
            }
            Text("\(Formatting.km(option.distanceKm)) · \(option.durationMinutes) min")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Peak \(option.peakAqi) at \(option.peakZoneName)")
                .font(.caption2)
                .foregroundStyle(option.peakCategory.onDarkColor)
        }
        .padding(8)
        .background(Color.white.opacity(highlighted ? 0.1 : 0.05), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            if highlighted { RoundedRectangle(cornerRadius: 10).strokeBorder(.green.opacity(0.6)) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), average AQI \(option.averageAqi), \(Formatting.km(option.distanceKm)), \(option.durationMinutes) minutes, peak \(option.peakAqi) at \(option.peakZoneName)")
    }
}
