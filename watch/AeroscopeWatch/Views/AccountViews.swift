import AeroscopeKit
import SwiftUI

/// Settings row: sign in by pairing code, or show the signed-in account.
struct AccountSection: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        switch model.authState {
        case .signedIn(let email):
            MetricRow(title: "Signed in", value: email ?? "AEROSCOPE account")
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        case .pairing(let code, _):
            PairingCodeView(code: code)
            Button("Cancel") { model.cancelPairing() }
        case .signingIn:
            HStack { ProgressView(); Text("Signing in…").font(.footnote) }
        case .signedOut, .expired, .failed:
            if case .expired = model.authState {
                Text("Session ended. Sign in again.").font(.caption2).foregroundStyle(.yellow)
            }
            if case .failed(let message) = model.authState {
                Text(message).font(.caption2).foregroundStyle(.yellow)
            }
            Button { model.beginPairing() } label: {
                Label("Sign in", systemImage: "person.badge.key")
            }
            .disabled(!model.isBackendConfigured)
        }
    }
}

/// Air screen card shown in live mode until the watch is signed in.
struct SignInCard: View {
    @Environment(AeroscopeModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch model.authState {
            case .pairing(let code, _):
                PairingCodeView(code: code)
            case .signingIn:
                HStack { ProgressView(); Text("Signing in…").font(.footnote) }
            default:
                Text("Link this watch to your AEROSCOPE account to go live.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if case .failed(let message) = model.authState {
                    Text(message).font(.caption2).foregroundStyle(.yellow)
                }
                Button { model.beginPairing() } label: {
                    Label("Sign in", systemImage: "person.badge.key")
                }
                .disabled(!model.isBackendConfigured)
            }
        }
        .padding(8)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    }
}

/// The pairing code, large enough to read across a desk.
struct PairingCodeView: View {
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Pairing code").font(.caption2).foregroundStyle(.secondary)
            Text(code)
                .font(.system(.title2, design: .monospaced).weight(.bold))
                .tracking(3)
                .minimumScaleFactor(0.6)
                .accessibilityLabel(code.map(String.init).joined(separator: " "))
            Text("Dashboard → Live → Pair Apple Watch").font(.caption2).foregroundStyle(.secondary)
        }
    }
}
