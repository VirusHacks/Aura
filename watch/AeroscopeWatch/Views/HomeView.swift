import AeroscopeKit
import SwiftUI

/// Screen 1 — current air quality, data status and the trip action.
struct HomeView: View {
    let showTrip: () -> Void

    @Environment(AeroscopeModel.self) private var model
    @State private var choosingDestination = false
    @State private var confirmingEnd = false

    var body: some View {
        ScrollView {
            // Re-evaluated every minute so LIVE ages to CACHED and stale data is flagged.
            TimelineView(.everyMinute) { context in
                VStack(alignment: .leading, spacing: 10) {
                    header(now: context.date)
                    if let snapshot = model.snapshot {
                        ReadingCard(snapshot: snapshot, now: context.date,
                                    locationIsCurrent: model.snapshotLocationIsCurrent(at: context.date))
                        if let issue = model.issue { IssueBanner(issue: issue) }
                    } else {
                        EmptyReadingView()
                    }
                    if let notice = model.notice {
                        Text(notice).font(.caption2).foregroundStyle(.secondary)
                    }
                    tripSection
                }
                .padding(.horizontal, 2)
            }
        }
        .navigationTitle("Air")
        .sheet(isPresented: $choosingDestination) {
            StartTripView { destination in
                choosingDestination = false
                Task {
                    await model.startTrip(destinationZoneId: destination)
                    showTrip()
                }
            }
        }
        .confirmationDialog("End this trip?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("End Trip", role: .destructive) { Task { await model.endTrip() } }
        }
    }

    private func header(now: Date) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("AEROSCOPE")
                .font(.system(.caption2, design: .rounded).weight(.heavy))
                .tracking(1.5)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            if let snapshot = model.snapshot {
                DataStatusBadge(snapshot.status(at: now))
            } else if model.mode == .demo {
                DataStatusBadge(.demo)
            }
        }
    }

    @ViewBuilder
    private var tripSection: some View {
        if let trip = model.trip, trip.isOngoing {
            Button(action: showTrip) {
                HStack {
                    Image(systemName: trip.phase == .paused ? "pause.circle.fill" : "figure.walk.motion")
                        .foregroundStyle(trip.phase == .paused ? .yellow : .green)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(trip.phase == .paused ? "Trip paused" : "Trip active").font(.footnote.weight(.semibold))
                        if let destination = trip.destinationName {
                            Text("To \(destination)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.bordered)
            Button(role: .destructive) { confirmingEnd = true } label: {
                Label("End Trip", systemImage: "stop.fill").frame(maxWidth: .infinity)
            }
        } else {
            Button { choosingDestination = true } label: {
                Label("Start Trip", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            if let last = model.recentTrips.first {
                Text(lastTripText(last)).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func lastTripText(_ trip: TripSummary) -> String {
        var parts = ["Last trip \(Formatting.duration(trip.activeSeconds, short: true))"]
        if let average = trip.averageAqi { parts.append("avg AQI \(average)") }
        return parts.joined(separator: " · ")
    }
}

private struct ReadingCard: View {
    let snapshot: ReadingSnapshot
    let now: Date
    let locationIsCurrent: Bool

    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        let reading = snapshot.reading
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                AQIGauge(aqi: reading.aqi, size: 84)
                VStack(alignment: .leading, spacing: 2) {
                    CategoryLabel(category: reading.category)
                    if !locationIsCurrent && snapshot.source == .live {
                        Text("Last known zone").font(.caption2).foregroundStyle(.yellow)
                    }
                    Text(reading.zoneName)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
            }
            if let pm25 = reading.pm25 {
                MetricRow(title: "PM2.5", value: "\(pm25) µg/m³", systemImage: "aqi.medium")
            }
            HStack(spacing: 4) {
                Text("Updated \(Text(snapshot.dataAsOf, style: .relative)) ago")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button {
                    Task { await model.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .disabled(model.isRefreshing)
                .accessibilityLabel("Refresh reading")
            }
            if snapshot.isStale(at: now) {
                Label("Stale reading", systemImage: "clock.badge.exclamationmark")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.yellow)
            }
            if reading.simulated, let scenario = snapshot.scenarioLabel {
                Text("Simulated · \(scenario)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

private struct EmptyReadingView: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.isRefreshing && model.issue == nil {
                ProgressView("Reading the air…")
            } else if let issue = model.issue {
                IssueBanner(issue: issue)
            } else {
                Text("No reading yet").font(.headline)
            }
            HStack {
                Button("Retry") { Task { await model.refresh() } }
                    .disabled(model.isRefreshing)
                if case .locationNotDetermined = model.issue {
                    Button("Allow") { model.requestLocationPermission() }
                }
            }
            if model.mode == .live, needsDemoOffer {
                Button {
                    Task { await model.setMode(.demo) }
                } label: {
                    Label("Try Demo", systemImage: "play.circle")
                }
                .tint(DataStatus.demo.tint)
            }
        }
    }

    private var needsDemoOffer: Bool {
        switch model.issue {
        case .backendNotConfigured, .outsideCoverage: true
        default: false
        }
    }
}
