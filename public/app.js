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
let draggingPlayerId = null;

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

function cardTone(value) {
  const number = Number(value || 3);
  const pct = Math.max(0, Math.min(1, (number - 3) / 32));
  const hue = 132 - pct * 132;
  const light = 46 + (1 - Math.abs(pct - 0.5) * 2) * 4;
  return { hue, light };
}

function cardStyle(value, compact = false) {
  const { hue, light } = cardTone(value);
  const shadow = compact ? 'none' : `0 18px 42px hsla(${hue}, 82%, 24%, .35)`;
  return `background: linear-gradient(155deg, hsl(${hue}, 78%, ${light + 18}%), hsl(${hue}, 76%, ${light}%)); color: ${hue > 74 ? '#092312' : '#fff8ec'}; box-shadow: ${shadow};`;
}

function playerOrder() {
  return state?.players.map((player) => player.id) || [];
}

async function reorderPlayers(orderedIds) {
  if (!state || state.started) return;
  const res = await emitAck('lobby:reorder', { orderedIds });
  if (!res.ok) return showToast(res.error);
  if (res.state) applyState(res.state);
}

function movePlayer(id, delta) {
  const order = playerOrder();
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  reorderPlayers(order);
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
  if (state.currentCard) {
    els.currentCard.setAttribute('style', cardStyle(state.currentCard));
  } else {
    els.currentCard.removeAttribute('style');
  }
  els.pot.textContent = state.pot;
  els.cardsRemaining.textContent = `${state.cardsRemaining} carta(s)`;
  const me = state.players.find((p) => p.self || p.id === playerId());
  const isMyTurn = state.currentPlayerId === playerId();
  els.turnText.textContent = isMyTurn ? 'Sua vez!' : `Vez de ${state.currentPlayerName || '...'}`;
  els.passBtn.disabled = !isMyTurn || !me || me.chips <= 0;
  els.takeBtn.disabled = !isMyTurn;
  els.actionHint.textContent = me && me.chips <= 0 && isMyTurn ? 'Você está sem fichas, então precisa pegar a carta.' : '';

  els.players.innerHTML = state.players.map((p, index) => {
    const chipsText = p.chipsHidden ? 'fichas ocultas' : `${p.chips} ficha(s)`;
    const scoreText = p.score === null || p.score === undefined ? '— pts' : `${p.score} pts`;
    const reorderControls = state.started ? '' : `
      <div class="reorder-controls" aria-label="Reordenar ${escapeHtml(p.name)}">
        <button type="button" class="mini-action" data-move="up" data-player-id="${escapeHtml(p.id)}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="mini-action" data-move="down" data-player-id="${escapeHtml(p.id)}" ${index === state.players.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    `;
    return `
      <article class="player ${p.id === state.currentPlayerId ? 'current' : ''} ${p.self || p.id === playerId() ? 'me' : ''} ${!state.started ? 'draggable' : ''}" data-player-id="${escapeHtml(p.id)}" draggable="${!state.started}">
        <div class="player-top">
          <span class="seat-number">${index + 1}</span>
          <span class="player-name">${escapeHtml(p.name)}${p.host ? ' 👑' : ''}${p.self || p.id === playerId() ? ' · você' : ''}</span>
          <span class="score">${scoreText}</span>
        </div>
        <div class="meta">${chipsText} · ${p.connected ? 'online' : 'offline'}</div>
        <div class="cards">${p.cards.map((card) => `<span class="mini-card" style="${cardStyle(card, true)}">${card}</span>`).join('') || '<span class="muted small">sem cartas</span>'}</div>
        ${reorderControls}
      </article>
    `;
  }).join('');
  bindPlayerOrdering();

  renderRanking();
  els.log.innerHTML = state.log.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

function renderRanking() {
  if (!state?.ranking?.length) {
    els.ranking.innerHTML = '';
    return;
  }
  els.ranking.innerHTML = state.ranking.map((p, index) => {
    const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}º`;
    const winnerClass = index === 0 ? 'winner' : '';
    return `
      <li class="ranking-row ${winnerClass}">
        <span class="ranking-medal">${medal}</span>
        <span class="ranking-name">${escapeHtml(p.name)}</span>
        <span class="ranking-score">${p.score} pts</span>
        <span class="ranking-detail">${p.chips} ficha(s)</span>
      </li>
    `;
  }).join('');
}

function bindPlayerOrdering() {
  if (state?.started) return;
  for (const card of els.players.querySelectorAll('.player.draggable')) {
    card.addEventListener('dragstart', (event) => {
      draggingPlayerId = card.dataset.playerId;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggingPlayerId);
    });
    card.addEventListener('dragend', () => {
      draggingPlayerId = null;
      card.classList.remove('dragging');
      els.players.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (draggingPlayerId && draggingPlayerId !== card.dataset.playerId) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('drag-over');
      const fromId = event.dataTransfer.getData('text/plain') || draggingPlayerId;
      const toId = card.dataset.playerId;
      const order = playerOrder();
      const from = order.indexOf(fromId);
      const to = order.indexOf(toId);
      if (from < 0 || to < 0 || from === to) return;
      order.splice(to, 0, order.splice(from, 1)[0]);
      reorderPlayers(order);
    });
  }
  for (const button of els.players.querySelectorAll('[data-move]')) {
    button.addEventListener('click', () => movePlayer(button.dataset.playerId, button.dataset.move === 'up' ? -1 : 1));
  }
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
