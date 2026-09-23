import FirebaseFirestore
import SwiftUI

/// M4: joins the Quick Match queue and waits (via a realtime listener on quickMatch/{uid}) for a pairing.
struct QuickMatchView: View {
    let onMatched: (String) -> Void

    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var phase: Phase = .joining
    @State private var error: AppError?
    @State private var listener: ListenerRegistration?

    enum Phase { case joining, waiting, matched }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer()
                Image(systemName: "bolt.horizontal.circle.fill").font(.system(size: 64)).foregroundStyle(Theme.accent)
                    .symbolEffectIfAvailable()
                Text(phase == .joining ? "Joining the queue…" : "Looking for an opponent…").font(.title3.bold())
                Text("You can leave this screen open or come back later — we'll notify you when a game starts.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                ProgressView()
                Spacer()
                Button("Cancel") { cancel() }.buttonStyle(SecondaryButtonStyle())
            }
            .padding(24)
            .background(Theme.background)
            .navigationTitle("Quick Match")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled()
            .task { await join() }
            .onDisappear { listener?.remove() }
            .appErrorAlert($error)
        }
    }

    private func join() async {
        guard let uid = session.uid else { return }
        do {
            let result = try await GameService.shared.joinQuickMatch()
            if let gameId = result.gameId {
                matched(gameId)
                return
            }
            phase = .waiting
            listener = Firestore.firestore().document("quickMatch/\(uid)").addSnapshotListener { snapshot, _ in
                if let gameId = snapshot?.get("gameId") as? String {
                    Task { @MainActor in matched(gameId) }
                }
            }
        } catch {
            self.error = AppError.from(error)
        }
    }

    private func matched(_ gameId: String) {
        guard phase != .matched else { return }
        phase = .matched
        listener?.remove()
        dismiss()
        onMatched(gameId)
    }

    private func cancel() {
        listener?.remove()
        Task {
            try? await GameService.shared.cancelQuickMatch()
        }
        dismiss()
    }
}

private extension View {
    /// `symbolEffect` is iOS 17+; keep the iOS 16 deployment target working.
    @ViewBuilder
    func symbolEffectIfAvailable() -> some View {
        if #available(iOS 17, *) {
            self.symbolEffect(.pulse)
        } else {
            self
        }
    }
}
