import AeroscopeKit
import SwiftUI

/// Screen 2 — the active trip: elapsed time, current zone, exposure and controls.
struct TripView: View {
    @Environment(AeroscopeModel.self) private var model
    @State private var choosingDestination = false
    @State private var confirmingEnd = false

    var body: some View {
        ScrollView {
            if let trip = model.trip, trip.isOngoing {
                ActiveTripContent(trip: trip, confirmingEnd: $confirmingEnd)
            } else {
                idleContent
            }
        }
        .navigationTitle("Trip")
        .sheet(isPresented: $choosingDestination) {
            StartTripView { destination, start in
                choosingDestination = false
                Task { await model.startTrip(destinationZoneId: destination, startZoneId: start) }
            }
        }
        .confirmationDialog("End this trip?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("End Trip", role: .destructive) { Task { await model.endTrip() } }
        }
    }

    private var idleContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("No active trip").font(.headline)
            Text("Start a trip to get warnings about polluted zones on your way and cleaner route options.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button { choosingDestination = true } label: {
                Label("Start Trip", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            if let last = model.recentTrips.first {
                LastTripCard(trip: last)
            }
        }
    }
}

private struct ActiveTripContent: View {
    let trip: Trip
    @Binding var confirmingEnd: Bool

    @Environment(AeroscopeModel.self) private var model
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(trip.phase == .paused ? "PAUSED" : "ACTIVE")
                    .font(.system(.caption2, design: .rounded).weight(.heavy))
                    .foregroundStyle(trip.phase == .paused ? .yellow : .green)
                if trip.source == .demo { DataStatusBadge(.demo) }
                Spacer()
                Image(systemName: trip.mode.symbolName).foregroundStyle(.secondary)
            }
            // Seconds only when the screen is fully on; minutes in always-on mode.
            TimelineView(.periodic(from: .now, by: isLuminanceReduced ? 60 : 1)) { context in
                Text(Formatting.duration(trip.activeDuration(at: context.date), short: isLuminanceReduced))
                    .font(.system(size: 34, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .accessibilityLabel("Elapsed \(Formatting.duration(trip.activeDuration(at: context.date), short: true))")
            }

            if let sample = trip.lastSample {
                HStack {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Now in").font(.caption2).foregroundStyle(.secondary)
                        Text(sample.zoneName).font(.footnote.weight(.semibold)).lineLimit(2)
                    }
                    Spacer()
                    AQIBadge(aqi: sample.aqi)
                }
            } else {
                Text("Waiting for first position…").font(.footnote).foregroundStyle(.secondary)
            }

            if let destination = trip.destinationName {
                MetricRow(title: "To", value: destination, systemImage: "flag.checkered")
                if let next = model.zoneName(trip.nextPlannedZoneId) {
                    MetricRow(title: "Next", value: next, systemImage: "arrow.forward")
                }
                if trip.hasArrived {
                    Label("Arrived", systemImage: "checkmark.seal.fill").font(.footnote).foregroundStyle(.green)
                }
            }

            Divider()
            if let average = trip.exposure.averageAqi {
                HStack {
                    Text("Avg exposure").font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    AQIBadge(aqi: average, compact: true)
                }
            }
            if trip.exposure.peakAqi > 0 {
                MetricRow(title: "Peak", value: "\(trip.exposure.peakAqi) · \(trip.exposure.peakZoneName ?? "")",
                          systemImage: "arrow.up.to.line")
            }
            MetricRow(title: "Zones", value: "\(trip.zonesVisited.count)", systemImage: "map")
            MetricRow(title: "Alerts", value: "\(trip.alertIds.count)", systemImage: "bell")
            if trip.rerouteCount > 0 {
                MetricRow(title: "Reroutes", value: "\(trip.rerouteCount)", systemImage: "arrow.triangle.branch")
            }

            controls
        }
    }

    @ViewBuilder
    private var controls: some View {
        if trip.phase == .active {
            Button { Task { await model.pauseTrip() } } label: {
                Label("Pause", systemImage: "pause.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        } else {
            Button { Task { await model.resumeTrip() } } label: {
                Label("Resume", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        Button(role: .destructive) { confirmingEnd = true } label: {
            Label("End Trip", systemImage: "stop.fill").frame(maxWidth: .infinity)
        }
        if trip.source == .demo && trip.phase == .active {
            Button { Task { await model.demoStep() } } label: {
                Label("Advance demo", systemImage: "forward.frame")
                    .font(.footnote)
                    .frame(maxWidth: .infinity)
            }
            .tint(DataStatus.demo.tint)
        }
    }
}

struct LastTripCard: View {
    let trip: TripSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Last trip").font(.caption2).foregroundStyle(.secondary)
            MetricRow(title: "Time", value: Formatting.duration(trip.activeSeconds, short: true))
            if let average = trip.averageAqi {
                HStack {
                    Text("Avg AQI").font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    AQIBadge(aqi: average, compact: true)
                }
            }
            MetricRow(title: "Alerts", value: "\(trip.alertCount)")
        }
        .padding(8)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }
}
