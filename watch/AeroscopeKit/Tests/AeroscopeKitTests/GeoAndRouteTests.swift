import XCTest
@testable import AeroscopeKit

final class GeoAndRouteTests: XCTestCase {
    private var dataset: CityDataset!
    private var readings: [String: ZoneReading]!

    override func setUpWithError() throws {
        dataset = try CityDataset.bundled()
        readings = ScenarioEngine.readings(for: dataset, scenario: .demoDefault)
    }

    // MARK: Geo

    func testHaversineDistance() {
        let cp = GeoPoint(lat: 28.6315, lon: 77.2167)
        let ig = GeoPoint(lat: 28.6129, lon: 77.2295)
        XCTAssertEqual(Geo.distanceKm(cp, ig), 2.42, accuracy: 0.05)
        XCTAssertEqual(Geo.distanceKm(cp, cp), 0, accuracy: 1e-9)
    }

    func testEveryAnchorLocatesToItsOwnZone() {
        let locator = ZoneLocator(dataset: dataset)
        for zone in dataset.zones {
            guard case .inside(let match) = locator.locate(zone.geo!) else {
                return XCTFail("\(zone.id) not located")
            }
            XCTAssertEqual(match.zoneId, zone.id)
        }
    }

    func testPointsOutsideDelhiAreOutsideCoverage() {
        let cupertino = GeoPoint(lat: 37.3349, lon: -122.009)
        guard case .outsideCoverage(let name, let km) = ZoneLocator(dataset: dataset).locate(cupertino) else {
            return XCTFail("expected outside coverage")
        }
        XCTAssertNotNil(name)
        XCTAssertGreaterThan(km ?? 0, 1000)
    }

    func testProjectionPlacesAnchorsNearTheirSceneZones() throws {
        let projection = try XCTUnwrap(CityProjection(dataset: dataset))
        var totalError = 0.0
        for zone in dataset.zones {
            let p = projection.world(for: zone.geo!)
            totalError += hypot(p.x - zone.position.x, p.z - zone.position.z)
        }
        // The scene is schematic, so the fit is approximate; it must still be
        // far tighter than the ~200-unit city span.
        XCTAssertLessThan(totalError / Double(dataset.zones.count), 25)
        // Orientation: east is +x, south is +z.
        let east = projection.world(for: GeoPoint(lat: 28.63, lon: 77.30))
        let west = projection.world(for: GeoPoint(lat: 28.63, lon: 77.13))
        XCTAssertGreaterThan(east.x, west.x)
        let north = projection.world(for: GeoPoint(lat: 28.70, lon: 77.22))
        let south = projection.world(for: GeoPoint(lat: 28.53, lon: 77.22))
        XCTAssertGreaterThan(south.z, north.z)
    }

    func testDatasetLinksAreValidAndConnected() {
        let ids = Set(dataset.zones.map(\.id))
        for link in dataset.links {
            XCTAssertEqual(link.count, 2)
            XCTAssertTrue(link.allSatisfy(ids.contains), "\(link)")
        }
        // Every zone reachable from Lodhi Garden.
        let adjacency = dataset.adjacency
        var seen: Set<String> = ["z-lg"]
        var frontier = ["z-lg"]
        while let next = frontier.popLast() {
            for n in adjacency[next, default: []] where !seen.contains(n) {
                seen.insert(n)
                frontier.append(n)
            }
        }
        XCTAssertEqual(seen, ids)
    }

    // MARK: Routes

    func testDemoScenarioOffersCleanerRouteViaYamuna() throws {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        let fastest = try XCTUnwrap(planner.route(from: "z-ig", to: "z-rf", kind: .fastest, mode: .walk))
        XCTAssertEqual(fastest.zoneIds, ["z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"])

        let comparison = try XCTUnwrap(planner.compare(from: "z-ig", to: "z-rf", mode: .walk, now: Date()))
        let alternative = try XCTUnwrap(comparison.alternative)
        XCTAssertEqual(alternative.zoneIds, ["z-ig", "z-yb", "z-rf"])
        XCTAssertLessThan(alternative.exposureIndex, comparison.current.exposureIndex)
        XCTAssertLessThan(alternative.averageAqi, comparison.current.averageAqi)
        XCTAssertGreaterThanOrEqual(comparison.exposureReductionPercent ?? 0, RoutePlanner.minimumReductionPercent)
        XCTAssertGreaterThanOrEqual(alternative.distanceKm, comparison.current.distanceKm)
        XCTAssertTrue(comparison.note.contains("Yamuna Riverfront"))
    }

    func testCompareUsesRemainderOfPlannedRoute() throws {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        let planned = ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"]
        let comparison = try XCTUnwrap(planner.compare(from: "z-ig", to: "z-rf", mode: .walk, plannedZoneIds: planned, now: Date()))
        XCTAssertEqual(comparison.current.kind, .planned)
        XCTAssertEqual(comparison.current.zoneIds, Array(planned.dropFirst()))
    }

    func testNoAlternativeWhenAlreadyCleanest() throws {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        let comparison = try XCTUnwrap(planner.compare(from: "z-yb", to: "z-rf", mode: .walk, now: Date()))
        XCTAssertNil(comparison.alternative)
        XCTAssertNil(comparison.exposureReductionPercent)
        XCTAssertEqual(comparison.current.zoneIds, ["z-yb", "z-rf"])
    }

    func testSameOriginAndDestination() throws {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        let comparison = try XCTUnwrap(planner.compare(from: "z-cp", to: "z-cp", mode: .walk, now: Date()))
        XCTAssertEqual(comparison.current.zoneIds, ["z-cp"])
        XCTAssertNil(comparison.alternative)
    }

    func testUnknownZonesAndBrokenPathsReturnNil() {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        XCTAssertNil(planner.route(from: "z-nope", to: "z-rf", kind: .fastest, mode: .walk))
        // z-lg and z-rf are not adjacent, so an explicit hop between them is invalid.
        XCTAssertNil(planner.option(for: ["z-lg", "z-rf"], kind: .planned, mode: .walk))
    }

    func testDurationsScaleWithTravelMode() throws {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        let walk = try XCTUnwrap(planner.route(from: "z-lg", to: "z-rf", kind: .fastest, mode: .walk))
        let cycle = try XCTUnwrap(planner.route(from: "z-lg", to: "z-rf", kind: .fastest, mode: .cycle))
        XCTAssertEqual(walk.distanceKm, cycle.distanceKm)
        XCTAssertGreaterThan(walk.durationMinutes, cycle.durationMinutes)
    }

    func testCleanerNeighbor() throws {
        let planner = RoutePlanner(dataset: dataset, readings: readings)
        let suggestion = try XCTUnwrap(planner.cleanerNeighbor(of: "z-cp", mode: .walk))
        XCTAssertLessThan(suggestion.aqi, readings["z-cp"]!.aqi)
        XCTAssertEqual(suggestion.zoneId, "z-ig")
        // Lodhi Garden is the cleanest pocket: no cleaner neighbour.
        XCTAssertNil(planner.cleanerNeighbor(of: "z-lg", mode: .walk))
    }

    // MARK: Demo journey

    func testDemoJourneyIsDeterministic() throws {
        let route = try XCTUnwrap(RoutePlanner(dataset: dataset, readings: readings)
            .route(from: DemoJourney.defaultOriginZoneId, to: DemoJourney.defaultDestinationZoneId, kind: .fastest, mode: .walk))
        var a = DemoJourney(zoneIds: route.zoneIds, dataset: dataset)
        var b = DemoJourney(zoneIds: route.zoneIds, dataset: dataset)
        XCTAssertEqual(a.waypoints.count, (route.zoneIds.count - 1) * DemoJourney.substepsPerSegment + 1)
        while !a.isFinished {
            XCTAssertEqual(a.advance(), b.advance())
        }
        XCTAssertEqual(a.current, dataset.zone(id: "z-rf")?.geo)
        XCTAssertEqual(a.advance(), a.current, "advancing past the end stays put")
    }

    func testDemoRerouteContinuesFromCurrentPosition() throws {
        var journey = DemoJourney(zoneIds: ["z-lg", "z-ig", "z-cp"], dataset: dataset)
        journey.advance()
        let here = try XCTUnwrap(journey.current)
        journey.reroute(zoneIds: ["z-ig", "z-yb", "z-rf"], dataset: dataset)
        XCTAssertEqual(journey.current, here)
        XCTAssertEqual(journey.zoneIds, ["z-ig", "z-yb", "z-rf"])
    }
}
