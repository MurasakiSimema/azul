'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const gameRoutes = require('./routes/gameRoutes');
const registerGameSocket = require('./sockets/gameSocket');

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'azul-backend' }));
app.use('/api', gameRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});
app.set('io', io);

registerGameSocket(io);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Azul backend listening on port ${PORT}`);
});
