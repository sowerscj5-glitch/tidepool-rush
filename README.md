# Tidepool Rush

A multiplayer browser game. Everyone who opens your link swims in the same pool as a glowing jellyfish. Eat plankton (1 point) and pearls (5 points), and jet into rivals to steal 3 points. Each tide lasts 90 seconds, then the scores reset.

No accounts or sign-in. Anyone with the link can play, on a phone or a computer.

## Controls

- Move: WASD, arrow keys, or hold a finger/mouse in the water
- Jet: Space, or the Jet button

## Run it on your computer

You need [Node.js](https://nodejs.org) 18 or newer. There's nothing to install.

```
npm start
```

Open http://localhost:3000. Other devices on the same Wi-Fi can join at `http://YOUR-COMPUTER-IP:3000`.

## Put it online so anyone can join

Any host that runs Node.js and supports WebSockets works. With Render's free plan:

1. Put this folder in a GitHub repository.
2. On render.com, create a new **Web Service** from that repository.
3. Build command: leave empty (or `npm install`). Start command: `npm start`.
4. Under Environment, add `OWNER_KEY` with a secret only you know.
5. Deploy and share the address Render gives you.

Free hosting usually goes to sleep when nobody is playing, so the first visit after a quiet spell can take up to a minute to load.

## Owner powers

Tap the "Tidepool Rush" title 5 times, or press the backtick key (`). Enter your `OWNER_KEY` once, then type a code to toggle it:

| Code | Power |
| --- | --- |
| `zoomies` | Swim 1.8× faster |
| `titan` | Double size (everyone sees it) |
| `magnet` | Grab orbs from far away |
| `ghost` | Nobody can steal from you |
| `rapidjet` | Almost no jet cooldown |
| `pearlrain` | Every orb is worth 5 |
| `off` | Turn all powers off |
| `list` | Show the codes |

If no `OWNER_KEY` is set, nobody can unlock powers.

## How it works

- `server.js` has no dependencies. It serves the page and relays every player's position, score and name to everyone 20 times a second.
- `public/index.html` is the whole game. Each browser simulates its own jelly; orbs are placed by a shared formula based on the clock, so everyone sees the same pool without the server tracking it.
- When you're alone, three labeled bots swim with you. They leave when a real player joins.

Scores are reported by each player's own browser, so someone who edits the code can cheat. It's built for playing with friends.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | 3000 | Port to listen on (hosts usually set this) |
| `OWNER_KEY` | none | Unlocks the owner power codes |
| `MAX_PLAYERS` | 60 | Most players in the pool at once |

## License

MIT. See LICENSE.
