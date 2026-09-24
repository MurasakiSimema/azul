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

function extractToken(req) {
  return req.headers['x-player-token'] || (req.body && req.body.playerToken) || null;
}

exports.createGame = safe((req, res) => {
  const { hostName } = req.body || {};
  const { game, hostId, hostToken } = gameManager.createGame(hostName || 'Host');
  res.status(201).json({
    gameId: game.id,
    playerId: hostId,
    playerToken: hostToken,
    state: game.toJSON(),
  });
});

exports.joinGame = safe((req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  const game = gameManager.getGame(id);
  const { playerId, playerToken } = game.addPlayer(name);
  broadcast(req, game);
  res.status(200).json({
    gameId: game.id,
    playerId,
    playerToken,
    state: game.toJSON(),
  });
});

exports.getGame = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  res.json({ state: game.toJSON() });
});

exports.startGame = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const token = extractToken(req);
  game.assertHostToken(token);
  game.start();
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.leaveGame = safe((req, res) => {
  const { id } = req.params;
  const { playerId } = req.body || {};
  const token = extractToken(req);
  const game = gameManager.getGame(id);
  game.assertPlayerToken(playerId, token);
  game.removePlayer(playerId);
  broadcast(req, game);
  gameManager.removeGameIfEmpty(id);
  res.json({ ok: true });
});

exports.pickFromFactory = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const { playerId, factoryIndex, color } = req.body || {};
  const token = extractToken(req);
  game.assertPlayerToken(playerId, token);
  game.pickFromFactory(playerId, factoryIndex, color);
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.pickFromCenter = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const { playerId, color } = req.body || {};
  const token = extractToken(req);
  game.assertPlayerToken(playerId, token);
  game.pickFromCenter(playerId, color);
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.placeSelection = safe((req, res) => {
  const game = gameManager.getGame(req.params.id);
  const { playerId, lineIndex } = req.body || {};
  const token = extractToken(req);
  game.assertPlayerToken(playerId, token);
  game.placeSelection(playerId, lineIndex);
  broadcast(req, game);
  res.json({ state: game.toJSON() });
});

exports.sendChat = safe((req, res) => {
  const { id } = req.params;
  const { playerId, message } = req.body || {};
  const token = extractToken(req);
  const game = gameManager.getGame(id);
  game.assertPlayerToken(playerId, token);
  const chatEntry = game.addChatMessage(playerId, message);
  const io = req.app.get('io');
  if (io) io.to(id).emit('chat-message', chatEntry);
  res.status(201).json({ chatEntry });
});
