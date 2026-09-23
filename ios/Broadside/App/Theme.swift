import SwiftUI

/// Ocean palette with automatic light/dark variants. Kept in code so no asset catalog is required.
enum Theme {
    static let accent = Color(light: UIColor(red: 0.05, green: 0.45, blue: 0.75, alpha: 1), dark: UIColor(red: 0.35, green: 0.7, blue: 1.0, alpha: 1))
    static let sea = Color(light: UIColor(red: 0.82, green: 0.91, blue: 0.97, alpha: 1), dark: UIColor(red: 0.07, green: 0.16, blue: 0.26, alpha: 1))
    static let seaGrid = Color(light: UIColor(red: 0.55, green: 0.72, blue: 0.88, alpha: 1), dark: UIColor(red: 0.2, green: 0.36, blue: 0.52, alpha: 1))
    static let ship = Color(light: UIColor(red: 0.35, green: 0.4, blue: 0.47, alpha: 1), dark: UIColor(red: 0.6, green: 0.65, blue: 0.72, alpha: 1))
    static let shipInvalid = Color(light: UIColor.systemRed.withAlphaComponent(0.75), dark: UIColor.systemRed.withAlphaComponent(0.75))
    static let hit = Color(light: UIColor.systemOrange, dark: UIColor.systemOrange)
    static let sunk = Color(light: UIColor.systemRed, dark: UIColor(red: 1, green: 0.3, blue: 0.3, alpha: 1))
    static let miss = Color(light: UIColor.white, dark: UIColor(white: 0.85, alpha: 1))
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let background = Color(uiColor: .systemGroupedBackground)
    static let win = Color.green
    static let loss = Color.red
}

extension Color {
    init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

// MARK: - Reusable modifiers

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding()
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

extension View {
    func card() -> some View { modifier(CardStyle()) }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.accent.opacity(configuration.isPressed ? 0.75 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foregroundStyle(.white)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.accent.opacity(0.4)))
            .foregroundStyle(Theme.accent)
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
