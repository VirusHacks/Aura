import AeroscopeKit
import SwiftUI

/// What the watch is doing: current reading, trip, recent trips and alerts.
struct ActivityView: View {
    @Environment(CompanionModel.self) private var model

    var body: some View {
        List {
            if let summary = model.watchSummary {
                Section("Now on the watch") {
                    if let snapshot = summary.snapshot {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(snapshot.reading.zoneName).font(.headline)
                                HStack(spacing: 6) {
                                    DataStatusBadge(snapshot.status(at: .now))
                                    Text(snapshot.dataAsOf, style: .relative).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            AQIBadge(aqi: snapshot.reading.aqi)
                        }
                    } else {
                        Text("No reading on the watch yet.").foregroundStyle(.secondary)
                    }
                    if let trip = summary.trip, trip.isOngoing {
                        TripRow(trip: trip)
                    }
                }

                Section("Recent trips") {
                    if summary.recentTrips.isEmpty { Text("No finished trips.").foregroundStyle(.secondary) }
                    ForEach(summary.recentTrips) { trip in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(trip.destinationName.map { "To \($0)" } ?? "Trip").font(.subheadline.weight(.semibold))
                                if trip.source == .demo { DataStatusBadge(.demo) }
                                Spacer()
                                if let avg = trip.averageAqi { AQIBadge(aqi: avg, compact: true) }
                            }
                            Text("\(trip.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(Formatting.duration(trip.activeSeconds, short: true)) · \(trip.zonesVisited) zones · \(trip.alertCount) alerts · \(trip.rerouteCount) reroutes")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Recent alerts on watch") {
                    if summary.recentAlerts.isEmpty { Text("No alerts.").foregroundStyle(.secondary) }
                    ForEach(summary.recentAlerts) { AlertRow(alert: $0) }
                }
            } else {
                ContentUnavailableView(
                    "Waiting for the watch",
                    systemImage: "applewatch",
                    description: Text("Open AEROSCOPE on your Apple Watch to share its status.")
                )
            }

            if !model.backendAlerts.isEmpty {
                Section("Backend alert history") {
                    ForEach(model.backendAlerts) { AlertRow(alert: $0) }
                }
            }
        }
        .navigationTitle("Activity")
        .refreshable {
            model.requestWatchSummary()
            await model.refreshActivity()
        }
    }
}

private struct TripRow: View {
    let trip: Trip

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(trip.phase == .paused ? "Trip paused" : "Trip active",
                      systemImage: trip.phase == .paused ? "pause.circle.fill" : "figure.walk.motion")
                    .foregroundStyle(trip.phase == .paused ? .orange : .green)
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(Formatting.duration(trip.activeDuration(at: context.date))).monospacedDigit()
                }
            }
            if let destination = trip.destinationName { Text("To \(destination)").font(.caption) }
            if let sample = trip.lastSample {
                Text("In \(sample.zoneName) · AQI \(sample.aqi)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct AlertRow: View {
    let alert: PollutionAlert

    var body: some View {
        HStack {
            RoundedRectangle(cornerRadius: 2).fill(alert.category.color).frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(alert.title).font(.subheadline.weight(.semibold))
                Text(alert.message).font(.caption)
                Text("\(alert.status.rawValue) · \(alert.origin.rawValue) · \(alert.createdAt.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            AQIBadge(aqi: alert.aqi, compact: true)
        }
        .accessibilityElement(children: .combine)
    }
}
