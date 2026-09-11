'use strict';

const COLOR_LABELS = {
  blue: 'blu', yellow: 'giallo', red: 'rosso', black: 'nero', cyan: 'ciano',
};

function tileEl(color, { clickable = false, ghost = false } = {}) {
  const el = document.createElement('div');
  el.className = `tile tile--${color}` + (clickable ? ' clickable' : '') + (ghost ? ' tile--ghost' : '');
  el.title = COLOR_LABELS[color] || color;
  return el;
}

function markerEl() {
  const el = document.createElement('div');
  el.className = 'tile marker';
  el.title = 'Segnalino primo giocatore';
  return el;
}

function emptySlotEl() {
  const el = document.createElement('div');
  el.className = 'tile tile--empty';
  return el;
}

const Render = {
  lobbyPlayers(state, container) {
    container.innerHTML = '';
    state.players.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p.name + (p.playerId === state.hostId ? '  •  host' : '');
      container.appendChild(li);
    });
  },

  turnBanner(state, myPlayerId, el) {
    const current = state.players.find((p) => p.playerId === state.currentPlayerId);
    if (!current) { el.textContent = ''; return; }
    const mine = current.playerId === myPlayerId;
    el.textContent = mine ? 'Tocca a te giocare.' : `Turno di ${current.name}.`;
    el.classList.toggle('mine', mine);
  },

  factories(state, container, { canInteract, onPick }) {
    container.innerHTML = '';
    state.factories.forEach((tiles, idx) => {
      const factory = document.createElement('div');
      factory.className = 'factory';
      if (tiles.length === 0) {
        for (let i = 0; i < 4; i += 1) factory.appendChild(emptySlotEl());
      } else {
        tiles.forEach((color) => {
          const el = tileEl(color, { clickable: canInteract });
          if (canInteract) el.addEventListener('click', () => onPick(idx, color));
          factory.appendChild(el);
        });
      }
      container.appendChild(factory);
    });
  },

  center(state, container, { canInteract, onPick }) {
    container.innerHTML = '';
    if (state.centerMarkerAvailable) container.appendChild(markerEl());
    if (state.center.length === 0 && !state.centerMarkerAvailable) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = 'vuoto';
      container.appendChild(span);
      return;
    }
    state.center.forEach((color) => {
      const el = tileEl(color, { clickable: canInteract });
      if (canInteract) el.addEventListener('click', () => onPick(color));
      container.appendChild(el);
    });
  },

  selectionBar({ bar, label, choices }, state, myBoard, isMyTurn, onChoose) {
    const showIt = isMyTurn && state.pendingSelection;
    bar.hidden = !showIt;
    if (!showIt) return;

    const { color, count } = state.pendingSelection;
    label.textContent = `Hai preso ${count} tessera/e ${COLOR_LABELS[color] || color}: scegli dove posizionarle.`;
    choices.innerHTML = '';

    for (let i = 0; i < 5; i += 1) {
      const canPlace = myBoard.patternLines[i].length < i + 1 &&
        (myBoard.patternLines[i].length === 0 || myBoard.patternLines[i][0] === color) &&
        !myBoard.wall[i].includes(color);
      const btn = document.createElement('button');
      btn.className = 'line-choice-btn';
      btn.textContent = `Riga ${i + 1}`;
      btn.disabled = !canPlace;
      btn.addEventListener('click', () => onChoose(i));
      choices.appendChild(btn);
    }
    const floorBtn = document.createElement('button');
    floorBtn.className = 'line-choice-btn floor';
    floorBtn.textContent = 'Fila scarti';
    floorBtn.addEventListener('click', () => onChoose(-1));
    choices.appendChild(floorBtn);
  },

  log(state, container) {
    container.innerHTML = '';
    [...state.log].reverse().forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = entry.message;
      container.appendChild(li);
    });
  },

  playerBoards(state, myPlayerId, container) {
    container.innerHTML = '';
    // Show "me" first, then others in turn order for readability.
    const ordered = [...state.players].sort((a, b) => {
      if (a.playerId === myPlayerId) return -1;
      if (b.playerId === myPlayerId) return 1;
      return 0;
    });

    ordered.forEach((p) => {
      const wrap = document.createElement('div');
      wrap.className = 'player-board';
      if (p.playerId === state.currentPlayerId) wrap.classList.add('active');
      if (p.playerId === myPlayerId) wrap.classList.add('me');

      const header = document.createElement('div');
      header.className = 'player-header';
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = p.name;
      const score = document.createElement('span');
      score.className = 'player-score';
      score.textContent = p.score;
      header.appendChild(name);
      header.appendChild(score);
      wrap.appendChild(header);

      const grids = document.createElement('div');
      grids.className = 'board-grids';

      const patternWrap = document.createElement('div');
      patternWrap.className = 'pattern-lines';
      p.patternLines.forEach((line, rowIdx) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'pattern-line';
        const capacity = rowIdx + 1;
        for (let i = 0; i < capacity; i += 1) {
          rowEl.appendChild(i < line.length ? tileEl(line[i]) : emptySlotEl());
        }
        patternWrap.appendChild(rowEl);
      });

      const wallWrap = document.createElement('div');
      wallWrap.className = 'wall-grid';
      const { WALL_PATTERN } = window.AzulConstants;
      p.wall.forEach((row, r) => {
        row.forEach((cell, c) => {
          const cellEl = document.createElement('div');
          if (cell) {
            cellEl.className = `wall-cell tile--${cell}`;
          } else {
            cellEl.className = `wall-cell tile--${WALL_PATTERN[r][c]} empty`;
          }
          wallWrap.appendChild(cellEl);
        });
      });

      grids.appendChild(patternWrap);
      grids.appendChild(wallWrap);
      wrap.appendChild(grids);

      const floorWrap = document.createElement('div');
      floorWrap.className = 'floor-line';
      const penalties = [-1, -1, -2, -2, -2, -3, -3];
      for (let i = 0; i < 7; i += 1) {
        const slot = document.createElement('div');
        const token = p.floorLine[i];
        if (token) {
          slot.className = 'floor-slot ' + (token.type === 'marker' ? 'tile marker' : `tile tile--${token.color}`);
        } else {
          slot.className = 'floor-slot';
          slot.textContent = penalties[i];
        }
        floorWrap.appendChild(slot);
      }
      wrap.appendChild(floorWrap);

      container.appendChild(wrap);
    });
  },

  endScreen(state, myPlayerId, container, titleEl) {
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    titleEl.textContent = state.winnerIds.length > 1 ? 'Partita conclusa — pareggio!' : 'Partita conclusa';
    container.innerHTML = '';
    ranked.forEach((p) => {
      const li = document.createElement('li');
      const isWinner = state.winnerIds.includes(p.playerId);
      if (isWinner) li.classList.add('winner');
      const label = document.createElement('span');
      label.textContent = p.name + (p.playerId === myPlayerId ? ' (tu)' : '') + (isWinner ? ' 🏆' : '');
      const score = document.createElement('span');
      score.textContent = p.score;
      li.appendChild(label);
      li.appendChild(score);
      container.appendChild(li);
    });
  },
};

window.Render = Render;
