import XCTest
@testable import Broadside

final class BoardTests: XCTestCase {
    func testLabelsUseLettersForColumnsAndNumbersForRows() {
        XCTAssertEqual(Board.label(Coordinate(row: 0, col: 0)), "A1")
        XCTAssertEqual(Board.label(Coordinate(row: 9, col: 9)), "J10")
        XCTAssertEqual(Board.label(Coordinate(row: 2, col: 1)), "B3")
        XCTAssertEqual(Board.label(Coordinate(row: 10, col: 0)), "?")
    }

    func testCellsOfHorizontalAndVerticalShips() {
        let h = ShipPlacement(type: .cruiser, row: 4, col: 2, horizontal: true)
        XCTAssertEqual(Board.cells(of: h), [Coordinate(row: 4, col: 2), Coordinate(row: 4, col: 3), Coordinate(row: 4, col: 4)])
        let v = ShipPlacement(type: .destroyer, row: 8, col: 9, horizontal: false)
        XCTAssertEqual(Board.cells(of: v), [Coordinate(row: 8, col: 9), Coordinate(row: 9, col: 9)])
    }

    func testIsOnBoard() {
        XCTAssertTrue(Board.isOnBoard(Coordinate(row: 0, col: 0)))
        XCTAssertTrue(Board.isOnBoard(Coordinate(row: 9, col: 9)))
        XCTAssertFalse(Board.isOnBoard(Coordinate(row: -1, col: 0)))
        XCTAssertFalse(Board.isOnBoard(Coordinate(row: 0, col: 10)))
    }
}

final class PlacementValidatorTests: XCTestCase {
    func testShipOffBoardIsRejected() {
        let ship = ShipPlacement(type: .carrier, row: 0, col: 6, horizontal: true) // cols 6..10
        XCTAssertEqual(PlacementValidator.problem(for: ship, among: []), .offBoard)
        let vertical = ShipPlacement(type: .battleship, row: 7, col: 0, horizontal: false) // rows 7..10
        XCTAssertEqual(PlacementValidator.problem(for: vertical, among: []), .offBoard)
    }

    func testOverlapIsRejected() {
        let carrier = ShipPlacement(type: .carrier, row: 0, col: 0, horizontal: true)
        let sub = ShipPlacement(type: .submarine, row: 0, col: 2, horizontal: false)
        XCTAssertEqual(PlacementValidator.problem(for: sub, among: [carrier]), .overlaps(.carrier))
    }

    func testTouchingIsAllowedByDefault() {
        XCTAssertTrue(Board.allowTouchingShips)
        let carrier = ShipPlacement(type: .carrier, row: 0, col: 0, horizontal: true)
        let sub = ShipPlacement(type: .submarine, row: 1, col: 0, horizontal: true)
        XCTAssertNil(PlacementValidator.problem(for: sub, among: [carrier]))
    }

    func testCandidateIgnoresItsOwnPreviousPosition() {
        let fleet = PlacementValidator.defaultFleet()
        let moved = ShipPlacement(type: .carrier, row: 0, col: 3, horizontal: true)
        XCTAssertNil(PlacementValidator.problem(for: moved, among: fleet))
    }

    func testDefaultFleetIsComplete() {
        XCTAssertTrue(PlacementValidator.isComplete(PlacementValidator.defaultFleet()))
    }

    func testIncompleteOrDuplicateFleetIsRejected() {
        var fleet = PlacementValidator.defaultFleet()
        fleet.removeLast()
        XCTAssertFalse(PlacementValidator.isComplete(fleet))
        fleet.append(fleet[0])
        XCTAssertFalse(PlacementValidator.isComplete(fleet))
    }

    func testRandomFleetIsAlwaysLegal() {
        for _ in 0..<200 {
            let fleet = PlacementValidator.randomFleet()
            XCTAssertTrue(PlacementValidator.isComplete(fleet))
            XCTAssertEqual(Set(fleet.flatMap { Board.cells(of: $0) }).count, 17)
        }
    }

    func testRandomFleetIsDeterministicForSeed() {
        struct SeededGenerator: RandomNumberGenerator {
            var state: UInt64
            mutating func next() -> UInt64 {
                state = state &* 6364136223846793005 &+ 1442695040888963407
                return state
            }
        }
        var a = SeededGenerator(state: 42)
        var b = SeededGenerator(state: 42)
        XCTAssertEqual(PlacementValidator.randomFleet(using: &a), PlacementValidator.randomFleet(using: &b))
    }
}

@MainActor
final class PlacementViewModelTests: XCTestCase {
    func testClampKeepsShipOnBoard() {
        let tooFarRight = ShipPlacement(type: .carrier, row: 3, col: 9, horizontal: true)
        XCTAssertEqual(PlacementViewModel.clampedToBoard(tooFarRight).col, 5)
        let tooLow = ShipPlacement(type: .battleship, row: 9, col: 0, horizontal: false)
        XCTAssertEqual(PlacementViewModel.clampedToBoard(tooLow).row, 6)
        let negative = ShipPlacement(type: .destroyer, row: -2, col: -1, horizontal: true)
        let clamped = PlacementViewModel.clampedToBoard(negative)
        XCTAssertEqual(clamped.row, 0)
        XCTAssertEqual(clamped.col, 0)
    }

    func testDragMovesShipPreservingGrabOffset() {
        let vm = PlacementViewModel()
        // Default carrier is at row 0, cols 0..4. Grab its 3rd cell and drag to F6 (row 5, col 5).
        vm.dragChanged(cell: Coordinate(row: 0, col: 2))
        vm.dragChanged(cell: Coordinate(row: 5, col: 5))
        vm.dragEnded()
        let carrier = vm.fleet.first { $0.type == .carrier }!
        XCTAssertEqual(carrier.row, 5)
        XCTAssertEqual(carrier.col, 3)
        XCTAssertEqual(vm.selected, .carrier)
    }

    func testTapSelectsThenSecondTapRotates() {
        let vm = PlacementViewModel()
        vm.dragChanged(cell: Coordinate(row: 2, col: 0)) // battleship
        vm.dragEnded()
        XCTAssertEqual(vm.selected, .battleship)
        XCTAssertTrue(vm.fleet.first { $0.type == .battleship }!.horizontal)

        vm.dragChanged(cell: Coordinate(row: 2, col: 0))
        vm.dragEnded()
        XCTAssertFalse(vm.fleet.first { $0.type == .battleship }!.horizontal)
    }

    func testRotationNearEdgeIsClampedBackOnBoard() {
        let vm = PlacementViewModel()
        vm.fleet = [ShipPlacement(type: .carrier, row: 8, col: 0, horizontal: true)]
        vm.rotate(.carrier)
        let carrier = vm.fleet[0]
        XCTAssertFalse(carrier.horizontal)
        XCTAssertEqual(carrier.row, 5)
        XCTAssertNil(PlacementValidator.problem(for: carrier, among: []))
    }

    func testInvalidOverlapIsReportedAndBlocksSubmit() {
        let vm = PlacementViewModel()
        vm.dragChanged(cell: Coordinate(row: 2, col: 0)) // battleship
        vm.dragChanged(cell: Coordinate(row: 0, col: 0)) // onto the carrier
        vm.dragEnded()
        XCTAssertEqual(vm.problem(for: .battleship), .overlaps(.carrier))
        XCTAssertFalse(vm.isValid)
        XCTAssertEqual(vm.mark(at: Coordinate(row: 0, col: 0)), .shipInvalid)
    }
}

final class WeekIdTests: XCTestCase {
    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    func testMatchesServerFormat() {
        XCTAssertEqual(WeekId.current(date("2026-09-23T12:00:00Z")), "2026-W39")
        // Sunday still belongs to the week that started the previous Monday.
        XCTAssertEqual(WeekId.current(date("2026-09-27T23:59:59Z")), "2026-W39")
        XCTAssertEqual(WeekId.current(date("2026-09-28T00:00:00Z")), "2026-W40")
        // Jan 1 2027 is a Friday -> ISO week 53 of 2026.
        XCTAssertEqual(WeekId.current(date("2027-01-01T00:00:00Z")), "2026-W53")
    }
}
