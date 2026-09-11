'use strict';

const gameManager = require('../services/GameManager');

module.exports = function registerGameSocket(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', ({ gameId }) => {
      if (!gameId) return;
      socket.join(gameId);
      try {
        const game = gameManager.getGame(gameId);
        socket.emit('state', game.toJSON());
      } catch (err) {
        socket.emit('error-message', err.message);
      }
    });

    socket.on('leave-room', ({ gameId }) => {
      if (gameId) socket.leave(gameId);
    });
  });
};
