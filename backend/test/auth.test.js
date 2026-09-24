'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const gameManager = require('../src/services/GameManager');

describe('Authentication & Authorization Unit Tests', () => {
  test('Token generation and privacy in toJSON', () => {
    const { game, hostId, hostToken } = gameManager.createGame('HostPlayer');
    assert.ok(game.id, 'game must have an id');
    assert.ok(hostId, 'hostId must exist');
    assert.ok(hostToken, 'hostToken must be generated');
    assert.strictEqual(typeof hostToken, 'string');
    assert.strictEqual(hostToken.length, 48, 'token should be 48 hex chars');

    // Ensure tokens are NOT exposed in toJSON
    const serialized = game.toJSON();
    assert.strictEqual(serialized.playerTokens, undefined, 'playerTokens must not be in toJSON');
    assert.strictEqual(serialized.initialHostToken, undefined, 'initialHostToken must not be in toJSON');
    serialized.players.forEach((p) => {
      assert.strictEqual(p.playerToken, undefined, 'playerToken must not be in player toJSON');
    });
  });

  test('Player joins with unique secret token', () => {
    const { game, hostToken } = gameManager.createGame('HostPlayer');
    const { playerId: p2Id, playerToken: p2Token } = game.addPlayer('Player2');
    assert.ok(p2Id);
    assert.ok(p2Token);
    assert.notStrictEqual(hostToken, p2Token, 'tokens must be unique');
  });

  test('Host-only authorization on startGame', () => {
    const { game, hostToken } = gameManager.createGame('HostPlayer');
    const { playerToken: p2Token } = game.addPlayer('Player2');

    assert.throws(
      () => game.assertHostToken(null),
      (err) => err.status === 401,
      'Missing host token should throw 401'
    );

    assert.throws(
      () => game.assertHostToken(p2Token),
      (err) => err.status === 403,
      'Non-host token on host action should throw 403'
    );

    assert.doesNotThrow(() => game.assertHostToken(hostToken), 'Host token should be accepted');
  });

  test('Player token assertion and spoofing prevention', () => {
    const { game, hostId, hostToken } = gameManager.createGame('HostPlayer');
    const { playerId: p2Id, playerToken: p2Token } = game.addPlayer('Player2');

    assert.throws(
      () => game.assertPlayerToken(hostId, null),
      (err) => err.status === 401,
      'Missing player token should throw 401'
    );

    assert.throws(
      () => game.assertPlayerToken(hostId, p2Token),
      (err) => err.status === 403,
      'Impersonating host with p2Token should throw 403'
    );

    assert.throws(
      () => game.assertPlayerToken(p2Id, hostToken),
      (err) => err.status === 403,
      'Impersonating p2 with hostToken should throw 403'
    );

    assert.doesNotThrow(() => game.assertPlayerToken(hostId, hostToken), 'Host credentials should match');
    assert.doesNotThrow(() => game.assertPlayerToken(p2Id, p2Token), 'Player 2 credentials should match');
  });

  test('In-game move and tile placement authorization', () => {
    const { game, hostId, hostToken } = gameManager.createGame('HostPlayer');
    const { playerId: p2Id, playerToken: p2Token } = game.addPlayer('Player2');
    game.start();

    const currentP = game.currentPlayer();
    const currentToken = game.getPlayerToken(currentP.playerId);
    const otherPlayerId = currentP.playerId === hostId ? p2Id : hostId;
    const otherToken = game.getPlayerToken(otherPlayerId);

    const factoryWithTiles = game.factories.findIndex((f) => f.length > 0);
    const color = game.factories[factoryWithTiles][0];

    // Attacker cannot pick for active player
    assert.throws(
      () => game.assertPlayerToken(currentP.playerId, otherToken),
      (err) => err.status === 403
    );

    // Active player picks with valid token
    assert.doesNotThrow(() => {
      game.assertPlayerToken(currentP.playerId, currentToken);
      game.pickFromFactory(currentP.playerId, factoryWithTiles, color);
    });

    // Attacker cannot place tiles on active player's board
    assert.throws(
      () => game.assertPlayerToken(currentP.playerId, otherToken),
      (err) => err.status === 403
    );

    // Active player places tiles
    assert.doesNotThrow(() => {
      game.assertPlayerToken(currentP.playerId, currentToken);
      game.placeSelection(currentP.playerId, 0);
    });
  });

  test('Chat impersonation prevention', () => {
    const { game, hostId } = gameManager.createGame('HostPlayer');
    const { playerId: p2Id, playerToken: p2Token } = game.addPlayer('Player2');

    assert.throws(
      () => game.assertPlayerToken(hostId, p2Token),
      (err) => err.status === 403,
      'Attacker cannot forge chat message as other player'
    );

    assert.doesNotThrow(() => {
      game.assertPlayerToken(p2Id, p2Token);
      game.addChatMessage(p2Id, 'Legitimate message');
    });
  });
});
