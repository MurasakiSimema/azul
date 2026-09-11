# Info sugli obbiettivi

Questo progetto è stato pensato per testare il vibe-coding su progetti piccoli, ma con regole precise. (Obbiettivo bonus: avere qualcosa da fare con le persone a me care mentre sono lontano da casa)

# Azul — Web App (frontend + backend, MVC, Docker)

Implementazione completa del gioco da tavolo **Azul** (regole base, 2–4 giocatori),
giocabile in tempo reale nel browser. Architettura a due servizi separati
(frontend / backend), backend organizzato secondo il pattern **MVC**.

## Architettura

```
azul-app/
├── docker-compose.yml
├── backend/                    # Node.js + Express + Socket.IO — API e motore di gioco
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── models/             # MODEL — stato e regole del gioco
│       │   ├── Tile.js         #   colori, pattern del muro, penalità fila scarti
│       │   ├── PlayerBoard.js  #   plancia di un giocatore (righe, muro, fila scarti, punteggio)
│       │   └── Game.js         #   partita: fabbriche, centro, sacchetto, turni, fasi, fine partita
│       ├── controllers/        # CONTROLLER — traduce le richieste HTTP in azioni sul Model
│       │   └── gameController.js
│       ├── routes/             # definizione degli endpoint REST
│       │   └── gameRoutes.js
│       ├── services/           # gestione delle partite in memoria (repository dei Game)
│       │   └── GameManager.js
│       ├── sockets/            # Socket.IO: notifica in tempo reale i client dello stato
│       │   └── gameSocket.js
│       └── server.js           # bootstrap Express + Socket.IO
│
└── frontend/                   # Nginx + HTML/CSS/JS statico — VIEW + client-side controller
    ├── Dockerfile
    ├── nginx.conf              # serve i file statici e fa da reverse proxy verso /api e /socket.io
    └── public/
        ├── index.html          # VIEW — struttura delle schermate (lobby, partita, fine partita)
        ├── css/style.css
        └── js/
            ├── api.js          # client REST verso il backend
            ├── render.js       # VIEW — funzioni di rendering DOM a partire dallo stato
            └── main.js         # CONTROLLER lato client — instrada eventi UI/socket verso api.js e render.js
```

Il **Model** (in `backend/src/models`) contiene tutta la logica del gioco (Factory
offer, Wall-tiling, punteggio, fila scarti, fine partita, bonus finali) ed è
completamente indipendente da HTTP/Socket.IO. Il **Controller**
(`gameController.js`) valida le richieste ed invoca il Model, poi notifica tutti
i client connessi alla partita via Socket.IO. Le **View** vivono nel frontend:
`index.html` definisce la struttura, `render.js` disegna lo stato ricevuto dal
server, `main.js` fa da controller lato client (gestisce eventi utente e
aggiornamenti realtime).

## Regole implementate

- Setup per 2/3/4 giocatori (5/7/9 fabbriche), sacchetto da 100 tessere.
- Fase *Factory offer*: prelievo da una fabbrica o dal centro, segnalino primo
  giocatore, posizionamento sulle righe pattern o sulla fila scarti, con tutti i
  vincoli del regolamento (colore già presente sulla riga del muro, colore
  unico per riga pattern, ecc.).
- Fase *Wall-tiling* automatica a fine round: spostamento tessere sul muro,
  punteggio per adiacenze orizzontali/verticali, penalità della fila scarti,
  rifornimento sacchetto dagli scarti.
- Fine partita alla prima riga orizzontale completata, con bonus finali
  (righe orizzontali, colonne verticali, colori completi) e gestione dei
  pareggi.

*(La variante con il lato grigio della plancia non è inclusa in questa versione.)*

## Avvio con Docker

Dalla cartella:

```bash
docker compose up --build
```

- Frontend disponibile su **http://localhost:8080**
- Il backend (porta 4000) non è esposto sull'host: il frontend lo raggiunge
  internamente via Nginx (`/api/*` e `/socket.io/*`), sulla rete Docker interna
  creata automaticamente da Compose (`backend:4000`).

Per fermare tutto: `docker compose down`.

## Come si gioca online

1. Un giocatore apre `http://localhost:8080`, inserisce il proprio nome e clicca
   **"Crea partita"**: ottiene un codice di 8 caratteri.
2. Gli altri giocatori (2–4 in totale) aprono lo stesso indirizzo, inseriscono
   il codice e il proprio nome, e cliccano **"Unisciti"**.
3. L'host clicca **"Inizia la partita"** quando ci sono almeno 2 giocatori.
4. A turno: si clicca una tessera su una fabbrica o nel centro, poi si sceglie
   la riga pattern (o la fila scarti) dove posizionarla. Lo stato si aggiorna
   in tempo reale per tutti tramite Socket.IO.

## Sviluppo locale senza Docker

```bash
# backend
cd backend
npm install
npm start          # http://localhost:4000

# frontend (in un altro terminale, richiede un semplice server statico)
cd frontend/public
npx serve -l 8080   # oppure qualunque server statico
```

In locale senza Nginx come reverse proxy, apri `frontend/public/js/api.js`
e imposta `window.API_BASE_URL` (es. in una riga `<script>` prima di
`api.js` in `index.html`) su `http://localhost:4000`, e collega Socket.IO
allo stesso host in `main.js` (`io("http://localhost:4000")`).
