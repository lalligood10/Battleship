import Combine
import Foundation

@MainActor
final class PlacementViewModel: ObservableObject {
    @Published var fleet: [ShipPlacement] = PlacementValidator.defaultFleet()
    @Published var selected: ShipType? = nil
    @Published var submitting = false

    // Drag bookkeeping
    private var dragging: ShipType?
    private var dragOffset = Coordinate(row: 0, col: 0)
    private var dragStartCell: Coordinate?
    private var dragMoved = false
    private var tappedShipWasSelected = false

    func problem(for type: ShipType) -> PlacementProblem? {
        guard let ship = fleet.first(where: { $0.type == type }) else { return nil }
        return PlacementValidator.problem(for: ship, among: fleet)
    }

    var isValid: Bool { PlacementValidator.isComplete(fleet) }

    func mark(at c: Coordinate) -> CellMark {
        guard let ship = ship(at: c) else { return .water }
        return problem(for: ship.type) == nil ? .ship : .shipInvalid
    }

    func ship(at c: Coordinate) -> ShipPlacement? {
        fleet.first { Board.cells(of: $0).contains(c) }
    }

    var selectedCells: Set<Coordinate> {
        guard let selected, let ship = fleet.first(where: { $0.type == selected }) else { return [] }
        return Set(Board.cells(of: ship))
    }

    // MARK: Gestures

    func dragChanged(cell: Coordinate?) {
        guard let cell else { return }
        if dragStartCell == nil {
            dragStartCell = cell
            dragMoved = false
            if let ship = ship(at: cell) {
                dragging = ship.type
                dragOffset = Coordinate(row: cell.row - ship.row, col: cell.col - ship.col)
                tappedShipWasSelected = (selected == ship.type)
                selected = ship.type
            }
            return
        }
        guard let dragging, let index = fleet.firstIndex(where: { $0.type == dragging }) else { return }
        if cell != dragStartCell { dragMoved = true }
        var ship = fleet[index]
        ship.row = cell.row - dragOffset.row
        ship.col = cell.col - dragOffset.col
        fleet[index] = Self.clampedToBoard(ship)
    }

    func dragEnded() {
        let start = dragStartCell
        let moved = dragMoved
        let wasSelected = tappedShipWasSelected
        dragging = nil
        dragStartCell = nil
        dragMoved = false
        tappedShipWasSelected = false

        // A press without movement is a tap: select the ship, or rotate it if it was already selected.
        guard !moved, let start else { return }
        guard let ship = ship(at: start) else {
            selected = nil
            return
        }
        if wasSelected {
            rotate(ship.type)
        } else {
            selected = ship.type
        }
    }

    func rotateSelected() {
        guard let selected else { return }
        rotate(selected)
    }

    func rotate(_ type: ShipType) {
        guard let index = fleet.firstIndex(where: { $0.type == type }) else { return }
        var ship = fleet[index]
        ship.horizontal.toggle()
        fleet[index] = Self.clampedToBoard(ship)
    }

    func shuffle() {
        fleet = PlacementValidator.randomFleet()
        selected = nil
    }

    func reset() {
        fleet = PlacementValidator.defaultFleet()
        selected = nil
    }

    static func clampedToBoard(_ ship: ShipPlacement) -> ShipPlacement {
        var s = ship
        let len = s.type.length
        if s.horizontal {
            s.col = min(max(0, s.col), Board.size - len)
            s.row = min(max(0, s.row), Board.size - 1)
        } else {
            s.row = min(max(0, s.row), Board.size - len)
            s.col = min(max(0, s.col), Board.size - 1)
        }
        return s
    }
}
