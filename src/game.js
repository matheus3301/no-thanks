const CARD_MIN = 3;
const CARD_MAX = 35;
const REMOVED_CARDS = 9;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 7;

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startingChips(playerCount) {
  if (playerCount >= 7) return 7;
  if (playerCount === 6) return 9;
  return 11;
}

function createDeck() {
  const cards = [];
  for (let value = CARD_MIN; value <= CARD_MAX; value += 1) cards.push(value);
  const shuffled = shuffle(cards);
  return shuffled.slice(REMOVED_CARDS);
}

function publicPlayer(player, viewerId, ended = false) {
  const isSelf = player.id === viewerId;
  const showPrivate = isSelf || ended;
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar || null,
    chips: showPrivate ? player.chips : null,
    chipsHidden: !showPrivate,
    cards: [...player.cards].sort((a, b) => a - b),
    score: showPrivate ? scorePlayer(player) : null,
    connected: player.connected,
    host: player.host,
    self: isSelf,
  };
}

function scoreCards(cards) {
  const sorted = [...new Set(cards)].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i === 0 || sorted[i] !== sorted[i - 1] + 1) total += sorted[i];
  }
  return total;
}

function scorePlayer(player) {
  return scoreCards(player.cards) - player.chips;
}

function sanitizeAvatar(avatar) {
  if (!avatar) return null;
  const value = String(avatar);
  if (!value.startsWith('data:image/')) return null;
  if (value.length > 180_000) return null;
  return value;
}

function currentPlayer(room) {
  if (!room.started || room.ended || room.players.length === 0) return null;
  return room.players[room.currentPlayerIndex % room.players.length];
}

function serialize(room, viewerId = null) {
  const current = currentPlayer(room);
  const players = room.players.map((player) => publicPlayer(player, viewerId, room.ended));
  const ranking = room.ended
    ? [...room.players]
      .map((player) => publicPlayer(player, viewerId, true))
      .sort((a, b) => a.score - b.score || b.chips - a.chips || a.name.localeCompare(b.name))
    : [];
  return {
    code: room.code,
    version: room.version,
    started: room.started,
    ended: room.ended,
    players,
    ranking,
    hostId: room.hostId,
    currentPlayerId: current?.id || null,
    currentPlayerName: current?.name || null,
    currentCard: room.currentCard,
    pot: room.pot,
    cardsRemaining: room.deck.length + (room.currentCard ? 1 : 0),
    log: room.log.slice(-12),
    canStart: !room.started && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  };
}

function addLog(room, text) {
  const at = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  room.log.push(`${at} · ${text}`);
}

function markChanged(room) {
  room.version = (room.version || 0) + 1;
}

function drawNext(room) {
  room.currentCard = room.deck.shift() || null;
  room.pot = 0;
  if (!room.currentCard) {
    room.ended = true;
    addLog(room, 'Fim de jogo. Menor pontuação vence.');
  }
}

function createRoom(hostId, hostName, code = makeCode(), avatar = null) {
  const room = {
    code,
    version: 1,
    hostId,
    started: false,
    ended: false,
    players: [],
    deck: [],
    currentCard: null,
    pot: 0,
    currentPlayerIndex: 0,
    log: [],
  };
  addPlayer(room, hostId, hostName, true, avatar);
  addLog(room, `${hostName} criou a mesa.`);
  markChanged(room);
  return room;
}

function addPlayer(room, id, name, host = false, avatar = null) {
  const existing = room.players.find((player) => player.id === id);
  if (existing) {
    existing.connected = true;
    if (name) existing.name = String(name).trim().slice(0, 24) || existing.name;
    const cleanAvatar = sanitizeAvatar(avatar);
    if (cleanAvatar) existing.avatar = cleanAvatar;
    if (host) {
      existing.host = true;
      room.hostId = id;
    }
    markChanged(room);
    return existing;
  }
  if (room.started) throw new Error('A partida já começou.');
  if (room.players.length >= MAX_PLAYERS) throw new Error('Mesa cheia.');
  const safeName = String(name || 'Jogador').trim().slice(0, 24) || 'Jogador';
  const player = { id, name: safeName, avatar: sanitizeAvatar(avatar), chips: 0, cards: [], connected: true, host };
  room.players.push(player);
  if (host) room.hostId = id;
  markChanged(room);
  return player;
}

function startGame(room, requesterId) {
  if (!room.players.some((player) => player.id === requesterId && player.connected)) throw new Error('Você não está nesta mesa.');
  if (room.started) throw new Error('A partida já começou.');
  if (room.players.length < MIN_PLAYERS) throw new Error(`Precisa de pelo menos ${MIN_PLAYERS} jogadores.`);
  if (room.players.length > MAX_PLAYERS) throw new Error(`Máximo de ${MAX_PLAYERS} jogadores.`);

  const chips = startingChips(room.players.length);
  room.players.forEach((player) => {
    player.chips = chips;
    player.cards = [];
  });
  room.deck = createDeck();
  room.currentPlayerIndex = Math.floor(Math.random() * room.players.length);
  room.started = true;
  room.ended = false;
  drawNext(room);
  addLog(room, `Partida iniciada com ${room.players.length} jogadores e ${chips} fichas cada.`);
  markChanged(room);
}

function assertTurn(room, playerId) {
  if (!room.started || room.ended) throw new Error('A partida não está ativa.');
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) throw new Error('Ainda não é sua vez.');
  return player;
}

function passCard(room, playerId) {
  const player = assertTurn(room, playerId);
  if (player.chips <= 0) throw new Error('Sem fichas: você precisa pegar a carta.');
  player.chips -= 1;
  room.pot += 1;
  addLog(room, `${player.name} disse “não, valeu” e colocou 1 ficha.`);
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  markChanged(room);
}

function takeCard(room, playerId) {
  const player = assertTurn(room, playerId);
  const card = room.currentCard;
  player.cards.push(card);
  player.chips += room.pot;
  addLog(room, `${player.name} pegou a carta ${card} e ${room.pot} ficha(s).`);
  room.currentPlayerIndex = room.players.findIndex((p) => p.id === player.id);
  drawNext(room);
  markChanged(room);
}

function reorderPlayers(room, requesterId, orderedIds) {
  if (!room.players.some((player) => player.id === requesterId && player.connected)) throw new Error('Você não está nesta mesa.');
  if (room.started) throw new Error('A ordem só pode ser alterada antes da partida começar.');
  if (!Array.isArray(orderedIds)) throw new Error('Ordem inválida.');
  const existingIds = room.players.map((player) => player.id);
  const uniqueIds = [...new Set(orderedIds)];
  if (uniqueIds.length !== existingIds.length) throw new Error('Ordem incompleta.');
  if (!existingIds.every((id) => uniqueIds.includes(id))) throw new Error('Ordem contém jogadores inválidos.');
  const byId = new Map(room.players.map((player) => [player.id, player]));
  room.players = uniqueIds.map((id) => byId.get(id));
  addLog(room, 'Ordem dos jogadores atualizada.');
  markChanged(room);
}

function updatePlayerAvatar(room, playerId, avatar) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Você não está nesta mesa.');
  const cleanAvatar = sanitizeAvatar(avatar);
  if (!cleanAvatar) throw new Error('Foto inválida ou grande demais.');
  player.avatar = cleanAvatar;
  addLog(room, `${player.name} atualizou a foto.`);
  markChanged(room);
}

function disconnectPlayer(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  if (player) {
    player.connected = false;
    markChanged(room);
  }
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  makeCode,
  createRoom,
  addPlayer,
  startGame,
  passCard,
  takeCard,
  reorderPlayers,
  updatePlayerAvatar,
  disconnectPlayer,
  serialize,
  scoreCards,
  scorePlayer,
  startingChips,
};
