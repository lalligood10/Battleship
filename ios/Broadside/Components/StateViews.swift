import SwiftUI

struct LoadingView: View {
    var text = "Loading…"
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ErrorStateView: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.orange)
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            if let retry {
                Button("Try again", action: retry).buttonStyle(.bordered)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage).font(.system(size: 40)).foregroundStyle(Theme.accent)
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
    }
}

/// Presents `AppError`s as alerts. Usage: `.appErrorAlert($viewModel.error)`.
extension View {
    func appErrorAlert(_ error: Binding<AppError?>) -> some View {
        alert(item: error) { err in
            Alert(title: Text("Something went wrong"), message: Text(err.errorDescription ?? ""), dismissButton: .default(Text("OK")))
        }
    }
}

/// Shown when GoogleService-Info.plist is missing so the owner knows exactly what to do.
struct MissingConfigView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "gearshape.2").font(.system(size: 44)).foregroundStyle(Theme.accent)
            Text("Firebase isn't configured yet").font(.title2.bold())
            Text("Download GoogleService-Info.plist from your Firebase project and put it in:")
            Text("ios/Broadside/Config/GoogleService-Info.plist").font(.footnote.monospaced()).padding(8).background(Theme.card, in: RoundedRectangle(cornerRadius: 8))
            Text("Then rebuild the app. Step-by-step instructions are in README.md, step 3.").foregroundStyle(.secondary)
            Spacer()
        }
        .padding(24)
    }
}
