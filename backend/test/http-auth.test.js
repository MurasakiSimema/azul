'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const gameRoutes = require('../src/routes/gameRoutes');
const registerGameSocket = require('../src/sockets/gameSocket');

describe('HTTP REST & Socket Authentication Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', gameRoutes);

    server = http.createServer(app);
    const io = new Server(server);
    app.set('io', io);
    registerGameSocket(io);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function req(path, opts = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { 'x-player-token': opts.token } : {}),
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  test('POST /api/games returns gameId, hostId, and secret playerToken', async () => {
    const res = await req('/games', { method: 'POST', body: { hostName: 'HostPlayer' } });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.gameId);
    assert.ok(res.data.playerId);
    assert.ok(res.data.playerToken);
    assert.strictEqual(res.data.state.playerTokens, undefined);
  });

  test('POST /api/games/:id/join returns playerId and secret playerToken', async () => {
    const createRes = await req('/games', { method: 'POST', body: { hostName: 'HostPlayer' } });
    const { gameId, playerToken: hostToken } = createRes.data;

    const joinRes = await req(`/games/${gameId}/join`, { method: 'POST', body: { name: 'Player2' } });
    assert.strictEqual(joinRes.status, 200);
    assert.ok(joinRes.data.playerId);
    assert.ok(joinRes.data.playerToken);
    assert.notStrictEqual(hostToken, joinRes.data.playerToken);
  });

  test('POST /api/games/:id/start requires host authorization', async () => {
    const createRes = await req('/games', { method: 'POST', body: { hostName: 'HostPlayer' } });
    const { gameId, playerToken: hostToken } = createRes.data;

    const joinRes = await req(`/games/${gameId}/join`, { method: 'POST', body: { name: 'Player2' } });
    const { playerToken: p2Token } = joinRes.data;

    // 1. Without token -> 401
    const noToken = await req(`/games/${gameId}/start`, { method: 'POST' });
    assert.strictEqual(noToken.status, 401);

    // 2. With non-host token -> 403
    const nonHost = await req(`/games/${gameId}/start`, { method: 'POST', token: p2Token });
    assert.strictEqual(nonHost.status, 403);

    // 3. With host token -> 200
    const withHost = await req(`/games/${gameId}/start`, { method: 'POST', token: hostToken });
    assert.strictEqual(withHost.status, 200);
    assert.strictEqual(withHost.data.state.status, 'playing');
  });

  test('POST /api/games/:id/action/pick-factory enforces active player token', async () => {
    const createRes = await req('/games', { method: 'POST', body: { hostName: 'HostPlayer' } });
    const { gameId, playerId: hostId, playerToken: hostToken } = createRes.data;

    const joinRes = await req(`/games/${gameId}/join`, { method: 'POST', body: { name: 'Player2' } });
    const { playerId: p2Id, playerToken: p2Token } = joinRes.data;

    const startRes = await req(`/games/${gameId}/start`, { method: 'POST', token: hostToken });
    const currentPId = startRes.data.state.currentPlayerId;
    const currentToken = currentPId === hostId ? hostToken : p2Token;
    const wrongToken = currentPId === hostId ? p2Token : hostToken;

    const factoryIndex = startRes.data.state.factories.findIndex((f) => f.length > 0);
    const color = startRes.data.state.factories[factoryIndex][0];

    // Wrong token -> 403
    const wrongRes = await req(`/games/${gameId}/action/pick-factory`, {
      method: 'POST',
      token: wrongToken,
      body: { playerId: currentPId, factoryIndex, color },
    });
    assert.strictEqual(wrongRes.status, 403);

    // Valid token -> 200
    const validRes = await req(`/games/${gameId}/action/pick-factory`, {
      method: 'POST',
      token: currentToken,
      body: { playerId: currentPId, factoryIndex, color },
    });
    assert.strictEqual(validRes.status, 200);
    assert.ok(validRes.data.state.pendingSelection);
  });

  test('POST /api/games/:id/chat enforces sender authentication', async () => {
    const createRes = await req('/games', { method: 'POST', body: { hostName: 'HostPlayer' } });
    const { gameId, playerId: hostId, playerToken: hostToken } = createRes.data;

    const joinRes = await req(`/games/${gameId}/join`, { method: 'POST', body: { name: 'Player2' } });
    const { playerId: p2Id, playerToken: p2Token } = joinRes.data;

    // Spoofed message -> 403
    const spoofRes = await req(`/games/${gameId}/chat`, {
      method: 'POST',
      token: hostToken,
      body: { playerId: p2Id, message: 'I am pretending to be player 2' },
    });
    assert.strictEqual(spoofRes.status, 403);

    // Legitimate message -> 201
    const legitRes = await req(`/games/${gameId}/chat`, {
      method: 'POST',
      token: p2Token,
      body: { playerId: p2Id, message: 'Legitimate player 2 message' },
    });
    assert.strictEqual(legitRes.status, 201);
  });

  test('POST /api/games/:id/leave prevents kicking other players', async () => {
    const createRes = await req('/games', { method: 'POST', body: { hostName: 'HostPlayer' } });
    const { gameId, playerId: hostId, playerToken: hostToken } = createRes.data;

    const joinRes = await req(`/games/${gameId}/join`, { method: 'POST', body: { name: 'Player2' } });
    const { playerId: p2Id, playerToken: p2Token } = joinRes.data;

    // Player 2 tries to kick Host -> 403
    const kickRes = await req(`/games/${gameId}/leave`, {
      method: 'POST',
      token: p2Token,
      body: { playerId: hostId },
    });
    assert.strictEqual(kickRes.status, 403);

    // Player 2 leaves with own credentials -> 200
    const leaveRes = await req(`/games/${gameId}/leave`, {
      method: 'POST',
      token: p2Token,
      body: { playerId: p2Id },
    });
    assert.strictEqual(leaveRes.status, 200);
  });
});
