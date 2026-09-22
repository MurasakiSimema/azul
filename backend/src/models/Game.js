'use strict';

const { v4: uuidv4 } = require('uuid');
const { createFullBag, COLORS } = require('./Tile');
const PlayerBoard = require('./PlayerBoard');

const FACTORY_COUNT_BY_PLAYERS = { 2: 5, 3: 7, 4: 9 };
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
    this.status = 400;
  }
}

class Game {
  constructor(id, hostName) {
    this.id = id;
    this.status = 'lobby'; // lobby | playing | finished
    this.players = []; // PlayerBoard[]
    this.playerOrder = []; // playerId[]
    this.hostId = null;

    this.bag = [];
    this.lid = [];
    this.factories = []; // array of color[] arrays
    this.center = []; // color[]
    this.centerMarkerAvailable = false;

    this.currentPlayerIndex = 0;
    this.startingPlayerIndexNextRound = 0;
    this.roundNumber = 0;

    /** Tiles a player just picked up and must now place: { color, count } */
    this.pendingSelection = null;

    this.winnerIds = [];
    this.log = [];
    this.chat = [];

    if (hostName) {
      this.addPlayer(hostName);
    }
  }

  // ---------- Chat ----------

  addChatMessage(playerId, message, isSystem = false) {
    if (!message || typeof message !== 'string') {
      throw new GameError('Message cannot be empty.');
    }
    const trimmed = message.trim();
    if (!trimmed) {
      throw new GameError('Message cannot be empty.');
    }
    if (trimmed.length > 300) {
      throw new GameError('Message too long (max 300 characters).');
    }

    let senderName = 'Sistema';
    if (!isSystem) {
      const player = this.players.find((p) => p.playerId === playerId);
      if (!player) {
        throw new GameError('Player not in game.');
      }
      senderName = player.name;
    }

    const chatEntry = {
      id: uuidv4(),
      playerId: isSystem ? 'system' : playerId,
      senderName,
      message: trimmed,
      timestamp: Date.now(),
      system: !!isSystem,
    };

    this.chat.push(chatEntry);
    if (this.chat.length > 100) {
      this.chat.shift();
    }
    return chatEntry;
  }

  // ---------- Lobby ----------

  addPlayer(name) {
    if (this.status !== 'lobby') throw new GameError('Game already started.');
    if (this.players.length >= MAX_PLAYERS) throw new GameError('Game is full.');
    const playerId = uuidv4();
    const board = new PlayerBoard(playerId, name || `Player ${this.players.length + 1}`);
    this.players.push(board);
    this.playerOrder.push(playerId);
    if (!this.hostId) this.hostId = playerId;
    this.addChatMessage(playerId, `${board.name} si è unito alla partita.`, true);
    return playerId;
  }

  removePlayer(playerId) {
    if (this.status !== 'lobby') return;
    this.players = this.players.filter((p) => p.playerId !== playerId);
    this.playerOrder = this.playerOrder.filter((id) => id !== playerId);
    if (this.hostId === playerId) this.hostId = this.playerOrder[0] || null;
  }

  start() {
    if (this.status !== 'lobby') throw new GameError('Game already started.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.status = 'playing';
    this.bag = shuffle(createFullBag());
    this.lid = [];
    this.currentPlayerIndex = Math.floor(Math.random() * this.players.length);
    this.startingPlayerIndexNextRound = this.currentPlayerIndex;
    this.roundNumber = 0;
    this.addChatMessage('system', 'La partita è iniziata!', true);
    this.startRound();
  }

  // ---------- Round / Factory offer ----------

  factoryCount() {
    return FACTORY_COUNT_BY_PLAYERS[this.players.length];
  }

  drawTiles(count) {
    const drawn = [];
    for (let i = 0; i < count; i += 1) {
      if (this.bag.length === 0) {
        if (this.lid.length === 0) break; // no tiles left anywhere
        this.bag = shuffle(this.lid.splice(0, this.lid.length));
      }
      drawn.push(this.bag.pop());
    }
    return drawn;
  }

  startRound() {
    this.roundNumber += 1;
    this.currentPlayerIndex = this.startingPlayerIndexNextRound;
    this.centerMarkerAvailable = true;
    this.center = [];
    this.pendingSelection = null;

    const count = this.factoryCount();
    this.factories = Array.from({ length: count }, () => this.drawTiles(4));
    this._addLog(`Round ${this.roundNumber} begins.`);
  }

  currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  getPlayer(playerId) {
    const player = this.players.find((p) => p.playerId === playerId);
    if (!player) throw new GameError('Player not found in this game.');
    return player;
  }

  _assertPlayersTurn(playerId) {
    if (this.status !== 'playing') throw new GameError('Game is not in progress.');
    const player = this.currentPlayer();
    if (!player || player.playerId !== playerId) throw new GameError("It is not this player's turn.");
    if (this.pendingSelection) {
      throw new GameError('You must place your picked tiles before picking new ones.');
    }
  }

  pickFromFactory(playerId, factoryIndex, color) {
    this._assertPlayersTurn(playerId);
    const factory = this.factories[factoryIndex];
    if (!factory) throw new GameError('Invalid factory display.');
    if (!COLORS.includes(color)) throw new GameError('Invalid color.');
    const matching = factory.filter((t) => t === color);
    if (matching.length === 0) throw new GameError('That color is not available on this factory display.');

    const remainder = factory.filter((t) => t !== color);
    this.center.push(...remainder);
    this.factories[factoryIndex] = [];

    this.pendingSelection = { color, count: matching.length };
    this._addLog(`${this.currentPlayer().name} took ${matching.length} ${color} tile(s) from a factory display.`);
    return this.pendingSelection;
  }

  pickFromCenter(playerId, color) {
    this._assertPlayersTurn(playerId);
    if (!COLORS.includes(color)) throw new GameError('Invalid color.');
    const matching = this.center.filter((t) => t === color);
    if (matching.length === 0) throw new GameError('That color is not available in the center.');

    this.center = this.center.filter((t) => t !== color);

    const player = this.currentPlayer();
    let tookMarker = false;
    if (this.centerMarkerAvailable) {
      this.centerMarkerAvailable = false;
      player.addStartingMarkerToFloor();
      this.startingPlayerIndexNextRound = this.currentPlayerIndex;
      tookMarker = true;
    }

    this.pendingSelection = { color, count: matching.length };
    this._addLog(
      `${player.name} took ${matching.length} ${color} tile(s) from the center.` +
        (tookMarker ? ' They also took the starting player marker.' : '')
    );
    return this.pendingSelection;
  }

  /** lineIndex 0-4 for a pattern line, or -1 to send everything straight to the floor line. */
  placeSelection(playerId, lineIndex) {
    if (this.status !== 'playing') throw new GameError('Game is not in progress.');
    const player = this.currentPlayer();
    if (!player || player.playerId !== playerId) throw new GameError("It is not this player's turn.");
    if (!this.pendingSelection) throw new GameError('No tiles picked up to place yet.');

    const { color, count } = this.pendingSelection;

    if (lineIndex === -1) {
      player.addTilesToFloor(color, count);
    } else {
      if (lineIndex < 0 || lineIndex > 4) throw new GameError('Invalid pattern line.');
      if (!player.canAddToLine(lineIndex, color)) {
        throw new GameError('Tiles of that color cannot be placed on that pattern line.');
      }
      player.addTilesToLine(lineIndex, color, count);
    }

    this.pendingSelection = null;
    this._addLog(`${player.name} placed tiles on ${lineIndex === -1 ? 'the floor line' : `pattern line ${lineIndex + 1}`}.`);

    if (this._isFactoryOfferOver()) {
      this._runWallTilingPhase();
      if (this._checkGameEnd()) {
        this._finishGame();
      } else {
        this.startRound();
      }
    } else {
      this._advanceTurn();
    }
  }

  _advanceTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
  }

  _isFactoryOfferOver() {
    const factoriesEmpty = this.factories.every((f) => f.length === 0);
    return factoriesEmpty && this.center.length === 0;
  }

  _runWallTilingPhase() {
    this._addLog('Wall-tiling phase.');
    // Process in turn order starting from the current starting player, purely for determinism.
    for (const player of this.players) {
      const { discardedToLid, events } = player.runWallTiling();
      this.lid.push(...discardedToLid);

      events.forEach(({ color, points }) => {
        this._addLog(`${player.name} scores ${points} point(s) placing a ${color} tile (total: ${player.score}).`);
      });

      const { penalty, discardedColors } = player.applyFloorPenaltyAndClear();
      this.lid.push(...discardedColors);
      if (penalty !== 0) {
        this._addLog(
          `${player.name} loses ${Math.abs(penalty)} point(s) from the floor line (total: ${player.score}).`
        );
      }
    }
  }

  _checkGameEnd() {
    return this.players.some((p) => p.hasCompletedHorizontalLine());
  }

  _finishGame() {
    this.status = 'finished';
    this.players.forEach((p) => {
      const { horizontal, vertical, colorSets } = p.applyEndGameBonuses();
      this._addLog(
        `${p.name} end-game bonuses: +${horizontal} (rows), +${vertical} (columns), ` +
          `+${colorSets} (color sets) — final score: ${p.score}.`
      );
    });

    let best = Math.max(...this.players.map((p) => p.score));
    let contenders = this.players.filter((p) => p.score === best);
    if (contenders.length > 1) {
      const bestLines = Math.max(...contenders.map((p) => p.countCompleteHorizontalLines()));
      contenders = contenders.filter((p) => p.countCompleteHorizontalLines() === bestLines);
    }
    this.winnerIds = contenders.map((p) => p.playerId);
    const winnersStr = this.players
      .filter((p) => this.winnerIds.includes(p.playerId))
      .map((p) => p.name)
      .join(', ');
    this._addLog(`Game over! Winner${this.winnerIds.length > 1 ? 's' : ''}: ${winnersStr}`);
    this.addChatMessage('system', `Partita conclusa! Vincitore${this.winnerIds.length > 1 ? 'i' : ''}: ${winnersStr}`, true);
  }

  _addLog(message) {
    this.log.push({ message, at: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  // ---------- Serialization ----------

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      hostId: this.hostId,
      players: this.players.map((p) => p.toJSON()),
      playerOrder: this.playerOrder,
      currentPlayerId: this.players[this.currentPlayerIndex]
        ? this.players[this.currentPlayerIndex].playerId
        : null,
      factories: this.factories,
      center: this.center,
      centerMarkerAvailable: this.centerMarkerAvailable,
      pendingSelection: this.pendingSelection,
      bagCount: this.bag.length,
      lidCount: this.lid.length,
      roundNumber: this.roundNumber,
      winnerIds: this.winnerIds,
      log: this.log.slice(-30),
      chat: this.chat.slice(-50),
    };
  }
}

module.exports = { Game, GameError, MIN_PLAYERS, MAX_PLAYERS };
