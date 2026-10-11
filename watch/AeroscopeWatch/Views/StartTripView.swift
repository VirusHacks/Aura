import AeroscopeKit
import SwiftUI

/// Destination picker shown before a trip starts. A destination enables
/// look-ahead warnings and cleaner-route comparisons.
struct StartTripView: View {
    let onStart: (String?) -> Void

    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                if model.mode == .demo, let suggested = model.zoneName(DemoJourney.defaultDestinationZoneId) {
                    Section {
                        Button { onStart(DemoJourney.defaultDestinationZoneId) } label: {
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
                    Button { onStart(nil) } label: {
                        Label("No destination", systemImage: "location")
                    }
                }
                Section("Destination") {
                    ForEach(model.destinationChoices) { zone in
                        Button(zone.name) { onStart(zone.id) }
                    }
                }
            }
            .navigationTitle("Where to?")
        }
    }
}
