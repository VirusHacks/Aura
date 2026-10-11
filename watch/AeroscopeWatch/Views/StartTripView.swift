import AeroscopeKit
import SwiftUI

/// Start point and destination shown before a trip starts. In live mode the trip
/// can start from a chosen zone with a SIMULATED position: the web dashboard then
/// walks the character and the watch follows. A destination enables look-ahead
/// warnings and cleaner-route comparisons.
struct StartTripView: View {
    /// (destination zone, simulated start zone or nil for this device's location)
    let onStart: (String?, String?) -> Void

    @Environment(AeroscopeModel.self) private var model
    @State private var startZoneId: String? = "z-cc"

    var body: some View {
        NavigationStack {
            List {
                if model.mode == .live {
                    Section {
                        Picker("Start at", selection: $startZoneId) {
                            Text("My location").tag(String?.none)
                            ForEach(model.destinationChoices) { zone in
                                Text(zone.name).tag(Optional(zone.id))
                            }
                        }
                    } footer: {
                        Text(startZoneId == nil ? "Uses this watch's GPS." : "SIMULATED position — walk it on the dashboard.")
                    }
                }
                if model.mode == .demo, let suggested = model.zoneName(DemoJourney.defaultDestinationZoneId) {
                    Section {
                        Button { onStart(DemoJourney.defaultDestinationZoneId, nil) } label: {
                            VStack(alignment: .leading) {
                                Text(suggested)
                                Text("Demo route from Lodhi Garden").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("Suggested")
                    }
                }
                Section {
                    Button { onStart(nil, startZoneId) } label: {
                        Label("No destination", systemImage: "location")
                    }
                }
                Section("Destination") {
                    ForEach(model.destinationChoices) { zone in
                        Button(zone.name) { onStart(zone.id, startZoneId) }
                    }
                }
            }
            .navigationTitle("Where to?")
        }
    }
}
