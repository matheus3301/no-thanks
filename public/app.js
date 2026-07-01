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
let cameraStream = null;

const $ = (id) => document.getElementById(id);
const els = {
  entry: $('entry'), room: $('room'), lobby: $('lobby'), game: $('game'), result: $('result'),
  name: $('name'), roomCode: $('roomCode'), entryError: $('entryError'), createBtn: $('createBtn'), joinBtn: $('joinBtn'),
  avatarPreview: $('avatarPreview'), photoBtn: $('photoBtn'), clearPhotoBtn: $('clearPhotoBtn'), cameraPanel: $('cameraPanel'), cameraPreview: $('cameraPreview'), captureBtn: $('captureBtn'), photoCanvas: $('photoCanvas'),
  codeText: $('codeText'), statusText: $('statusText'), qr: $('qr'), shareLink: $('shareLink'), startBtn: $('startBtn'), copyBtn: $('copyBtn'), roomPhotoBtn: $('roomPhotoBtn'),
  currentCard: $('currentCard'), pot: $('pot'), turnText: $('turnText'), passBtn: $('passBtn'), takeBtn: $('takeBtn'), actionHint: $('actionHint'),
  players: $('players'), cardsRemaining: $('cardsRemaining'), ranking: $('ranking'), podium: $('podium'), downloadResultBtn: $('downloadResultBtn'), log: $('log'), toast: $('toast'),
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

function avatarValue() {
  return localStorage.getItem('nt-avatar') || '';
}

function avatarMarkup(player, size = '') {
  const classes = ['avatar'];
  if (size) classes.push(size);
  if (player?.avatar) return `<img class="${classes.join(' ')}" src="${player.avatar}" alt="Avatar de ${escapeHtml(player.name || 'jogador')}" />`;
  const initial = escapeHtml((player?.name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="${classes.join(' ')} avatar-fallback">${initial}</span>`;
}

function updateAvatarPreview() {
  const avatar = avatarValue();
  if (avatar) {
    els.avatarPreview.innerHTML = `<img src="${avatar}" alt="Seu avatar" />`;
  } else {
    els.avatarPreview.textContent = '🙂';
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Câmera não disponível nesse navegador.');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    els.cameraPreview.srcObject = cameraStream;
    els.cameraPanel.classList.remove('hidden');
  } catch (_error) {
    showToast('Não consegui acessar a câmera. Verifique a permissão do navegador.');
  }
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  els.cameraPreview.srcObject = null;
  els.cameraPanel.classList.add('hidden');
}

async function captureAvatar() {
  if (!cameraStream) return startCamera();
  const video = els.cameraPreview;
  const canvas = els.photoCanvas;
  const size = 240;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const sourceSize = Math.min(video.videoWidth || size, video.videoHeight || size);
  const sx = ((video.videoWidth || size) - sourceSize) / 2;
  const sy = ((video.videoHeight || size) - sourceSize) / 2;
  ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  localStorage.setItem('nt-avatar', dataUrl);
  updateAvatarPreview();
  stopCamera();
  if (state) {
    const res = await emitAck('player:avatar', { avatar: dataUrl });
    if (!res.ok) return showToast(res.error);
    if (res.state) applyState(res.state);
  }
}

async function clearAvatar() {
  localStorage.removeItem('nt-avatar');
  updateAvatarPreview();
  if (state) showToast('Foto removida localmente. Tire outra foto para atualizar na mesa.');
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
  const res = await emitAck('room:create', { name: nameValue(), avatar: avatarValue() });
  if (!res.ok) return setError(res.error);
  history.replaceState(null, '', `?room=${res.code}`);
  applyState(res.state);
}

async function joinRoom(code = els.roomCode.value) {
  setError('');
  localStorage.setItem('nt-name', nameValue());
  const res = await emitAck('room:join', { code, name: nameValue(), avatar: avatarValue() });
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
          ${avatarMarkup(p, 'small')}
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
    els.podium.innerHTML = '';
    return;
  }
  renderPodium();
  els.ranking.innerHTML = state.ranking.map((p, index) => {
    const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}º`;
    const winnerClass = index === 0 ? 'winner' : '';
    return `
      <li class="ranking-row ${winnerClass}">
        <span class="ranking-medal">${medal}</span>
        ${avatarMarkup(p, 'small')}
        <span class="ranking-name">${escapeHtml(p.name)}</span>
        <span class="ranking-score">${p.score} pts</span>
        <span class="ranking-detail">${p.chips} ficha(s)</span>
      </li>
    `;
  }).join('');
}

function renderPodium() {
  const top = state.ranking.slice(0, 3);
  const slots = [top[1], top[0], top[2]].filter(Boolean);
  const placeForIndex = (player) => state.ranking.findIndex((p) => p.id === player.id) + 1;
  els.podium.innerHTML = slots.map((p) => {
    const place = placeForIndex(p);
    return `
      <article class="podium-player place-${place}">
        <div class="podium-medal">${place === 1 ? '🏆' : place === 2 ? '🥈' : '🥉'}</div>
        ${avatarMarkup(p, 'podium-avatar')}
        <div class="podium-name">${escapeHtml(p.name)}</div>
        <div class="podium-score">${p.score} pts</div>
        <div class="podium-step">${place}º</div>
      </article>
    `;
  }).join('');
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function downloadResultImage() {
  if (!state?.ranking?.length) return showToast('Resultado ainda não disponível.');
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#2a1723');
  gradient.addColorStop(0.5, '#120f17');
  gradient.addColorStop(1, '#3a1b0f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffbd59';
  ctx.font = '900 42px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NO THANKS', 540, 105);
  ctx.fillStyle = '#fff8ec';
  ctx.font = '1000 70px system-ui, sans-serif';
  ctx.fillText('Resultado final', 540, 185);

  const podium = [state.ranking[1], state.ranking[0], state.ranking[2]].filter(Boolean);
  const positions = [{ x: 260, y: 610, h: 250 }, { x: 540, y: 500, h: 360 }, { x: 820, y: 660, h: 200 }];
  for (let i = 0; i < podium.length; i += 1) {
    const p = podium[i];
    const place = state.ranking.findIndex((ranked) => ranked.id === p.id) + 1;
    const pos = positions[i];
    ctx.fillStyle = place === 1 ? '#ffbd59' : place === 2 ? '#d7dee8' : '#c9864a';
    ctx.beginPath();
    ctx.roundRect(pos.x - 105, pos.y + 145, 210, pos.h, 28);
    ctx.fill();
    ctx.fillStyle = '#2b1605';
    ctx.font = '1000 64px system-ui, sans-serif';
    ctx.fillText(`${place}º`, pos.x, pos.y + 285);

    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 94, 0, Math.PI * 2);
    ctx.clip();
    const img = await loadImage(p.avatar);
    if (img) ctx.drawImage(img, pos.x - 94, pos.y - 94, 188, 188);
    else {
      ctx.fillStyle = '#ffffff22';
      ctx.fillRect(pos.x - 94, pos.y - 94, 188, 188);
      ctx.fillStyle = '#fff8ec';
      ctx.font = '1000 76px system-ui, sans-serif';
      ctx.fillText((p.name || '?').charAt(0).toUpperCase(), pos.x, pos.y + 26);
    }
    ctx.restore();
    ctx.strokeStyle = '#fff8ec';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff8ec';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText(p.name, pos.x, pos.y + 138);
    ctx.fillStyle = '#c9bdad';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText(`${p.score} pontos`, pos.x, pos.y + 178);
  }

  ctx.fillStyle = '#fff8ec';
  ctx.font = '800 30px system-ui, sans-serif';
  state.ranking.slice(0, 7).forEach((p, index) => {
    ctx.textAlign = 'left';
    ctx.fillText(`${index + 1}. ${p.name}`, 170, 1070 + index * 44);
    ctx.textAlign = 'right';
    ctx.fillText(`${p.score} pts`, 910, 1070 + index * 44);
  });

  const link = document.createElement('a');
  link.download = `no-thanks-${state.code}-resultado.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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
els.photoBtn.addEventListener('click', startCamera);
els.roomPhotoBtn.addEventListener('click', startCamera);
els.captureBtn.addEventListener('click', captureAvatar);
els.clearPhotoBtn.addEventListener('click', clearAvatar);
els.downloadResultBtn.addEventListener('click', downloadResultImage);
els.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomUrl());
  showToast('Link copiado.');
});
els.roomCode.addEventListener('input', () => { els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
els.name.value = localStorage.getItem('nt-name') || '';
updateAvatarPreview();

socket.on('connect', async () => {
  const code = activeCode();
  if (code && state) {
    const res = await emitAck('room:join', { code, name: nameValue(), avatar: avatarValue() });
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
