'use strict';

/**
 * The 5 Azul tile colors and helpers around them.
 * "cyan" stands in for the light-blue/teal patterned tile.
 */
const COLORS = ['blue', 'yellow', 'red', 'black', 'cyan'];

const TILES_PER_COLOR = 20;

/**
 * Fixed wall pattern used on the standard (colored) side of the player board.
 * wallPattern[row][col] => color that belongs in that wall cell.
 */
const WALL_PATTERN = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 5 }, (_, col) => COLORS[(col - row + COLORS.length) % COLORS.length])
);

/** Points lost per tile occupying each floor-line space (index 0..6). */
const FLOOR_PENALTIES = [-1, -1, -2, -2, -2, -3, -3];

function createFullBag() {
  const bag = [];
  for (const color of COLORS) {
    for (let i = 0; i < TILES_PER_COLOR; i += 1) {
      bag.push(color);
    }
  }
  return bag;
}

module.exports = {
  COLORS,
  TILES_PER_COLOR,
  WALL_PATTERN,
  FLOOR_PENALTIES,
  createFullBag,
};
