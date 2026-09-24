'use strict';

// window.API_BASE_URL can be injected at container start (see index.html override
// or env substitution); falls back to same-origin '/api' which nginx proxies to backend.
const API_BASE = (window.API_BASE_URL || '') + '/api';

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) {
    headers['x-player-token'] = options.token;
  }
  const res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const Api = {
  createGame: (hostName) => request('/games', { method: 'POST', body: { hostName } }),
  joinGame: (gameId, name) => request(`/games/${gameId}/join`, { method: 'POST', body: { name } }),
  getGame: (gameId) => request(`/games/${gameId}`),
  startGame: (gameId, playerToken) =>
    request(`/games/${gameId}/start`, {
      method: 'POST',
      token: playerToken,
      body: { playerToken },
    }),
  leaveGame: (gameId, playerId, playerToken) =>
    request(`/games/${gameId}/leave`, {
      method: 'POST',
      token: playerToken,
      body: { playerId, playerToken },
    }),
  pickFromFactory: (gameId, playerId, factoryIndex, color, playerToken) =>
    request(`/games/${gameId}/action/pick-factory`, {
      method: 'POST',
      token: playerToken,
      body: { playerId, factoryIndex, color, playerToken },
    }),
  pickFromCenter: (gameId, playerId, color, playerToken) =>
    request(`/games/${gameId}/action/pick-center`, {
      method: 'POST',
      token: playerToken,
      body: { playerId, color, playerToken },
    }),
  placeSelection: (gameId, playerId, lineIndex, playerToken) =>
    request(`/games/${gameId}/action/place`, {
      method: 'POST',
      token: playerToken,
      body: { playerId, lineIndex, playerToken },
    }),
  sendChat: (gameId, playerId, message, playerToken) =>
    request(`/games/${gameId}/chat`, {
      method: 'POST',
      token: playerToken,
      body: { playerId, message, playerToken },
    }),
};

window.Api = Api;
