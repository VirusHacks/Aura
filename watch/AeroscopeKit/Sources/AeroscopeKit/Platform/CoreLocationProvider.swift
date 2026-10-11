#if canImport(CoreLocation)
import CoreLocation
import Foundation

/// Core Location implementation of `LocationProviding`.
///
/// Idle: one-shot `requestLocation()` fixes at ~100 m accuracy.
/// Trip: continuous updates with a distance filter. Background continuation
/// is enabled only when the app declares the `location` background mode in
/// its Info.plist; setting `allowsBackgroundLocationUpdates` without it is a
/// fatal error, so it is checked at runtime.
@MainActor
public final class CoreLocationProvider: NSObject, LocationProviding {
    public var onUpdate: ((LocationFix) -> Void)?
    public var onAuthorizationChange: ((LocationAuthorization) -> Void)?
    public var onFailure: ((String) -> Void)?

    private let manager = CLLocationManager()
    #if os(watchOS) || os(iOS)
    private var backgroundSession: CLBackgroundActivitySession?
    #endif

    /// Fixes worse than this are ignored; they cannot place the user in a zone.
    nonisolated static let maximumAccuracyMeters: Double = 1_000

    public override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
    }

    public var authorization: LocationAuthorization { Self.map(manager.authorizationStatus) }

    /// Mirrors Core Location's own check: only `UIBackgroundModes` counts, on
    /// watchOS as well as iOS. A `location` entry under `WKBackgroundModes` is
    /// ignored by Core Location and would still trip its assertion.
    public static var declaresBackgroundLocation: Bool {
        let modes = Bundle.main.infoDictionary?["UIBackgroundModes"] as? [String] ?? []
        return modes.contains("location")
    }

    public func requestAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    public func requestFix() {
        guard authorization.isAuthorized else { return }
        manager.requestLocation()
    }

    public func startTripUpdates() {
        guard authorization.isAuthorized else { return }
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 75
        if Self.declaresBackgroundLocation {
            manager.allowsBackgroundLocationUpdates = true
            #if os(watchOS) || os(iOS)
            backgroundSession = CLBackgroundActivitySession()
            #endif
        }
        manager.startUpdatingLocation()
    }

    public func stopTripUpdates() {
        manager.stopUpdatingLocation()
        if Self.declaresBackgroundLocation { manager.allowsBackgroundLocationUpdates = false }
        #if os(watchOS) || os(iOS)
        backgroundSession?.invalidate()
        backgroundSession = nil
        #endif
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
    }

    nonisolated static func map(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        case .authorizedAlways, .authorizedWhenInUse: .authorized
        @unknown default: .denied
        }
    }
}

extension CoreLocationProvider: CLLocationManagerDelegate {
    nonisolated public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = Self.map(manager.authorizationStatus)
        Task { @MainActor in self.onAuthorizationChange?(status) }
    }

    nonisolated public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let best = locations.last(where: {
            $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= CoreLocationProvider.maximumAccuracyMeters
        }) else { return }
        let fix = LocationFix(
            point: GeoPoint(lat: best.coordinate.latitude, lon: best.coordinate.longitude),
            at: best.timestamp, accuracyMeters: best.horizontalAccuracy, simulated: false
        )
        Task { @MainActor in self.onUpdate?(fix) }
    }

    nonisolated public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // kCLErrorLocationUnknown is transient: Core Location keeps trying.
        if let clError = error as? CLError, clError.code == .locationUnknown { return }
        let message = (error as? CLError)?.code == .denied ? "Location access denied" : error.localizedDescription
        Task { @MainActor in self.onFailure?(message) }
    }
}
#endif
