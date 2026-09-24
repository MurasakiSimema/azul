# Azul — Security, Bug & Logic Audit Report

This report documents the vulnerabilities, rule discrepancies, stability bugs, and architectural flaws identified in the Azul web application codebase (`backend/` and `frontend/`).

---

## 1. Executive Summary

| Category | High | Medium | Low / Informational | Total |
|---|:---:|:---:|:---:|:---:|
| **Security & Authorization** | 2 | 2 | 2 | 6 |
| **Game Logic & Rules** | 1 | 1 | 0 | 2 |
| **Stability & Runtime Bugs** | 1 | 2 | 0 | 3 |
| **UX & Frontend Sync** | 0 | 2 | 1 | 3 |
| **Configuration & Deployment** | 0 | 1 | 2 | 3 |
| **Total** | **4** | **8** | **5** | **17** |

---

## 2. Security Vulnerabilities & Insecure Behavior

### 2.1 Complete Lack of Authentication & Player Impersonation (High)
* **Files**: 
  - `backend/src/controllers/gameController.js`
  - `backend/src/models/Game.js`
  - `backend/src/sockets/gameSocket.js`
* **Vulnerability Analysis**:
  - The API relies entirely on `playerId` passed in JSON request bodies (e.g. `{ playerId, factoryIndex, color }`).
  - `playerId` is a standard UUID generated when a player joins.
  - However, `game.toJSON()` exposes the `playerId` of **every player** to all participants and to anyone fetching `GET /api/games/:id`.
  - There are no private session tokens, secrets, cookies, or JWTs.
* **Exploit Scenario**:
  - Any player or spectator who inspects the game state in browser DevTools or via the API can copy opponent `playerId`s.
  - An attacker can issue requests with an opponent's `playerId` to make sub-optimal moves, waste turns, or force tile dumping onto the floor line (`lineIndex: -1`).
  - An attacker can forge chat messages under any player's name via both REST (`POST /api/games/:id/chat`) and WebSocket (`send-chat`).
  - An attacker can call `POST /api/games/:id/leave` with any player's `playerId` to kick them out of the lobby.
* **Remediation**:
  - Generate a separate `secretToken` (or `playerToken`) upon `createGame` / `joinGame`.
  - Return `playerToken` **only** to the creating/joining client and store it in `sessionStorage`.
  - Keep `playerId` public for UI identification, but require `x-player-token` (or an `Authorization` header) for all mutating operations.
  - Validate that `playerToken` corresponds to `playerId`.

---

### 2.2 Missing Authorization on `startGame` (High)
* **File**: `backend/src/controllers/gameController.js` (lines 49–54)
* **Vulnerability Analysis**:
  ```javascript
  exports.startGame = safe((req, res) => {
    const game = gameManager.getGame(req.params.id);
    game.start();
    broadcast(req, game);
    res.json({ state: game.toJSON() });
  });
  ```
  The endpoint verifies neither `playerId` nor `hostId`.
* **Exploit Scenario**:
  While the frontend conditionally hides the "Inizia la partita" button from non-hosts, any player or external client can send `POST /api/games/:id/start` to prematurely launch the match before all players join or before the host is ready.
* **Remediation**:
  Require the host's authentication token and assert `game.hostId === requesterPlayerId` in `startGame`.

---

### 2.3 Memory Leak & Denial of Service via In-Memory Game Map (Medium)
* **File**: `backend/src/services/GameManager.js` (lines 8–17, 29–35)
* **Vulnerability Analysis**:
  - `GameManager.games` is an unbounded `Map<string, Game>`.
  - `removeGameIfEmpty(id)` is only invoked during `leaveGame` if all players depart during the lobby phase.
  - Finished games (`status === 'finished'`), games abandoned in progress, or unstarted lobbies are never removed.
  - There is no TTL (time-to-live), inactivity expiry, maximum game threshold, or rate-limiting on `POST /api/games`.
* **Exploit Scenario**:
  An automated script sending requests to `POST /api/games` can create tens of thousands of instances, exhausting Node.js heap memory and triggering an Out-of-Memory (OOM) crash (Denial of Service).
* **Remediation**:
  - Store a `lastActivityAt = Date.now()` timestamp on each `Game` and update it on every action.
  - Implement a periodic cleanup interval (e.g. every 15 minutes) deleting games inactive for > 2 hours.
  - Apply `express-rate-limit` to game creation endpoints.

---

### 2.4 Unbounded Player and Host Name Length (Low)
* **File**: `backend/src/models/Game.js` (lines 98–108)
* **Vulnerability Analysis**:
  While the frontend HTML limits inputs to `maxlength="24"`, the backend performs no string length validation on `hostName` or `name`.
* **Impact**:
  An attacker can supply a multi-megabyte string, causing high memory usage and oversized WebSocket broadcasts.
* **Remediation**:
  Enforce `typeof name === 'string' && name.trim().length <= 24` on the backend.

---

## 3. Game Logic & Azul Rules Bugs

### 3.1 Critical Tile Leak: Floor Overflow Discarded Tiles Vanish (High)
* **Files**: 
  - `backend/src/models/PlayerBoard.js` (lines 55–80)
  - `backend/src/models/Game.js` (lines 230–238)
* **Rule Discrepancy**:
  In official Azul rules:
  > *"Any excess tiles that do not fit into the floor line are placed directly into the box lid."*
* **Bug Analysis**:
  1. `PlayerBoard.addTilesToFloor` correctly detects excess tiles and returns them in `discarded`:
     ```javascript
     addTilesToFloor(color, count) {
       const discarded = [];
       for (let i = 0; i < count; i += 1) {
         if (this.floorLine.length < FLOOR_PENALTIES.length) {
           this.floorLine.push({ type: 'tile', color });
         } else {
           discarded.push(color);
         }
       }
       return discarded;
     }
     ```
  2. `PlayerBoard.addTilesToLine(lineIndex, color, count)` invokes `this.addTilesToFloor(color, remaining)` on overflow, but **ignores its return value** and returns `remaining`.
  3. `Game.placeSelection(playerId, lineIndex)` calls `addTilesToFloor` or `addTilesToLine` and **never captures or passes `discarded` to `this.lid`**.
* **Impact**:
  Excess floor tiles permanently vanish from the match. Over several rounds (especially with 3–4 players or when large center stacks overflow), up to dozens of tiles are eliminated, starving the bag refill mechanism and making the "Complete Color Set" (+10 pts) end-game bonus impossible.
* **Remediation**:
  - Update `addTilesToLine` to return an object `{ overflowCount, discarded }`.
  - In `Game.placeSelection`, collect any `discarded` array and execute `this.lid.push(...discarded)`.

---

### 3.2 Infinite Deadlock When Bag and Lid Are Depleted (Medium)
* **File**: `backend/src/models/Game.js` (lines 136–158, 243–253)
* **Rule Discrepancy**:
  In official Azul rules:
  > *"In the rare case that there are no tiles left in the bag and none in the lid, the game ends immediately."*
* **Bug Analysis**:
  - If the 100 tiles are held on walls and pattern lines such that both bag and lid are empty at the start of a round:
    - `drawTiles(4)` returns `[]`, so all factories are empty and `center` is `[]`.
    - `_isFactoryOfferOver()` would be true, but it is **only called within `placeSelection()`**.
    - Because no tiles exist anywhere on the table, neither `pickFromFactory` nor `pickFromCenter` can succeed.
* **Impact**:
  No player can make a move, and `placeSelection` is unreachable, locking the game into an unrecoverable deadlock.
* **Remediation**:
  In `startRound()`, check if all factories are empty and center is empty. If so, immediately trigger `_finishGame()`.

---

## 4. Stability & Runtime Bugs

### 4.1 Unhandled `TypeError` (HTTP 500) on Invalid or Missing `lineIndex` (High)
* **File**: `backend/src/models/Game.js` (line 233)
* **Bug Analysis**:
  ```javascript
  if (lineIndex < 0 || lineIndex > 4) throw new GameError('Invalid pattern line.');
  if (!player.canAddToLine(lineIndex, color)) { ... }
  ```
  In JavaScript:
  - `undefined < 0` is `false`
  - `undefined > 4` is `false`
  - `null < 0` is `false`
  - `"abc" < 0` is `false`
  If `lineIndex` is missing, `null`, non-integer (`1.5`), or a string, the range check passes!
  Next, `player.canAddToLine(lineIndex, color)` executes:
  ```javascript
  const line = this.patternLines[lineIndex]; // this.patternLines[undefined] is undefined
  if (line.length >= capacity) // TypeError: Cannot read properties of undefined (reading 'length')
  ```
* **Impact**:
  The controller catches this unexpected error as an internal 500 rather than a 400. Because an error is thrown before `this.pendingSelection = null;`, the player's turn remains in a pending state.
* **Remediation**:
  Explicitly validate:
  ```javascript
  if (typeof lineIndex !== 'number' || !Number.isInteger(lineIndex) || lineIndex < -1 || lineIndex > 4) {
    throw new GameError('Invalid pattern line.');
  }
  ```
  Apply similar checks to `factoryIndex` in `pickFromFactory`.

---

## 5. UI, Frontend & State Synchronization Issues

### 5.1 Socket Room Leak on "Torna alla home" (Medium)
* **Files**:
  - `frontend/public/js/main.js` (lines 268–277)
  - `backend/src/sockets/gameSocket.js` (lines 18–20)
* **Bug Analysis**:
  The backend provides a `leave-room` listener:
  ```javascript
  socket.on('leave-room', ({ gameId }) => {
    if (gameId) socket.leave(gameId);
  });
  ```
  However, in `main.js`:
  ```javascript
  document.getElementById('btn-back-home').addEventListener('click', () => {
    sessionStorage.removeItem('azul-session');
    AppState.gameId = null;
    AppState.playerId = null;
    AppState.state = null;
    AppState.prevState = null;
    AppState.chat = [];
    showView('home');
  });
  ```
  The client **never emits `leave-room`**.
* **Impact**:
  The client socket remains subscribed to the old game room. If other players take a turn or the game finishes, `socket.on('state')` fires. `onStateUpdate` executes and triggers `render()`, abruptly pulling the user off the home screen and forcing them back into the game or end screen.
* **Remediation**:
  Emit `leave-room` with `AppState.gameId` before nullifying `AppState.gameId` in `btn-back-home`.

---

### 5.2 Ghost Error Toasts on Rapid Clicks (Medium)
* **File**: `frontend/public/js/main.js` (lines 175–181)
* **Bug Analysis**:
  `doAction(fn)` lacks an in-flight guard or submission lock (`isBusy`).
  If a user double-clicks when picking or placing a tile:
  1. The first request successfully mutates the state on the server.
  2. The second request reaches the server after state transition and is rejected (e.g. `"You must place your picked tiles before picking new ones"` or `"No tiles picked up to place yet"`).
* **Impact**:
  A red error toast is displayed despite the action having succeeded, confusing the user.
* **Remediation**:
  Maintain a boolean flag `let actionInProgress = false;` in `main.js` to discard subsequent clicks until the active API request resolves.

---

### 5.3 Inability to Leave a Lobby & Abandoned Game Stalls (Low)
* **Files**:
  - `frontend/public/index.html` (lines 58–77)
  - `backend/src/models/Game.js` (line 111)
  - `frontend/public/js/api.js` (line 25)
* **Bug Analysis**:
  1. There is no "Leave Lobby" button in `view-lobby`.
  2. `Api.leaveGame` is defined in `api.js` but never used in the UI.
  3. `removePlayer(playerId)` in `Game.js` contains:
     ```javascript
     if (this.status !== 'lobby') return;
     ```
     Once a game is in progress (`status === 'playing'`), players cannot leave.
* **Impact**:
  If a player closes their tab during an active game on their turn, the match is permanently blocked. There is no AFK timer, skip turn, or forfeit mechanism.
* **Remediation**:
  - Add a "Leave" button to the waiting room.
  - Implement a turn timeout or a forfeit/kick command for disconnected players.

---

## 6. Configuration & Deployment Observations

### 6.1 Hardcoded Nginx WebSocket Upgrade Header
* **File**: `frontend/nginx.conf` (lines 19–26)
* **Observation**:
  `proxy_set_header Connection "upgrade";` is hardcoded.
  When a Socket.IO client falls back to HTTP long-polling (`transport=polling`), sending `Connection: upgrade` without an `Upgrade` header violates HTTP proxying standards and can cause proxy connection drops.
* **Remediation**:
  Use the standard Nginx mapping:
  ```nginx
  map $http_upgrade $connection_upgrade {
      default upgrade;
      ''      close;
  }
  ...
  proxy_set_header Connection $connection_upgrade;
  ```

### 6.2 Short Proxy Read Timeout
* **File**: `frontend/nginx.conf` (line 25)
* **Observation**:
  `proxy_read_timeout 60s;` can terminate connections if players ponder moves or if heartbeat timing fluctuates under latency. Increasing this to `120s` or `300s` is recommended.

### 6.3 Backend Container Runs as Root
* **File**: `backend/Dockerfile`
* **Observation**:
  The image does not specify a non-root user (`USER node`). Running containerized processes as root is a violation of the principle of least privilege.

---

## 7. Remediation Priority Checklist

- [ ] **Fix floor overflow tile leak** in `PlayerBoard.js` and `Game.js` to ensure overflow tiles enter `this.lid`.
- [x] **Implement authentication tokens** (`playerToken`) to prevent player impersonation and unauthorized game control.
- [x] **Restrict `startGame`** endpoint to verify that the requester is `game.hostId`.
- [ ] **Sanitize and validate `lineIndex` and `factoryIndex`** as strict integers to eliminate 500 TypeErrors.
- [ ] **Emit `leave-room` on socket** when navigating back home from `main.js`.
- [ ] **Add in-flight action debouncing** (`isBusy`) in `main.js` to eliminate false error toasts.
- [ ] **Implement idle game cleanup** in `GameManager.js` to prevent memory leaks.
- [ ] **Add "Leave Lobby" button** in `index.html` and wire it to `Api.leaveGame`.
- [ ] **Update Nginx configuration** for standard WebSocket upgrade mapping and increase read timeout.
