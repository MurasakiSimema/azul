'use strict';

const gameManager = require('../services/GameManager');
const { GameError } = require('../models/Game');

/** Wrap handlers so any GameError becomes a clean JSON error response. */
function safe(handler) {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      if (err instanceof GameError) {
        res.status(err.status || 400).json({ error: err.message });
      } else {
        // eslint-disable-next-line no-console
        console.error(err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  };
}

function broadcast(req, game) {
  const io = req.app.get('io');
  if (io) io.to(game.id).emit('state', game.toJSON());
}

exports.createGame = safe((req, res) => {
  const { hostName } = req.body || {};
  const game = gameManager.createGame(hostName || 'Host');
  const hostId = game.players[0].playerId;
  res.status(201).json({ gameId: game.id, playerId: hostId, state: game.toJSON() });
});

exports.joinGame = safe((req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  const game = gameManager.getGame(id);
  const playerId = game.addPlayer(name);
  broadcast(req, game);
  res.status(200).json({ gameId: game.id, playerId, state: game.toJSON() });
});

exports.getGame = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  res.json({ state: game.toJSON() });
});

exports.startGame = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  game.start();
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.leaveGame = safe((req, res) => {
  const { id } = req.params;
  const { playerId } = req.body || {};
  const game = gameManager.getGame(id);
  game.removePlayer(playerId);
  broadcast(req, game);
  gameManager.removeGameIfEmpty(id);
  res.json({ ok: true });
});

exports.pickFromFactory = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const { playerId, factoryIndex, color } = req.body || {};
  game.pickFromFactory(playerId, factoryIndex, color);
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.pickFromCenter = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const { playerId, color } = req.body || {};
  game.pickFromCenter(playerId, color);
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.placeSelection = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const { playerId, lineIndex } = req.body || {};
  game.placeSelection(playerId, lineIndex);
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.sendChat = safe((req, res) => {
  const { id } = req.params;
  const { playerId, message } = req.body || {};
  const game = gameManager.getGame(id);
  const chatEntry = game.addChatMessage(playerId, message);
  const io = req.app.get('io');
  if (io) io.to(id).emit('chat-message', chatEntry);
  res.status(201).json({ chatEntry });
});
