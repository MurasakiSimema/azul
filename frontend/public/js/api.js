'use strict';

// window.API_BASE_URL can be injected at container start (see index.html override
// or env substitution); falls back to same-origin '/api' which nginx proxies to backend.
const API_BASE = (window.API_BASE_URL || '') + '/api';

async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
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
  startGame: (gameId) => request(`/games/${gameId}/start`, { method: 'POST' }),
  leaveGame: (gameId, playerId) => request(`/games/${gameId}/leave`, { method: 'POST', body: { playerId } }),
  pickFromFactory: (gameId, playerId, factoryIndex, color) =>
    request(`/games/${gameId}/action/pick-factory`, { method: 'POST', body: { playerId, factoryIndex, color } }),
  pickFromCenter: (gameId, playerId, color) =>
    request(`/games/${gameId}/action/pick-center`, { method: 'POST', body: { playerId, color } }),
  placeSelection: (gameId, playerId, lineIndex) =>
    request(`/games/${gameId}/action/place`, { method: 'POST', body: { playerId, lineIndex } }),
};

window.Api = Api;
