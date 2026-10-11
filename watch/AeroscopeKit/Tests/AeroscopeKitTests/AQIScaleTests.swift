import XCTest
@testable import AeroscopeKit

final class AQIScaleTests: XCTestCase {
    func testBandBoundariesMapToCPCBCategories() {
        let cases: [(Int, AQICategory)] = [
            (0, .good), (50, .good),
            (51, .satisfactory), (100, .satisfactory),
            (101, .moderate), (200, .moderate),
            (201, .poor), (300, .poor),
            (301, .veryPoor), (400, .veryPoor),
            (401, .severe), (500, .severe),
        ]
        for (aqi, expected) in cases {
            XCTAssertEqual(AQIScale.category(for: aqi), expected, "AQI \(aqi)")
        }
    }

    func testOutOfRangeAndNonFiniteValuesClamp() {
        XCTAssertEqual(AQIScale.category(for: -20), .good)
        XCTAssertEqual(AQIScale.category(for: 731), .severe)
        XCTAssertEqual(AQIScale.clamp(Double.nan), 0)
        XCTAssertEqual(AQIScale.clamp(Double.infinity), 0)
        XCTAssertEqual(AQIScale.clamp(612.0), 500)
    }

    func testFractionalValuesRoundLikeTheWebApp() {
        // JavaScript Math.round: ties go up.
        XCTAssertEqual(AQIScale.clamp(50.4), 50)
        XCTAssertEqual(AQIScale.clamp(50.5), 51)
        XCTAssertEqual(AQIScale.category(for: 50.5), .satisfactory)
        XCTAssertEqual(AQIScale.category(for: 200.49), .moderate)
        XCTAssertEqual(AQIScale.category(for: 200.5), .poor)
    }

    func testBandsAreContiguousAndOrdered() {
        var expectedLower = 0
        for (i, band) in AQIScale.bands.enumerated() {
            XCTAssertEqual(band.range.lowerBound, expectedLower)
            XCTAssertEqual(band.category.rank, i)
            expectedLower = band.range.upperBound + 1
        }
        XCTAssertEqual(expectedLower - 1, AQIScale.maximum)
        XCTAssertEqual(AQICategory.allCases.sorted(), AQICategory.allCases)
    }

    func testEveryValueHasExactlyOneBand() {
        for aqi in 0...AQIScale.maximum {
            let matching = AQIScale.bands.filter { $0.range.contains(aqi) }
            XCTAssertEqual(matching.count, 1, "AQI \(aqi)")
            XCTAssertEqual(matching.first?.category, AQIScale.category(for: aqi))
        }
    }

    func testHighPollutionMatchesDashboardKPI() {
        XCTAssertFalse(AQIScale.isHighPollution(200))
        XCTAssertTrue(AQIScale.isHighPollution(201))
    }

    func testSubIndexValuesMatchWebImplementation() {
        // Values printed by the web app's lib/aqi.ts.
        XCTAssertEqual(AQIScale.subIndex(.pm25, concentration: 45), 75)
        XCTAssertEqual(AQIScale.subIndex(.pm10, concentration: 300), 250)
        XCTAssertEqual(AQIScale.concentration(forIndex: 235, pollutant: .pm25), 101)
        XCTAssertEqual(AQIScale.concentration(forIndex: 412, pollutant: .pm10), 440)
    }

    func testConcentrationRoundTripsForEveryIndex() {
        for i in 0...AQIScale.maximum {
            for p in [Pollutant.pm25, .pm10] {
                let c = AQIScale.concentration(forIndex: i, pollutant: p)
                XCTAssertGreaterThanOrEqual(AQIScale.subIndex(p, concentration: Double(c)), i, "\(p) index \(i)")
            }
        }
    }

    func testCategoryDecodedFromPayloadIsIgnored() throws {
        let json = #"{"zoneId":"z-x","zoneName":"X","aqi":250,"category":"Good","provenance":"demo"}"#
        let reading = try AeroscopeJSON.decoder().decode(ZoneReading.self, from: Data(json.utf8))
        XCTAssertEqual(reading.category, .poor)
        XCTAssertTrue(reading.simulated, "readings default to simulated unless they say otherwise")
    }
}
