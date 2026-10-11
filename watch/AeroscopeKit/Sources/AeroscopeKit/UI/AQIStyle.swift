import SwiftUI

public extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

public extension AQICategory {
    /// Band fill colour (same as the web dashboard).
    var color: Color { Color(hex: band.colorHex) }
    /// Text colour on top of `color`.
    var inkColor: Color { Color(hex: band.inkHex) }
    /// Stroke and text colour on a black background.
    var onDarkColor: Color { Color(hex: band.onDarkHex) }

    /// A shape cue in addition to colour, so severity never relies on hue alone.
    var symbolName: String {
        switch self {
        case .good, .satisfactory: "aqi.low"
        case .moderate, .poor: "aqi.medium"
        case .veryPoor, .severe: "aqi.high"
        }
    }
}

public extension DataStatus {
    var tint: Color {
        switch self {
        case .live: Color(hex: 0x51CF66)
        case .cached: Color(hex: 0xADB5BD)
        case .demo: Color(hex: 0x74C0FC)
        }
    }

    var symbolName: String {
        switch self {
        case .live: "dot.radiowaves.left.and.right"
        case .cached: "clock.arrow.circlepath"
        case .demo: "play.circle"
        }
    }
}

/// Numeric AQI plus category text on the band colour.
public struct AQIBadge: View {
    let aqi: Int
    var compact = false

    public init(aqi: Int, compact: Bool = false) {
        self.aqi = aqi
        self.compact = compact
    }

    public var body: some View {
        let category = AQIScale.category(for: aqi)
        HStack(spacing: 4) {
            Text("\(aqi)").monospacedDigit().fontWeight(.bold)
            if !compact { Text(category.label) }
        }
        .font(compact ? .caption2 : .caption)
        .foregroundStyle(category.inkColor)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(category.color, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("AQI \(aqi), \(category.label)")
    }
}

/// LIVE / CACHED / DEMO pill.
public struct DataStatusBadge: View {
    let status: DataStatus

    public init(_ status: DataStatus) {
        self.status = status
    }

    public var body: some View {
        Label(status.label, systemImage: status.symbolName)
            .labelStyle(.titleAndIcon)
            .font(.system(.caption2, design: .rounded).weight(.semibold))
            .foregroundStyle(status.tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(status.tint.opacity(0.6), lineWidth: 1))
            .accessibilityLabel("Data status: \(status.rawValue)")
    }
}

public enum Formatting {
    public static func duration(_ seconds: TimeInterval, short: Bool = false) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if short { return h > 0 ? "\(h)h \(m)m" : "\(m) min" }
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    public static func km(_ value: Double) -> String {
        String(format: value < 10 ? "%.1f km" : "%.0f km", value)
    }
}
