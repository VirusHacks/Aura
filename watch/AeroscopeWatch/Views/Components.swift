import AeroscopeKit
import SwiftUI

/// Ring gauge: arc length tracks AQI on the 0–500 scale; the centre always
/// shows the number and category text so colour is never the only cue.
struct AQIGauge: View {
    let aqi: Int
    var size: CGFloat = 92

    var body: some View {
        let category = AQIScale.category(for: aqi)
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.12), lineWidth: size * 0.09)
            Circle()
                .trim(from: 0, to: max(0.03, CGFloat(aqi) / CGFloat(AQIScale.maximum)))
                .stroke(category.onDarkColor, style: StrokeStyle(lineWidth: size * 0.09, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: -2) {
                Text("\(aqi)")
                    .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                Text(category.band.shortLabel)
                    .font(.system(size: size * 0.13, weight: .semibold, design: .rounded))
                    .foregroundStyle(category.onDarkColor)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Air quality index \(aqi), \(category.label)")
    }
}

/// Category name with its shape cue.
struct CategoryLabel: View {
    let category: AQICategory

    var body: some View {
        Label(category.label, systemImage: category.symbolName)
            .font(.headline)
            .foregroundStyle(category.onDarkColor)
    }
}

struct MetricRow: View {
    let title: String
    let value: String
    var systemImage: String?

    var body: some View {
        HStack {
            if let systemImage {
                Image(systemName: systemImage).foregroundStyle(.secondary).frame(width: 16)
            }
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).monospacedDigit().multilineTextAlignment(.trailing)
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
    }
}

struct IssueBanner: View {
    let issue: ReadingIssue

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(issue.title, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.yellow)
            Text(issue.detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color.yellow.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }
}

struct OriginTag: View {
    let alert: PollutionAlert

    var body: some View {
        let (text, color): (String, Color) = switch alert.origin {
        case .demo: ("DEMO", DataStatus.demo.tint)
        case .device: ("OFFLINE ESTIMATE", DataStatus.cached.tint)
        case .backend: ("AEROSCOPE", DataStatus.live.tint)
        }
        Text(text)
            .font(.system(.caption2, design: .rounded).weight(.semibold))
            .foregroundStyle(color)
    }
}

extension AlertStatus {
    var label: String {
        switch self {
        case .active: "New"
        case .acknowledged: "Acknowledged"
        case .dismissed: "Dismissed"
        case .rerouteRequested: "Route requested"
        case .rerouted: "Rerouted"
        }
    }

    var symbolName: String {
        switch self {
        case .active: "bell.badge.fill"
        case .acknowledged: "checkmark.circle"
        case .dismissed: "xmark.circle"
        case .rerouteRequested: "arrow.triangle.branch"
        case .rerouted: "arrow.triangle.turn.up.right.circle.fill"
        }
    }
}
