import SwiftUI

struct JoinGameView: View {
    var initialCode: String?
    let onJoined: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var busy = false
    @State private var error: AppError?
    @FocusState private var focused: Bool

    private var cleaned: String {
        code.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("Enter the 6-character code your friend sent you.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                TextField("ABC234", text: $code)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding()
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onChange(of: code) { newValue in
                        let c = newValue.uppercased().filter { $0.isLetter || $0.isNumber }
                        if c != newValue { code = String(c.prefix(6)) } else if c.count > 6 { code = String(c.prefix(6)) }
                    }

                Button {
                    join()
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text("Join Game") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || cleaned.count != 6)

                Spacer()
            }
            .padding(24)
            .background(Theme.background)
            .navigationTitle("Join Game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                if let initialCode { code = initialCode }
                focused = true
            }
            .appErrorAlert($error)
        }
    }

    private func join() {
        busy = true
        Task {
            defer { busy = false }
            do {
                let result = try await GameService.shared.joinGame(code: cleaned)
                dismiss()
                onJoined(result.gameId)
            } catch {
                Feedback.error()
                self.error = AppError.from(error)
            }
        }
    }
}
