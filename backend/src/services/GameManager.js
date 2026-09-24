'use strict';

const { v4: uuidv4 } = require('uuid');
const { Game, GameError } = require('../models/Game');

class GameManager {
  constructor() {
    /** @type {Map<string, Game>} */
    this.games = new Map();
  }

  createGame(hostName) {
    const id = uuidv4().slice(0, 8);
    const game = new Game(id, hostName || 'Host');
    this.games.set(id, game);
    return {
      game,
      hostId: game.hostId,
      hostToken: game.initialHostToken || game.getPlayerToken(game.hostId),
    };
  }

  getGame(id) {
    const game = this.games.get(id);
    if (!game) {
      const err = new GameError('Game not found.');
      err.status = 404;
      throw err;
    }
    return game;
  }

  removeGameIfEmpty(id) {
    const game = this.games.get(id);
    if (game && game.players.length === 0) {
      this.games.delete(id);
    }
  }
}

// Singleton instance shared across the app.
module.exports = new GameManager();
