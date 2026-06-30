const { io } = require('socket.io-client');

const base = process.env.SMOKE_URL || 'http://127.0.0.1:3030';
const players = [
  { id: `sync-a-${Date.now()}`, name: 'Sync A' },
  { id: `sync-b-${Date.now()}`, name: 'Sync B' },
  { id: `sync-c-${Date.now()}`, name: 'Sync C' },
];

function connect(player) {
  const socket = io(base, {
    reconnection: false,
    timeout: 3000,
    transports: ['websocket', 'polling'],
  });
  socket.player = player;
  socket.states = [];
  socket.on('room:update', (state) => socket.states.push(state));
  return socket;
}

function waitConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error(`${socket.player.name} connect timeout`)), 5000);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, { ...payload, playerId: socket.player.id }, resolve));
}

function waitFor(socket, predicate, label, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const last = socket.states.at(-1);
      if (last && predicate(last)) return resolve(last);
      return null;
    };
    if (check()) return;
    const interval = setInterval(() => {
      if (check()) {
        clearInterval(interval);
        clearTimeout(timer);
      }
    }, 50);
    const timer = setTimeout(() => {
      clearInterval(interval);
      const last = socket.states.at(-1);
      reject(new Error(`${label} timed out. Last state: ${JSON.stringify(last)}`));
    }, timeout);
  });
}

(async () => {
  const [host, b, c] = players.map(connect);
  await waitConnect(host);
  const created = await emitAck(host, 'room:create', { name: host.player.name });
  if (!created?.ok) throw new Error(`create failed: ${created?.error || JSON.stringify(created)}`);
  const code = created.code;
  await waitFor(host, (state) => state.players.length === 1, 'host sees itself');

  await waitConnect(b);
  const joinedB = await emitAck(b, 'room:join', { code, name: b.player.name });
  if (!joinedB?.ok) throw new Error(`join B failed: ${joinedB?.error || JSON.stringify(joinedB)}`);
  const hostAfterB = await waitFor(host, (state) => state.players.some((p) => p.name === b.player.name), 'host sees B join');
  const bAfterB = await waitFor(b, (state) => state.players.length === 2, 'B sees host');

  await waitConnect(c);
  const joinedC = await emitAck(c, 'room:join', { code, name: c.player.name });
  if (!joinedC?.ok) throw new Error(`join C failed: ${joinedC?.error || JSON.stringify(joinedC)}`);
  const all = await Promise.all([
    waitFor(host, (state) => state.players.length === 3, 'host sees 3'),
    waitFor(b, (state) => state.players.length === 3, 'B sees 3'),
    waitFor(c, (state) => state.players.length === 3, 'C sees 3'),
  ]);

  for (const socket of [host, b, c]) socket.close();
  console.log(`join sync ok via ${base}: room ${code}; hostAfterB=${hostAfterB.players.length}; bAfterB=${bAfterB.players.length}; all=${all.map((s) => s.players.length).join('/')}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
