# No Thanks Web

[![Node.js](https://img.shields.io/badge/node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socket.io)](https://socket.io/)

**No Thanks Web** is a lightweight, phone-friendly multiplayer card game for a
shared Wi-Fi network. Create a table on one device, have everyone else join by
scanning a QR code, then decide whether to spend a chip and say *no thanks* or
take the current card — and its growing pot.

It is inspired by the rules of **No Thanks! / Não, Obrigado** and is intended
for a quick game around the same table, without accounts or a central service.

## Features

- **QR-code joining.** The host creates a room and shares its QR code or link.
- **Built for phones.** Responsive UI, camera-based avatars, touch-friendly
  controls, and optional turn notifications.
- **Real-time table.** Players see the same cards, chips, turns, and game log
  through Socket.IO.
- **Faithful scoring.** Consecutive runs score only their lowest card, then
  chips are subtracted; the lowest score wins.
- **3 to 7 players.** The game applies the appropriate starting-chip rules and
  removes nine unseen cards before a round starts.
- **Shareable result.** The final podium can be saved as an image.

## How to play

1. One person opens the game and chooses **Criar mesa**.
2. Everyone joins from the QR code or the four-character room code.
3. On a turn, either pay one chip to pass or take the visible card and all
   chips already on it.
4. When the deck ends, the lowest total score wins.

## Run locally

Prerequisite: Node.js 18 or newer.

```sh
npm install
npm start
```

The terminal prints a local address. Open it on the host device, then use its
QR code to join from other phones on the same network. By default the server
listens on port 3030; set `PORT` to use another port.

```sh
PORT=8080 npm start
```

## Development

```sh
npm test
npm run smoke
```

The game is deliberately small:

```text
public/       Phone-first interface and browser-side behavior
src/game.js   Rules, state transitions, scoring, and serialization
src/server.js Express server, room lifecycle, QR codes, and Socket.IO events
test/         Game-rule tests
```

## Stack

- Node.js and Express
- Socket.IO for real-time multiplayer updates
- QRCode for table sharing
- Plain HTML, CSS, and JavaScript on the client

## Notes

Rooms live in server memory. Restarting the server clears any active tables;
this is intentional for a simple local-game setup.
