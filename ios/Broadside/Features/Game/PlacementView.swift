import SwiftUI

struct PlacementView: View {
    @ObservedObject var store: GameStore
    @StateObject private var vm = PlacementViewModel()
    @State private var error: AppError?

    var body: some View {
        VStack(spacing: 16) {
            Text("Drag ships into position. Tap a ship to select it, tap again (or use Rotate) to turn it.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .padding(.horizontal)

            GeometryReader { geo in
                let size = BoardGridView.cellSize(fitting: geo.size.width)
                let grid = BoardGridView(cellSize: size, mark: vm.mark(at:), highlighted: vm.selectedCells)
                grid
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .local)
                            .onChanged { value in vm.dragChanged(cell: grid.coordinate(at: value.location)) }
                            .onEnded { _ in vm.dragEnded() }
                    )
                    .frame(maxWidth: .infinity)
            }
            .aspectRatio(CGFloat(Board.size + 1) / CGFloat(Board.size + 0.7), contentMode: .fit)
            .padding(.horizontal)

            fleetLegend

            HStack(spacing: 12) {
                Button { vm.rotateSelected(); Feedback.tap() } label: { Label("Rotate", systemImage: "rotate.right") }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(vm.selected == nil)
                Button { vm.shuffle(); Feedback.tap() } label: { Label("Shuffle", systemImage: "shuffle") }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(.horizontal)

            Button {
                submit()
            } label: {
                if vm.submitting { ProgressView().tint(.white) } else { Text("Confirm fleet") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!vm.isValid || vm.submitting)
            .padding(.horizontal)

            Spacer(minLength: 0)
        }
        .padding(.vertical)
        .navigationTitle("Place your fleet")
        .navigationBarTitleDisplayMode(.inline)
        .appErrorAlert($error)
        .onChange(of: vm.selected) { _ in Feedback.tap() }
    }

    private func submit() {
        guard vm.isValid else { return }
        vm.submitting = true
        Task {
            defer { vm.submitting = false }
            do {
                _ = try await GameService.shared.placeShips(gameId: store.gameId, fleet: vm.fleet)
                // GameStore's listener moves us to the next phase.
            } catch {
                Feedback.error()
                self.error = AppError.from(error)
            }
        }
    }

    private var fleetLegend: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(ShipType.allCases) { type in
                let problem = vm.problem(for: type)
                HStack {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(problem == nil ? Theme.ship : Theme.shipInvalid)
                        .frame(width: CGFloat(type.length) * 14, height: 10)
                    Text(type.displayName).font(.subheadline)
                    Text("(\(type.length))").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if let problem {
                        Text(problem.message).font(.caption).foregroundStyle(.red)
                    } else if vm.selected == type {
                        Text("Selected").font(.caption).foregroundStyle(Theme.accent)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { vm.selected = type }
            }
        }
        .padding(.horizontal, 20)
    }
}
