const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const {
  createRoom,
  addPlayer,
  startGame,
  passCard,
  takeCard,
  disconnectPlayer,
  serialize,
  makeCode,
} = require('./game');

const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
});
const rooms = new Map();
const socketRoom = new Map();
const socketPlayer = new Map();

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get('/api/rooms/:code/state', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const playerId = String(req.query.playerId || '').trim();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false, error: 'Mesa não encontrada.' });
  return res.json({ ok: true, state: serialize(room, playerId) });
});

app.get('/qr/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const baseUrl = publicBaseUrl(req);
  const url = `${baseUrl}/?room=${encodeURIComponent(code)}`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 360 });
    res.type('image/svg+xml').send(svg);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

function localIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function publicBaseUrl(req) {
  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}`;
}

function emitRoom(room) {
  const sockets = io.sockets.adapter.rooms.get(room.code) || new Set();
  for (const socketId of sockets) {
    const playerId = socketPlayer.get(socketId);
    io.to(socketId).emit('room:update', serialize(room, playerId));
  }
}

function sendError(socket, message) {
  socket.emit('toast', { type: 'error', message });
}

function identify(socket, payload = {}) {
  const playerId = String(payload.playerId || socketPlayer.get(socket.id) || '').trim();
  if (!playerId) throw new Error('Sessão do jogador não identificada. Recarregue a página.');
  socketPlayer.set(socket.id, playerId);
  return playerId;
}

function attachSocket(socket, roomCode, playerId) {
  socket.join(roomCode);
  socketRoom.set(socket.id, roomCode);
  socketPlayer.set(socket.id, playerId);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, playerId }, ack = () => {}) => {
    try {
      const id = identify(socket, { playerId });
      let code;
      do {
        code = makeCode();
      } while (rooms.has(code));
      const room = createRoom(id, name, code);
      rooms.set(code, room);
      attachSocket(socket, code, id);
      ack({ ok: true, code, state: serialize(room, id), version: room.version });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', ({ code, name, playerId }, ack = () => {}) => {
    try {
      const id = identify(socket, { playerId });
      const roomCode = String(code || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) throw new Error('Mesa não encontrada. Confere o código/QR.');
      const hadPlayer = room.players.some((player) => player.id === id);
      addPlayer(room, id, name);
      attachSocket(socket, roomCode, id);
      if (!hadPlayer) {
        room.log.push(`${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${name || 'Jogador'} entrou na mesa.`);
        room.version += 1;
      }
      ack({ ok: true, code: roomCode, state: serialize(room, id), version: room.version });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('sync:state', ({ code, playerId }, ack = () => {}) => {
    try {
      const id = identify(socket, { playerId });
      const roomCode = String(code || socketRoom.get(socket.id) || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) throw new Error('Mesa não encontrada.');
      attachSocket(socket, roomCode, id);
      ack({ ok: true, state: serialize(room, id), version: room.version });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('game:start', (payload = {}, ack = () => {}) => {
    try {
      const playerId = identify(socket, payload);
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) throw new Error('Você não está em uma mesa.');
      startGame(room, playerId);
      ack({ ok: true, version: room.version, state: serialize(room, playerId) });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: error.message });
      sendError(socket, error.message);
    }
  });

  socket.on('game:pass', (payload = {}, ack = () => {}) => {
    try {
      const playerId = identify(socket, payload);
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) throw new Error('Você não está em uma mesa.');
      passCard(room, playerId);
      ack({ ok: true, version: room.version, state: serialize(room, playerId) });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: error.message });
      sendError(socket, error.message);
    }
  });

  socket.on('game:take', (payload = {}, ack = () => {}) => {
    try {
      const playerId = identify(socket, payload);
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) throw new Error('Você não está em uma mesa.');
      takeCard(room, playerId);
      ack({ ok: true, version: room.version, state: serialize(room, playerId) });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: error.message });
      sendError(socket, error.message);
    }
  });

  socket.on('disconnect', () => {
    const code = socketRoom.get(socket.id);
    const playerId = socketPlayer.get(socket.id);
    const room = rooms.get(code);
    socketRoom.delete(socket.id);
    socketPlayer.delete(socket.id);
    if (!room || !playerId) return;
    const stillConnected = [...(io.sockets.adapter.rooms.get(code) || [])]
      .some((socketId) => socketPlayer.get(socketId) === playerId);
    if (!stillConnected) disconnectPlayer(room, playerId);
    emitRoom(room);
  });
});

server.listen(PORT, HOST, () => {
  const ips = localIps();
  console.log(`No Thanks web rodando em http://127.0.0.1:${PORT}`);
  for (const ip of ips) console.log(`LAN: http://${ip}:${PORT}`);
});
