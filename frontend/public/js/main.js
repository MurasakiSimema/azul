'use strict';

window.AzulConstants = {
  WALL_PATTERN: (() => {
    const COLORS = ['blue', 'yellow', 'red', 'black', 'cyan'];
    return Array.from({ length: 5 }, (_, row) =>
      Array.from({ length: 5 }, (_, col) => COLORS[(col - row + COLORS.length) % COLORS.length])
    );
  })(),
};

const AppState = {
  gameId: null,
  playerId: null,
  state: null,
  socket: null,
};

const views = {
  home: document.getElementById('view-home'),
  lobby: document.getElementById('view-lobby'),
  game: document.getElementById('view-game'),
  end: document.getElementById('view-end'),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
}

function setConnectionPill(connected) {
  const pill = document.getElementById('connection-pill');
  pill.textContent = connected ? 'online' : 'offline';
  pill.className = 'pill ' + (connected ? 'pill--online' : 'pill--offline');
}

// ---------- Socket wiring ----------

function connectSocket() {
  if (AppState.socket) return;
  const socket = io({ transports: ['websocket', 'polling'] });
  AppState.socket = socket;

  socket.on('connect', () => {
    setConnectionPill(true);
    if (AppState.gameId) socket.emit('join-room', { gameId: AppState.gameId });
  });
  socket.on('disconnect', () => setConnectionPill(false));
  socket.on('state', (state) => onStateUpdate(state));
}

function joinSocketRoom(gameId) {
  connectSocket();
  if (AppState.socket && AppState.socket.connected) {
    AppState.socket.emit('join-room', { gameId });
  }
}

// ---------- State handling ----------

function onStateUpdate(state) {
  AppState.state = state;
  persistSession();
  render();
}

function render() {
  const state = AppState.state;
  if (!state) return;

  if (state.status === 'lobby') {
    showView('lobby');
    document.getElementById('lobby-code').textContent = state.id;
    Render.lobbyPlayers(state, document.getElementById('lobby-players'));
    const isHost = state.hostId === AppState.playerId;
    const startBtn = document.getElementById('btn-start');
    startBtn.hidden = !isHost;
    startBtn.disabled = state.players.length < 2;
    document.getElementById('lobby-hint').hidden = isHost;
  } else if (state.status === 'playing') {
    showView('game');
    renderGame(state);
  } else if (state.status === 'finished') {
    showView('end');
    Render.endScreen(state, AppState.playerId, document.getElementById('end-scores'), document.getElementById('end-title'));
  }
}

function renderGame(state) {
  const myPlayerId = AppState.playerId;
  const isMyTurn = state.currentPlayerId === myPlayerId && !state.pendingSelection;
  const isMyPendingTurn = state.currentPlayerId === myPlayerId && !!state.pendingSelection;

  Render.turnBanner(state, myPlayerId, document.getElementById('turn-banner'));

  Render.factories(state, document.getElementById('factories'), {
    canInteract: isMyTurn,
    onPick: (factoryIndex, color) => doAction(() => Api.pickFromFactory(AppState.gameId, myPlayerId, factoryIndex, color)),
  });

  Render.center(state, document.getElementById('center-tiles'), {
    canInteract: isMyTurn,
    onPick: (color) => doAction(() => Api.pickFromCenter(AppState.gameId, myPlayerId, color)),
  });

  const myBoard = state.players.find((p) => p.playerId === myPlayerId);
  Render.selectionBar(
    {
      bar: document.getElementById('selection-bar'),
      label: document.getElementById('selection-label'),
      choices: document.getElementById('line-choices'),
    },
    state,
    myBoard,
    isMyPendingTurn,
    (lineIndex) => doAction(() => Api.placeSelection(AppState.gameId, myPlayerId, lineIndex))
  );

  Render.log(state, document.getElementById('log-list'));
  Render.playerBoards(state, myPlayerId, document.getElementById('players-column'));
}

async function doAction(fn) {
  try {
    await fn();
  } catch (err) {
    showTransientError(err.message);
  }
}

function showTransientError(message) {
  const el = document.getElementById('home-error');
  // Reuse a floating toast-like behavior even outside home view.
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText =
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#c1502e;color:#fff8ef;' +
      'padding:10px 18px;border-radius:6px;font-weight:600;z-index:999;box-shadow:0 8px 20px rgba(0,0,0,.25)';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(showTransientError._t);
  showTransientError._t = setTimeout(() => { toast.style.display = 'none'; }, 3200);
  if (el) { /* no-op, keep home error field for form validation only */ }
}

// ---------- Session persistence (survive refresh) ----------

function persistSession() {
  if (AppState.gameId && AppState.playerId) {
    sessionStorage.setItem('azul-session', JSON.stringify({ gameId: AppState.gameId, playerId: AppState.playerId }));
  }
}

function restoreSession() {
  const raw = sessionStorage.getItem('azul-session');
  if (!raw) return false;
  try {
    const { gameId, playerId } = JSON.parse(raw);
    if (!gameId || !playerId) return false;
    AppState.gameId = gameId;
    AppState.playerId = playerId;
    Api.getGame(gameId)
      .then(({ state }) => {
        if (!state.players.some((p) => p.playerId === playerId)) throw new Error('gone');
        onStateUpdate(state);
        joinSocketRoom(gameId);
      })
      .catch(() => {
        sessionStorage.removeItem('azul-session');
        showView('home');
      });
    return true;
  } catch {
    return false;
  }
}

// ---------- Event wiring ----------

document.getElementById('btn-create').addEventListener('click', async () => {
  const name = document.getElementById('create-name').value.trim() || 'Host';
  try {
    const { gameId, playerId, state } = await Api.createGame(name);
    AppState.gameId = gameId;
    AppState.playerId = playerId;
    onStateUpdate(state);
    joinSocketRoom(gameId);
  } catch (err) {
    setHomeError(err.message);
  }
});

document.getElementById('btn-join').addEventListener('click', async () => {
  const code = document.getElementById('join-code').value.trim();
  const name = document.getElementById('join-name').value.trim() || 'Giocatore';
  if (!code) { setHomeError('Inserisci il codice partita.'); return; }
  try {
    const { gameId, playerId, state } = await Api.joinGame(code, name);
    AppState.gameId = gameId;
    AppState.playerId = playerId;
    onStateUpdate(state);
    joinSocketRoom(gameId);
  } catch (err) {
    setHomeError(err.message);
  }
});

document.getElementById('btn-start').addEventListener('click', () => {
  doAction(() => Api.startGame(AppState.gameId));
});

document.getElementById('btn-back-home').addEventListener('click', () => {
  sessionStorage.removeItem('azul-session');
  AppState.gameId = null;
  AppState.playerId = null;
  AppState.state = null;
  showView('home');
});

function setHomeError(message) {
  const el = document.getElementById('home-error');
  el.textContent = message;
  el.hidden = false;
}

// ---------- Boot ----------

connectSocket();
if (!restoreSession()) {
  showView('home');
}
