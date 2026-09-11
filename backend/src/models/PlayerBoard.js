'use strict';

const { WALL_PATTERN, FLOOR_PENALTIES } = require('./Tile');

const MARKER = { type: 'marker' };

class PlayerBoard {
  constructor(playerId, name) {
    this.playerId = playerId;
    this.name = name;
    this.score = 0;

    // 5 pattern lines, line i has capacity i+1. Each holds tiles of a single color.
    this.patternLines = [[], [], [], [], []];

    // 5x5 wall: null (empty) or a color string.
    this.wall = Array.from({ length: 5 }, () => Array(5).fill(null));

    // Floor line holds up to 7 tokens: { type: 'tile', color } or { type: 'marker' }.
    this.floorLine = [];
  }

  /** Whether the wall row already contains this color. */
  wallRowHasColor(row, color) {
    return this.wall[row].includes(color);
  }

  /** The wall column index that `color` belongs to on the given row. */
  wallColumnFor(row, color) {
    return WALL_PATTERN[row].indexOf(color);
  }

  /** Can this pattern line accept this color right now? */
  canAddToLine(lineIndex, color) {
    const line = this.patternLines[lineIndex];
    const capacity = lineIndex + 1;
    if (line.length >= capacity) return false;
    if (line.length > 0 && line[0] !== color) return false;
    if (this.wallRowHasColor(lineIndex, color)) return false;
    return true;
  }

  isLineComplete(lineIndex) {
    return this.patternLines[lineIndex].length === lineIndex + 1;
  }

  floorSpaceRemaining() {
    return Math.max(0, FLOOR_PENALTIES.length - this.floorLine.length);
  }

  /**
   * Add `count` tiles of `color` to pattern line `lineIndex`.
   * Returns the number of tiles that overflowed to the floor line.
   */
  addTilesToLine(lineIndex, color, count) {
    let remaining = count;
    const line = this.patternLines[lineIndex];
    const capacity = lineIndex + 1;
    while (remaining > 0 && line.length < capacity) {
      line.push(color);
      remaining -= 1;
    }
    if (remaining > 0) {
      this.addTilesToFloor(color, remaining);
    }
    return remaining;
  }

  /** Add plain tiles directly to the floor line (overflow beyond 7 is discarded, returned). */
  addTilesToFloor(color, count) {
    const discarded = [];
    for (let i = 0; i < count; i += 1) {
      if (this.floorLine.length < FLOOR_PENALTIES.length) {
        this.floorLine.push({ type: 'tile', color });
      } else {
        discarded.push(color);
      }
    }
    return discarded;
  }

  /** Places the starting-player marker onto the floor line (does not count as a color tile). */
  addStartingMarkerToFloor() {
    if (this.floorLine.length < FLOOR_PENALTIES.length) {
      this.floorLine.push({ ...MARKER });
      return true;
    }
    return false;
  }

  /**
   * Scores placing a tile at (row, col) on the wall using the standard
   * horizontal/vertical adjacency rule.
   */
  static scoreWallPlacement(wall, row, col) {
    let horizontal = 1;
    for (let c = col - 1; c >= 0 && wall[row][c]; c -= 1) horizontal += 1;
    for (let c = col + 1; c < 5 && wall[row][c]; c += 1) horizontal += 1;

    let vertical = 1;
    for (let r = row - 1; r >= 0 && wall[r][col]; r -= 1) vertical += 1;
    for (let r = row + 1; r < 5 && wall[r][col]; r += 1) vertical += 1;

    if (horizontal === 1 && vertical === 1) return 1;
    return (horizontal > 1 ? horizontal : 0) + (vertical > 1 ? vertical : 0);
  }

  /**
   * Runs the Wall-tiling phase for this board: moves the rightmost tile of
   * every complete pattern line to the wall, scores it, and clears lines
   * that no longer have a rightmost tile. Returns discarded tile colors
   * (to go to the lid) and per-line score deltas for logging/animation.
   */
  runWallTiling() {
    const discardedToLid = [];
    const events = [];

    for (let row = 0; row < 5; row += 1) {
      if (!this.isLineComplete(row)) continue;
      const color = this.patternLines[row][0];
      const col = this.wallColumnFor(row, color);
      this.wall[row][col] = color;
      const points = PlayerBoard.scoreWallPlacement(this.wall, row, col);
      this.score += points;
      events.push({ row, col, color, points });

      // Discard the rest of the pattern line's tiles (capacity - 1 of them) to the lid.
      const capacity = row + 1;
      for (let i = 0; i < capacity - 1; i += 1) discardedToLid.push(color);
      this.patternLines[row] = [];
    }

    return { discardedToLid, events };
  }

  /** Applies floor-line penalties, clears the floor, returns whether marker was present. */
  applyFloorPenaltyAndClear() {
    let penalty = 0;
    let hadMarker = false;
    const discardedColors = [];
    this.floorLine.forEach((token, i) => {
      const p = FLOOR_PENALTIES[i] || FLOOR_PENALTIES[FLOOR_PENALTIES.length - 1];
      penalty += p;
      if (token.type === 'marker') hadMarker = true;
      else discardedColors.push(token.color);
    });
    this.score = Math.max(0, this.score + penalty);
    this.floorLine = [];
    return { penalty, hadMarker, discardedColors };
  }

  hasCompletedHorizontalLine() {
    return this.wall.some((row) => row.every((cell) => cell !== null));
  }

  countCompleteHorizontalLines() {
    return this.wall.filter((row) => row.every((cell) => cell !== null)).length;
  }

  countCompleteVerticalLines() {
    let count = 0;
    for (let col = 0; col < 5; col += 1) {
      let complete = true;
      for (let row = 0; row < 5; row += 1) {
        if (!this.wall[row][col]) { complete = false; break; }
      }
      if (complete) count += 1;
    }
    return count;
  }

  countFullColorSets() {
    const { COLORS } = require('./Tile');
    let count = 0;
    for (const color of COLORS) {
      let total = 0;
      for (let row = 0; row < 5; row += 1) {
        if (this.wall[row].includes(color)) total += 1;
      }
      if (total === 5) count += 1;
    }
    return count;
  }

  applyEndGameBonuses() {
    const horizontal = this.countCompleteHorizontalLines() * 2;
    const vertical = this.countCompleteVerticalLines() * 7;
    const colorSets = this.countFullColorSets() * 10;
    this.score += horizontal + vertical + colorSets;
    return { horizontal, vertical, colorSets };
  }

  toJSON() {
    return {
      playerId: this.playerId,
      name: this.name,
      score: this.score,
      patternLines: this.patternLines,
      wall: this.wall,
      floorLine: this.floorLine,
    };
  }
}

module.exports = PlayerBoard;
