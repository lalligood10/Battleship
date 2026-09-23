import FirebaseFirestore
import SwiftUI

enum LeaderboardTab: String, CaseIterable, Identifiable {
    case global = "Global", weekly = "Weekly", friends = "Friends"
    var id: String { rawValue }
}

@MainActor
final class LeaderboardsViewModel: ObservableObject {
    @Published var tab: LeaderboardTab = .global
    @Published private(set) var entries: [LeaderboardTab: [LeaderboardEntry]] = [:]
    @Published private(set) var loading = false
    @Published var error: AppError?

    private let db = Firestore.firestore()
    private static let pageSize = 100

    func load(uid: String, force: Bool = false) async {
        if !force, entries[tab] != nil { return }
        loading = true
        defer { loading = false }
        do {
            switch tab {
            case .global: entries[.global] = try await loadGlobal()
            case .weekly: entries[.weekly] = try await loadWeekly()
            case .friends: entries[.friends] = try await loadFriends(uid: uid)
            }
        } catch {
            self.error = AppError.from(error)
        }
    }

    private func loadGlobal() async throws -> [LeaderboardEntry] {
        let snap = try await db.collection("users")
            .order(by: "rating", descending: true)
            .order(by: "stats.wins", descending: true)
            .limit(to: Self.pageSize)
            .getDocuments()
        let profiles = snap.documents.compactMap { try? UserProfile.from($0) }
        return profiles.enumerated().map { i, p in
            LeaderboardEntry(id: p.id, rank: i + 1, username: p.username, primary: p.rating,
                             secondary: "\(p.stats.wins)W · \(p.stats.losses)L")
        }
    }

    private func loadWeekly() async throws -> [LeaderboardEntry] {
        let snap = try await db.collection("weeklyWins/\(WeekId.current())/players")
            .order(by: "wins", descending: true)
            .order(by: "rating", descending: true)
            .limit(to: Self.pageSize)
            .getDocuments()
        let rows = snap.documents.compactMap { try? WeeklyWins.from($0) }
        return rows.enumerated().map { i, w in
            LeaderboardEntry(id: w.id, rank: i + 1, username: w.username, primary: w.wins,
                             secondary: "\(w.rating) rating")
        }
    }

    /// Friends = everyone I've played, plus me, ranked by current rating.
    private func loadFriends(uid: String) async throws -> [LeaderboardEntry] {
        let opponents = try await db.collection("users/\(uid)/opponents")
            .order(by: "lastPlayedAt", descending: true)
            .limit(to: 50)
            .getDocuments()
        let ids = [uid] + opponents.documents.map(\.documentID)
        // Fetch fresh profiles so ratings are current (opponent docs only cache the username).
        var profiles: [UserProfile] = []
        for chunk in ids.chunked(into: 10) {
            let snap = try await db.collection("users")
                .whereField(FieldPath.documentID(), in: chunk)
                .getDocuments()
            profiles += snap.documents.compactMap { try? UserProfile.from($0) }
        }
        profiles.sort { ($0.rating, $0.stats.wins) > ($1.rating, $1.stats.wins) }
        return profiles.enumerated().map { i, p in
            LeaderboardEntry(id: p.id, rank: i + 1, username: p.username, primary: p.rating,
                             secondary: "\(p.stats.wins)W · \(p.stats.losses)L")
        }
    }
}

struct LeaderboardsView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = LeaderboardsViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Board", selection: $vm.tab) {
                    ForEach(LeaderboardTab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding()

                content
            }
            .background(Theme.background)
            .navigationTitle("Leaderboards")
            .task(id: vm.tab) { if let uid = session.uid { await vm.load(uid: uid) } }
            .refreshable { if let uid = session.uid { await vm.load(uid: uid, force: true) } }
            .appErrorAlert($vm.error)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let rows = vm.entries[vm.tab] {
            if rows.isEmpty {
                EmptyStateView(
                    systemImage: vm.tab == .friends ? "person.2" : "trophy",
                    title: vm.tab == .friends ? "No rivals yet" : "Nobody here yet",
                    message: vm.tab == .friends
                        ? "Play a game against a friend and they'll show up here."
                        : (vm.tab == .weekly ? "Win a game this week to claim the top spot." : "Finish a game to appear on the board.")
                )
            } else {
                List(rows) { row in
                    LeaderboardRow(entry: row, isMe: row.id == session.uid, unit: vm.tab == .weekly ? "wins" : "")
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        } else {
            LoadingView()
        }
    }
}

struct LeaderboardRow: View {
    let entry: LeaderboardEntry
    let isMe: Bool
    let unit: String

    var body: some View {
        HStack(spacing: 14) {
            Text("\(entry.rank)")
                .font(.headline.monospacedDigit())
                .frame(width: 32, alignment: .trailing)
                .foregroundStyle(medal)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.username).font(.body.weight(isMe ? .bold : .regular))
                Text(entry.secondary).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(unit.isEmpty ? "\(entry.primary)" : "\(entry.primary) \(unit)")
                .font(.headline.monospacedDigit())
        }
        .padding(.vertical, 4)
        .listRowBackground(isMe ? Theme.accent.opacity(0.12) : Color.clear)
    }

    private var medal: Color {
        switch entry.rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return .orange
        default: return .secondary
        }
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
