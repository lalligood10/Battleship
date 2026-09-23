import Foundation

struct PlayerStats: Codable, Hashable {
    var wins: Int = 0
    var losses: Int = 0
    var gamesPlayed: Int = 0
    var shotsFired: Int = 0
    var hits: Int = 0
    var currentStreak: Int = 0
    var longestStreak: Int = 0

    /// 0...1
    var winRate: Double { gamesPlayed == 0 ? 0 : Double(wins) / Double(gamesPlayed) }
    /// 0...1
    var accuracy: Double { shotsFired == 0 ? 0 : Double(hits) / Double(shotsFired) }
}

struct UserProfile: Codable, Identifiable, Hashable {
    var id: String = ""
    var username: String
    var usernameLower: String
    var rating: Int
    var stats: PlayerStats
    var createdAt: Date?
    var updatedAt: Date?
    var lastGameAt: Date?

    enum CodingKeys: String, CodingKey {
        case username, usernameLower, rating, stats, createdAt, updatedAt, lastGameAt
    }
}

struct WeeklyWins: Codable, Identifiable, Hashable {
    var id: String = ""
    var username: String
    var wins: Int
    var rating: Int
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case username, wins, rating, updatedAt
    }
}

struct Opponent: Codable, Identifiable, Hashable {
    var id: String = ""
    var username: String
    var gamesPlayed: Int
    var lastPlayedAt: Date?

    enum CodingKeys: String, CodingKey {
        case username, gamesPlayed, lastPlayedAt
    }
}

/// A single row on any leaderboard tab.
struct LeaderboardEntry: Identifiable, Hashable {
    var id: String
    var rank: Int
    var username: String
    var primary: Int
    var secondary: String
}
