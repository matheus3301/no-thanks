const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoom, addPlayer, startGame, passCard, takeCard, reorderPlayers, updatePlayerAvatar, scoreCards, startingChips, serialize } = require('../src/game');

test('score only counts the lowest card in consecutive runs and subtracts chips', () => {
  assert.equal(scoreCards([3, 4, 5, 8, 10, 11]), 21);
});

test('starting chips follow player-count rules', () => {
  assert.equal(startingChips(3), 11);
  assert.equal(startingChips(5), 11);
  assert.equal(startingChips(6), 9);
  assert.equal(startingChips(7), 7);
});

test('pass adds a chip to the pot and take collects card plus pot', () => {
  const room = createRoom('a', 'Ana', 'TEST');
  addPlayer(room, 'b', 'Bia');
  addPlayer(room, 'c', 'Caio');
  startGame(room, 'a');
  room.currentPlayerIndex = 0;
  room.currentCard = 20;
  room.pot = 0;

  passCard(room, 'a');
  assert.equal(room.players[0].chips, 10);
  assert.equal(room.pot, 1);
  assert.equal(room.currentPlayerIndex, 1);

  takeCard(room, 'b');
  assert.deepEqual(room.players[1].cards, [20]);
  assert.equal(room.players[1].chips, 12);
});

test('serialize hides other players chips and score during the game', () => {
  const room = createRoom('a', 'Ana', 'TEST');
  addPlayer(room, 'b', 'Bia');
  addPlayer(room, 'c', 'Caio');
  startGame(room, 'a');

  const anaView = serialize(room, 'a');
  const ana = anaView.players.find((player) => player.id === 'a');
  const bia = anaView.players.find((player) => player.id === 'b');

  assert.equal(ana.chips, 11);
  assert.equal(ana.chipsHidden, false);
  assert.equal(typeof ana.score, 'number');
  assert.equal(bia.chips, null);
  assert.equal(bia.chipsHidden, true);
  assert.equal(bia.score, null);
});

test('serialize keeps taken cards public for every player during the game', () => {
  const room = createRoom('a', 'Ana', 'TEST');
  addPlayer(room, 'b', 'Bia');
  addPlayer(room, 'c', 'Caio');
  startGame(room, 'a');
  room.players[0].cards = [3, 12];
  room.players[1].cards = [9, 10];

  const caioView = serialize(room, 'c');
  assert.deepEqual(caioView.players.find((player) => player.id === 'a').cards, [3, 12]);
  assert.deepEqual(caioView.players.find((player) => player.id === 'b').cards, [9, 10]);
});

test('serialize reveals all chips and final scores after the game ends', () => {
  const room = createRoom('a', 'Ana', 'TEST');
  addPlayer(room, 'b', 'Bia');
  addPlayer(room, 'c', 'Caio');
  startGame(room, 'a');
  room.ended = true;

  const view = serialize(room, 'a');
  assert.equal(view.players.every((player) => player.chips !== null), true);
  assert.equal(view.ranking.length, 3);
});

test('reorderPlayers changes lobby order before the game starts', () => {
  const room = createRoom('a', 'Ana', 'TEST');
  addPlayer(room, 'b', 'Bia');
  addPlayer(room, 'c', 'Caio');

  reorderPlayers(room, 'b', ['c', 'a', 'b']);
  assert.deepEqual(room.players.map((player) => player.id), ['c', 'a', 'b']);
  assert.equal(room.version > 1, true);
});

test('reorderPlayers is blocked after the game starts', () => {
  const room = createRoom('a', 'Ana', 'TEST');
  addPlayer(room, 'b', 'Bia');
  addPlayer(room, 'c', 'Caio');
  startGame(room, 'a');

  assert.throws(() => reorderPlayers(room, 'a', ['c', 'b', 'a']), /antes da partida/);
});

test('avatars are stored and serialized for players', () => {
  const avatar = 'data:image/jpeg;base64,abc123';
  const room = createRoom('a', 'Ana', 'TEST', avatar);
  addPlayer(room, 'b', 'Bia', false, avatar);
  updatePlayerAvatar(room, 'b', 'data:image/png;base64,xyz789');

  const view = serialize(room, 'a');
  assert.equal(view.players.find((player) => player.id === 'a').avatar, avatar);
  assert.equal(view.players.find((player) => player.id === 'b').avatar, 'data:image/png;base64,xyz789');
});
