# SPIN — First-person Table Tennis

A browser table tennis game played in first person with the mouse, built on a real ball-physics model.

## Physics
- Regulation 40 mm / 2.7 g ball, standard table and net dimensions
- Air drag and Magnus lift (topspin dips, backspin floats, sidespin curves)
- Impulse-based contacts with restitution and friction (slip/roll), so spin comes out of the collisions rather than being scripted
- 1 kHz physics substeps with swept paddle collision

## Play online
**https://blinky1994.github.io/spin-table-tennis/**

### With a friend
Click **Play with a friend**, copy the invite link and send it. When your friend opens it you'll see them join. Press **Start match**, and they click once to take control of their paddle.

- The two browsers connect directly to each other (WebRTC via [PeerJS](https://peerjs.com)). PeerJS's free public broker only introduces them, and there's no game server.
- Each player sees the match from their own end. The player whose half the ball is on rules on bounces and points, and hits are sent instantly with the receiver catching the ball up by the network delay.
- A few strict networks (some offices or schools) block direct connections. Home Wi-Fi and mobile data normally work.

## Running locally
Serve the folder with any static web server (ES modules + a CDN copy of three.js), e.g.

```bash
python -m http.server 8000
```

then open `http://localhost:8000`.

| Control | Action |
|---|---|
| Mouse | Move the paddle left/right and toward/away from the net |
| Push mouse forward | Swing |
| Hold left / right button | Snap the face closed (topspin, lower) / open (backspin, lift) |
| Scroll wheel | Resting face angle · middle click resets it |
| Serve | Mouse aims (orange marker), wheel sets spin, flick sideways as you click for sidespin, click to serve |
| `[` `]` | Mouse speed |
| `Q` | Slow motion |
| `Esc` | Pause |

Official rules: games to 11, win by 2, serve changes every 2 points.

## Files
- `js/physics.js` — ball flight and contact physics
- `js/main.js` — game loop, controls, rules, CPU opponent, rendering
- `js/athlete.js` — articulated opponent with IK arms and legs
- `js/arena.js` — arena, scoreboards and the tribute photo frame
- `js/net.js` — two-player peer-to-peer connection
