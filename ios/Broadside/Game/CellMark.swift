import Foundation

/// What to draw in one cell of a grid.
enum CellMark: Equatable {
    case water
    case ship
    case shipInvalid
    case miss
    case hit
    case sunk
    /// Revealed opponent ship cell that was never hit (results screen).
    case revealedShip
}
