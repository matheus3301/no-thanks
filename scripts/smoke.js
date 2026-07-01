const { io } = require('socket.io-client');

const base = process.env.SMOKE_URL || 'http://127.0.0.1:3030';
const testAvatar = 'data:image/jpeg;base64,smokeavatar';
const players = [
  { id: 'smoke-a', name: 'Smoke A' },
  { id: 'smoke-b', name: 'Smoke B' },
  { id: 'smoke-c', name: 'Smoke C' },
];

function connect(player) {
  const socket = io(base, {
    reconnection: false,
    timeout: 2000,
    ackTimeout: 2500,
    retries: 1,
  });
  socket.player = player;
  socket.on('connect_error', (err) => {
    console.error(`${player.name} connect_error`, err.message);
  });
  return socket;
}

function waitConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, { ...payload, playerId: socket.player.id }, (err, response) => {
    if (err) return resolve({ ok: false, error: err.message || String(err) });
    resolve(response);
  }));
}

(async () => {
  const sockets = players.map(connect);
  await Promise.all(sockets.map(waitConnect));

  const create = await emitAck(sockets[0], 'room:create', { name: players[0].name, avatar: testAvatar });
  if (!create.ok) throw new Error(create.error);
  const code = create.code;

  for (let i = 1; i < sockets.length; i += 1) {
    const join = await emitAck(sockets[i], 'room:join', { code, name: players[i].name, avatar: testAvatar });
    if (!join.ok) throw new Error(join.error);
  }

  const start = await emitAck(sockets[0], 'game:start', {});
  if (!start.ok) throw new Error(start.error);

  let latestByPlayer = new Map();
  for (const socket of sockets) socket.on('room:update', (state) => { latestByPlayer.set(socket.player.id, state); });
  await new Promise((r) => setTimeout(r, 250));
  const anaView = latestByPlayer.get(players[0].id) || start.state;
  if (!anaView?.started || !anaView.currentPlayerId || !anaView.currentCard) throw new Error('game did not start');

  const self = anaView.players.find((p) => p.id === players[0].id);
  const other = anaView.players.find((p) => p.id === players[1].id);
  if (self.chips === null || self.chipsHidden) throw new Error('own chips are hidden');
  if (self.avatar !== testAvatar) throw new Error('own avatar missing');
  if (other.chips !== null || !other.chipsHidden || other.score !== null) throw new Error('other player chips/score leaked');

  const currentSocket = sockets.find((socket) => socket.player.id === anaView.currentPlayerId);
  const action = await emitAck(currentSocket, 'game:take', {});
  if (!action.ok) throw new Error(action.error);
  await new Promise((r) => setTimeout(r, 150));
  const after = latestByPlayer.get(currentSocket.player.id) || action.state;
  if (!after.cardsRemaining || after.players.every((p) => p.cards.length === 0)) throw new Error('take action did not update state');

  const stateRes = await fetch(`${base}/api/rooms/${code}/state?playerId=${players[1].id}`);
  const stateBody = await stateRes.json();
  if (!stateBody.ok || !stateBody.state.version) throw new Error('polling state endpoint failed');

  sockets.forEach((socket) => socket.close());
  console.log(`smoke ok: room ${code}, players ${after.players.length}, version ${after.version}, cardsRemaining ${after.cardsRemaining}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
