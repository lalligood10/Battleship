import SwiftUI

/// First-run screen: pick a unique username. Availability is checked live via the `checkUsername` Function
/// and enforced again server-side by `setUsername`.
struct UsernameView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var username = ""
    @State private var availability: Availability = .idle
    @State private var busy = false
    @State private var error: AppError?
    @State private var checkTask: Task<Void, Never>?

    enum Availability: Equatable {
        case idle, checking, available, unavailable(String)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Choose a call sign").font(.largeTitle.bold())
                Text("This is the name other players see on the leaderboards. 3–16 letters, numbers or underscores.")
                    .foregroundStyle(.secondary)

                TextField("Username", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .font(.title3)
                    .padding()
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onChange(of: username) { _ in scheduleCheck() }

                HStack(spacing: 6) {
                    switch availability {
                    case .idle:
                        EmptyView()
                    case .checking:
                        ProgressView().controlSize(.small)
                        Text("Checking…").foregroundStyle(.secondary)
                    case .available:
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text("Available").foregroundStyle(.green)
                    case .unavailable(let reason):
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                        Text(reason).foregroundStyle(.red)
                    }
                }
                .font(.subheadline)
                .frame(minHeight: 22)

                Spacer()

                Button {
                    save()
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text("Let's sail") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || availability != .available)

                Button("Sign out") { session.signOut() }
                    .font(.footnote)
                    .frame(maxWidth: .infinity)
            }
            .padding(24)
            .background(Theme.background)
            .appErrorAlert($error)
        }
    }

    private func scheduleCheck() {
        checkTask?.cancel()
        let candidate = username.trimmingCharacters(in: .whitespaces)
        guard candidate.count >= 3 else {
            availability = candidate.isEmpty ? .idle : .unavailable("Too short")
            return
        }
        availability = .checking
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000) // debounce typing
            guard !Task.isCancelled else { return }
            do {
                let result = try await GameService.shared.checkUsername(candidate)
                guard !Task.isCancelled else { return }
                availability = result.available ? .available : .unavailable(result.reason ?? "Not available")
            } catch {
                guard !Task.isCancelled else { return }
                availability = .unavailable(AppError.from(error).errorDescription ?? "Couldn't check")
            }
        }
    }

    private func save() {
        busy = true
        Task {
            defer { busy = false }
            do {
                _ = try await GameService.shared.setUsername(username.trimmingCharacters(in: .whitespaces))
                // SessionStore's profile listener flips the app to the main screen.
            } catch {
                Feedback.error()
                self.error = AppError.from(error)
            }
        }
    }
}
