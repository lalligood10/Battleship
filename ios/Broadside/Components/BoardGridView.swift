import SwiftUI

/// A 10x10 grid with A–J / 1–10 labels. Layout is a fixed cell size so callers can map touch locations
/// back to coordinates (needed for drag-and-drop placement).
struct BoardGridView: View {
    let cellSize: CGFloat
    let mark: (Coordinate) -> CellMark
    var highlighted: Set<Coordinate> = []
    var onTap: ((Coordinate) -> Void)? = nil

    private let labelFont = Font.caption2.weight(.semibold)

    var body: some View {
        VStack(spacing: 0) {
            // Column labels
            HStack(spacing: 0) {
                Color.clear.frame(width: cellSize, height: cellSize * 0.7)
                ForEach(0..<Board.size, id: \.self) { col in
                    Text(Board.columnLabels[col]).font(labelFont).foregroundStyle(.secondary)
                        .frame(width: cellSize, height: cellSize * 0.7)
                }
            }
            ForEach(0..<Board.size, id: \.self) { row in
                HStack(spacing: 0) {
                    Text(Board.rowLabels[row]).font(labelFont).foregroundStyle(.secondary)
                        .frame(width: cellSize, height: cellSize)
                    ForEach(0..<Board.size, id: \.self) { col in
                        let c = Coordinate(row: row, col: col)
                        cell(c)
                    }
                }
            }
        }
        .padding(4)
        .background(Theme.sea, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// Tap gestures are only attached when requested so a parent drag gesture (placement) isn't intercepted.
    @ViewBuilder
    private func cell(_ c: Coordinate) -> some View {
        let view = CellView(mark: mark(c), size: cellSize, highlighted: highlighted.contains(c))
        if let onTap {
            view.onTapGesture { onTap(c) }
        } else {
            view
        }
    }

    /// Converts a touch location within this view (excluding the outer 4pt padding) to a board coordinate.
    func coordinate(at point: CGPoint) -> Coordinate? {
        let x = point.x - 4 - cellSize
        let y = point.y - 4 - cellSize * 0.7
        guard x >= 0, y >= 0 else { return nil }
        let c = Coordinate(row: Int(y / cellSize), col: Int(x / cellSize))
        return Board.isOnBoard(c) ? c : nil
    }

    static func cellSize(fitting width: CGFloat) -> CGFloat {
        floor((width - 8) / CGFloat(Board.size + 1))
    }
}

struct CellView: View {
    let mark: CellMark
    let size: CGFloat
    var highlighted = false

    var body: some View {
        ZStack {
            Rectangle()
                .fill(fill)
                .overlay(Rectangle().strokeBorder(Theme.seaGrid.opacity(0.6), lineWidth: 0.5))
            symbol
        }
        .frame(width: size, height: size)
        .overlay {
            if highlighted {
                Rectangle().strokeBorder(Theme.accent, lineWidth: 2)
            }
        }
        .animation(.easeOut(duration: 0.2), value: mark)
    }

    private var fill: Color {
        switch mark {
        case .water: return .clear
        case .ship: return Theme.ship
        case .shipInvalid: return Theme.shipInvalid
        case .revealedShip: return Theme.ship.opacity(0.45)
        case .miss: return .clear
        case .hit: return Theme.ship
        case .sunk: return Theme.sunk.opacity(0.85)
        }
    }

    @ViewBuilder
    private var symbol: some View {
        switch mark {
        case .miss:
            Circle().fill(Theme.miss).frame(width: size * 0.3, height: size * 0.3).shadow(radius: 1)
        case .hit:
            Image(systemName: "flame.fill").font(.system(size: size * 0.55)).foregroundStyle(Theme.hit)
        case .sunk:
            Image(systemName: "xmark").font(.system(size: size * 0.55, weight: .bold)).foregroundStyle(.white)
        default:
            EmptyView()
        }
    }
}
