const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2500,
  timeout: 5000,
  ackTimeout: 3500,
  retries: 2,
});
let state = null;
let polling = null;

const $ = (id) => document.getElementById(id);
const els = {
  entry: $('entry'), room: $('room'), lobby: $('lobby'), game: $('game'), result: $('result'),
  name: $('name'), roomCode: $('roomCode'), entryError: $('entryError'), createBtn: $('createBtn'), joinBtn: $('joinBtn'),
  codeText: $('codeText'), statusText: $('statusText'), qr: $('qr'), shareLink: $('shareLink'), startBtn: $('startBtn'), copyBtn: $('copyBtn'),
  currentCard: $('currentCard'), pot: $('pot'), turnText: $('turnText'), passBtn: $('passBtn'), takeBtn: $('takeBtn'), actionHint: $('actionHint'),
  players: $('players'), cardsRemaining: $('cardsRemaining'), ranking: $('ranking'), log: $('log'), toast: $('toast'),
};

function playerId() {
  let id = localStorage.getItem('nt-player-id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('nt-player-id', id);
  }
  return id;
}

function nameValue() {
  return els.name.value.trim() || localStorage.getItem('nt-name') || 'Jogador';
}

function activeCode() {
  return state?.code || new URLSearchParams(location.search).get('room') || els.roomCode.value;
}

function roomUrl(code = activeCode()) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(code || '')}`;
}

function setError(text = '') { els.entryError.textContent = text; }

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('hidden'), 2800);
}

function applyState(nextState) {
  if (!nextState) return;
  if (state && nextState.code === state.code && Number(nextState.version || 0) < Number(state.version || 0)) return;
  state = nextState;
  render();
  ensurePolling();
}

function emitAck(event, payload = {}, tries = 3) {
  const request = { ...payload, playerId: playerId() };
  return new Promise((resolve) => {
    let attempt = 0;
    const send = () => {
      attempt += 1;
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        if (attempt < tries) return send();
        resolve({ ok: false, error: 'Conexão instável. Tente de novo em alguns segundos.' });
      }, 3500);

      socket.emit(event, request, (err, response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err && attempt < tries) return send();
        if (err) return resolve({ ok: false, error: 'Conexão instável. Tente de novo em alguns segundos.' });
        if (!response?.ok && attempt < tries && /timeout|transport|network/i.test(String(response?.error || ''))) return send();
        resolve(response || { ok: false, error: 'Resposta inválida do servidor.' });
      });
    };
    send();
  });
}

async function createRoom() {
  setError('');
  localStorage.setItem('nt-name', nameValue());
  const res = await emitAck('room:create', { name: nameValue() });
  if (!res.ok) return setError(res.error);
  history.replaceState(null, '', `?room=${res.code}`);
  applyState(res.state);
}

async function joinRoom(code = els.roomCode.value) {
  setError('');
  localStorage.setItem('nt-name', nameValue());
  const res = await emitAck('room:join', { code, name: nameValue() });
  if (!res.ok) return setError(res.error);
  history.replaceState(null, '', `?room=${res.code}`);
  applyState(res.state);
}

async function simpleAction(event) {
  const res = await emitAck(event, {});
  if (!res.ok) return showToast(res.error);
  if (res.state) applyState(res.state);
}

async function fetchState() {
  const code = activeCode();
  if (!code) return;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/state?playerId=${encodeURIComponent(playerId())}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) applyState(data.state);
  } catch (_error) {
    // Polling is a safety net; socket reconnect will also retry.
  }
}

function ensurePolling() {
  if (polling) return;
  polling = setInterval(fetchState, 1500);
}

function render() {
  if (!state) return;
  els.entry.classList.add('hidden');
  els.room.classList.remove('hidden');
  els.codeText.textContent = state.code;
  els.qr.src = `/qr/${state.code}`;
  els.shareLink.href = roomUrl();
  els.shareLink.textContent = roomUrl();
  els.statusText.textContent = state.ended ? 'Partida encerrada' : state.started ? `Vez de ${state.currentPlayerName}` : 'Aguardando jogadores';
  els.lobby.classList.toggle('hidden', state.started);
  els.game.classList.toggle('hidden', !state.started || state.ended);
  els.result.classList.toggle('hidden', !state.ended);
  els.startBtn.disabled = !state.canStart;
  els.startBtn.textContent = 'Iniciar partida';

  els.currentCard.textContent = state.currentCard || '?';
  els.pot.textContent = state.pot;
  els.cardsRemaining.textContent = `${state.cardsRemaining} carta(s)`;
  const me = state.players.find((p) => p.self || p.id === playerId());
  const isMyTurn = state.currentPlayerId === playerId();
  els.turnText.textContent = isMyTurn ? 'Sua vez!' : `Vez de ${state.currentPlayerName || '...'}`;
  els.passBtn.disabled = !isMyTurn || !me || me.chips <= 0;
  els.takeBtn.disabled = !isMyTurn;
  els.actionHint.textContent = me && me.chips <= 0 && isMyTurn ? 'Você está sem fichas, então precisa pegar a carta.' : '';

  els.players.innerHTML = state.players.map((p) => {
    const chipsText = p.chipsHidden ? 'fichas ocultas' : `${p.chips} ficha(s)`;
    const scoreText = p.score === null || p.score === undefined ? '— pts' : `${p.score} pts`;
    return `
      <article class="player ${p.id === state.currentPlayerId ? 'current' : ''} ${p.self || p.id === playerId() ? 'me' : ''}">
        <div class="player-top">
          <span class="player-name">${escapeHtml(p.name)}${p.host ? ' 👑' : ''}${p.self || p.id === playerId() ? ' · você' : ''}</span>
          <span class="score">${scoreText}</span>
        </div>
        <div class="meta">${chipsText} · ${p.connected ? 'online' : 'offline'}</div>
        <div class="cards">${p.cards.map((card) => `<span class="mini-card">${card}</span>`).join('') || '<span class="muted small">sem cartas</span>'}</div>
      </article>
    `;
  }).join('');

  els.ranking.innerHTML = state.ranking.map((p) => `<li><strong>${escapeHtml(p.name)}</strong> — ${p.score} pontos (${p.chips} fichas)</li>`).join('');
  els.log.innerHTML = state.log.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

els.createBtn.addEventListener('click', createRoom);
els.joinBtn.addEventListener('click', () => joinRoom());
els.startBtn.addEventListener('click', () => simpleAction('game:start'));
els.passBtn.addEventListener('click', () => simpleAction('game:pass'));
els.takeBtn.addEventListener('click', () => simpleAction('game:take'));
els.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomUrl());
  showToast('Link copiado.');
});
els.roomCode.addEventListener('input', () => { els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
els.name.value = localStorage.getItem('nt-name') || '';

socket.on('connect', async () => {
  const code = activeCode();
  if (code && state) {
    const res = await emitAck('room:join', { code, name: nameValue() });
    if (res.ok) applyState(res.state);
  } else if (code && !state) {
    els.roomCode.value = code.toUpperCase();
    await joinRoom(code);
  }
  fetchState();
});
socket.on('disconnect', () => showToast('Reconectando...'));
socket.on('room:update', applyState);
socket.on('toast', ({ message }) => showToast(message));

const initialCode = new URLSearchParams(location.search).get('room');
if (initialCode) {
  els.roomCode.value = initialCode.toUpperCase();
}
