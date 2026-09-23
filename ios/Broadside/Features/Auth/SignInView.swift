import AuthenticationServices
import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthService
    @Environment(\.colorScheme) private var colorScheme

    @State private var showEmail = false
    @State private var busy = false
    @State private var error: AppError?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "sailboat.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(Theme.accent)
                    Text("Broadside").font(.system(size: 40, weight: .heavy, design: .rounded))
                    Text("Sink your friends' fleets, one shot at a time.")
                        .foregroundStyle(.secondary)
                }
                Spacer()

                VStack(spacing: 12) {
                    SignInWithAppleButton(.signIn) { request in
                        auth.prepareAppleRequest(request)
                    } onCompletion: { result in
                        handleApple(result)
                    }
                    .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                    .frame(height: 50)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    Button {
                        showEmail = true
                    } label: {
                        Label("Continue with Email", systemImage: "envelope.fill")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .disabled(busy)
                .overlay { if busy { ProgressView() } }

                Text("By continuing you agree to play fair. Ratings are public.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(24)
            .background(Theme.background)
            .sheet(isPresented: $showEmail) { EmailSignInView() }
            .appErrorAlert($error)
        }
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            busy = true
            Task {
                defer { busy = false }
                do {
                    try await auth.completeAppleSignIn(authorization)
                } catch {
                    self.error = AppError.from(error)
                }
            }
        case .failure(let err):
            // User cancelled is not an error worth showing.
            if (err as? ASAuthorizationError)?.code == .canceled { return }
            error = AppError.from(err)
        }
    }
}

struct EmailSignInView: View {
    @EnvironmentObject private var auth: AuthService
    @Environment(\.dismiss) private var dismiss

    enum Mode: String, CaseIterable { case signIn = "Sign In", create = "Create Account" }

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: AppError?
    @State private var info: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)

                Section {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(mode == .create ? .newPassword : .password)
                } footer: {
                    if mode == .create { Text("At least 6 characters.") }
                }

                Section {
                    Button {
                        submit()
                    } label: {
                        HStack {
                            Spacer()
                            if busy { ProgressView() } else { Text(mode.rawValue).bold() }
                            Spacer()
                        }
                    }
                    .disabled(busy || email.isEmpty || password.count < 6)

                    if mode == .signIn {
                        Button("Forgot password?") { resetPassword() }
                            .disabled(busy || email.isEmpty)
                    }
                }

                if let info {
                    Section { Text(info).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .appErrorAlert($error)
        }
    }

    private func submit() {
        busy = true
        Task {
            defer { busy = false }
            do {
                switch mode {
                case .signIn: try await auth.signIn(email: email, password: password)
                case .create: try await auth.createAccount(email: email, password: password)
                }
                dismiss()
            } catch {
                Feedback.error()
                self.error = AppError.from(error)
            }
        }
    }

    private func resetPassword() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await auth.sendPasswordReset(email: email)
                info = "Password reset email sent to \(email)."
            } catch {
                self.error = AppError.from(error)
            }
        }
    }
}
