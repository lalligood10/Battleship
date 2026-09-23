import AudioToolbox
import UIKit

/// Haptic + sound feedback for shots. Uses system sounds so no audio assets need to ship.
enum Feedback {
    static func shot(_ result: ShotResult) {
        switch result {
        case .miss:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            AudioServicesPlaySystemSound(1104) // subtle "tock"
        case .hit:
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            AudioServicesPlaySystemSound(1057)
        case .sunk:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            AudioServicesPlaySystemSound(1025)
        }
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    static func tap() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
