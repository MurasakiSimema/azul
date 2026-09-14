'use strict';

const COLOR_LABELS = {
  blue: 'blu', yellow: 'giallo', red: 'rosso', black: 'nero', cyan: 'ciano',
};

function tileEl(color, { clickable = false, ghost = false, pop = false } = {}) {
  const el = document.createElement('div');
  el.className = `tile tile--${color}` + (clickable ? ' clickable' : '') + (ghost ? ' tile--ghost' : '') + (pop ? ' tile-pop' : '');
  el.title = COLOR_LABELS[color] || color;
  return el;
}

function markerEl({ pop = false } = {}) {
  const el = document.createElement('div');
  el.className = 'tile marker' + (pop ? ' tile-pop' : '');
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

  factories(state, container, { canInteract, onPick, diff }) {
    container.innerHTML = '';
    state.factories.forEach((tiles, idx) => {
      const factory = document.createElement('div');
      factory.className = 'factory';
      const isFreshlyFilled = !!(diff && diff.factories[idx]);
      if (tiles.length === 0) {
        for (let i = 0; i < 4; i += 1) factory.appendChild(emptySlotEl());
      } else {
        tiles.forEach((color) => {
          const el = tileEl(color, { clickable: canInteract, pop: isFreshlyFilled });
          if (canInteract) el.addEventListener('click', () => onPick(idx, color));
          factory.appendChild(el);
        });
      }
      container.appendChild(factory);
    });
  },

  center(state, container, { canInteract, onPick, diff }) {
    container.innerHTML = '';
    if (state.centerMarkerAvailable) container.appendChild(markerEl({ pop: !!(diff && diff.markerNew) }));
    if (state.center.length === 0 && !state.centerMarkerAvailable) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = 'vuoto';
      container.appendChild(span);
      return;
    }
    const remainingNew = diff ? { ...diff.centerNewCounts } : {};
    state.center.forEach((color) => {
      let pop = false;
      if (remainingNew[color] > 0) {
        pop = true;
        remainingNew[color] -= 1;
      }
      const el = tileEl(color, { clickable: canInteract, pop });
      if (canInteract) el.addEventListener('click', () => onPick(color));
      container.appendChild(el);
    });
  },

  selectionBar({ bar, label }, state, isMyTurn) {
    const showIt = isMyTurn && state.pendingSelection;
    bar.hidden = !showIt;
    if (!showIt) return;
    const { color, count } = state.pendingSelection;
    label.textContent = `Hai preso ${count} tessera/e ${COLOR_LABELS[color] || color}.`;
  },

  /** Whether a pattern line can currently accept the pending color (mirrors PlayerBoard.canAddToLine). */
  canPlaceOnLine(board, lineIndex, color) {
    const line = board.patternLines[lineIndex];
    const capacity = lineIndex + 1;
    if (line.length >= capacity) return false;
    if (line.length > 0 && line[0] !== color) return false;
    if (board.wall[lineIndex].includes(color)) return false;
    return true;
  },

  log(state, container) {
    container.innerHTML = '';
    [...state.log].reverse().forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = entry.message;
      container.appendChild(li);
    });
  },

  playerBoards(state, myPlayerId, container, interaction = {}) {
    const { isMyPendingTurn = false, onChooseLine = () => {}, diff = null } = interaction;
    const pendingColor = state.pendingSelection ? state.pendingSelection.color : null;

    container.innerHTML = '';
    // Show "me" first, then others in turn order for readability.
    const ordered = [...state.players].sort((a, b) => {
      if (a.playerId === myPlayerId) return -1;
      if (b.playerId === myPlayerId) return 1;
      return 0;
    });

    ordered.forEach((p) => {
      const isMe = p.playerId === myPlayerId;
      const pdiff = diff && diff.players[p.playerId];

      const wrap = document.createElement('div');
      wrap.className = 'player-board';
      if (p.playerId === state.currentPlayerId) wrap.classList.add('active');
      if (isMe) wrap.classList.add('me');

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
        const prevLen = pdiff ? pdiff.patternLinePrevLengths[rowIdx] : line.length;
        for (let i = 0; i < capacity; i += 1) {
          rowEl.appendChild(i < line.length ? tileEl(line[i], { pop: i >= prevLen }) : emptySlotEl());
        }

        if (isMe && isMyPendingTurn) {
          const canPlace = Render.canPlaceOnLine(p, rowIdx, pendingColor);
          rowEl.classList.add(canPlace ? 'selectable' : 'unselectable');
          if (canPlace) {
            rowEl.setAttribute('role', 'button');
            rowEl.setAttribute('tabindex', '0');
            rowEl.setAttribute('aria-label', `Posiziona sulla riga pattern ${rowIdx + 1}`);
            rowEl.addEventListener('click', () => onChooseLine(rowIdx));
            rowEl.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChooseLine(rowIdx); }
            });
          }
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
            const wasAlreadyFilled = pdiff ? pdiff.wallPrevFilled[r][c] : true;
            cellEl.className = `wall-cell tile--${cell}` + (wasAlreadyFilled ? '' : ' tile-pop');
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
      const floorPrevLen = pdiff ? pdiff.floorPrevLength : 7;
      for (let i = 0; i < 7; i += 1) {
        const slot = document.createElement('div');
        const token = p.floorLine[i];
        const isNew = i >= floorPrevLen;
        if (token) {
          slot.className =
            'floor-slot ' +
            (token.type === 'marker' ? 'tile marker' : `tile tile--${token.color}`) +
            (isNew ? ' tile-pop' : '');
        } else {
          slot.className = 'floor-slot';
          slot.textContent = penalties[i];
        }
        floorWrap.appendChild(slot);
      }

      if (isMe && isMyPendingTurn) {
        floorWrap.classList.add('selectable');
        floorWrap.setAttribute('role', 'button');
        floorWrap.setAttribute('tabindex', '0');
        floorWrap.setAttribute('aria-label', 'Posiziona nella fila scarti');
        floorWrap.addEventListener('click', () => onChooseLine(-1));
        floorWrap.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChooseLine(-1); }
        });
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
