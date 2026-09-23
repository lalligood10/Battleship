import Foundation

/// Mirrors `weekId()` in functions/src/game/scoring.ts – ISO week, Monday start, UTC.
enum WeekId {
    static func current(_ date: Date = Date()) -> String {
        var cal = Calendar(identifier: .iso8601)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let comps = cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        return String(format: "%04d-W%02d", comps.yearForWeekOfYear ?? 0, comps.weekOfYear ?? 0)
    }
}
