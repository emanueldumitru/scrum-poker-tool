# Scrum Poker

Real-time planning poker for agile teams, modelled on the flow of planningpokeronline.com:
**create a game → share the link → everyone picks a name → vote → reveal → discuss → vote again.**

No accounts, nothing to install for players, a single small Node.js service to host.

## Features

- **Share a link, pick a name, vote.** Game links are unguessable (`/aB3…`, 20 random characters). Your browser remembers your name, so rejoining is instant.
- **Hidden votes, synchronized reveal.** Nobody — not even with dev tools — sees other votes before the reveal. Optional 3-2-1 countdown; optional auto-reveal when everyone has voted.
- **Results that help the discussion:** vote distribution (hover a bar to see who picked it), average, agreement score with a robot that reacts to how aligned the team is, a suggested estimate (nearest card to the average, ties rounded up), and confetti on full consensus.
- **Facilitator controls:** the creator is the facilitator. They can promote others, remove players and edit the final estimate. They can also restrict reveal and issue management to facilitators, and delete the game. If no facilitator is at the table, everyone can still reveal, manage issues and change settings, so a team is never locked out. Appointing facilitators and deleting the game always stay with the facilitators.
- **Voting systems:** Fibonacci, Modified Fibonacci (½, 20, 40, 100), T-shirts, Powers of 2, or a custom deck. `?` means unsure (counts against agreement) and `☕` means "I need a break" (abstains).
- **Issues panel:** add issues one by one or paste many lines at once (a URL in a line becomes the issue's link). Vote on an issue, and the result is stored as its estimate. Use "Next issue" to move on. Reorder the list and export it to CSV.
- **Voting history** per game with votes, average and agreement; CSV export.
- **Shared timer** to timebox discussions (30 s – 10 min, pause, +30 s, +1 min).
- **Spectator mode**, **emoji throwing** at other players (can be switched off), **dark/light theme**, **mobile-friendly**.
- **Keyboard:** type a card's value to vote (`5`, `13`, `xl`, `?`, `c` for ☕), `Backspace` to withdraw.
- **Resilient:** automatic reconnect, and several tabs share one seat. Players keep their seat for a grace period after disconnecting. Games survive restarts and deploys through a JSON snapshot.

## Quick start

Requires **Node.js 22.18+** (the server runs TypeScript directly via Node's type stripping). `run.sh` finds it on your PATH or in nvm.

```bash
./run.sh             # install + build if needed, then start and share on your network
./run.sh --local     # only this computer can open it
./run.sh --dev       # development: hot reload, this computer only
PORT=4000 ./run.sh   # another port
```

The equivalent npm scripts are `npm run dev`, and `npm run build && npm start`.

## Run it on your computer and share it with colleagues

`./run.sh` listens on your network and prints the links to share:

```
  ♠ Scrum Poker  is running

  This computer http://localhost:3000
  Your network  http://192.168.0.146:3000  en0
  VPN           http://10.168.36.51:3000   utun8
```

1. Open **http://localhost:3000**, create a game and click **Invite players**. When you are on localhost, the dialog gives you the *network* link, not a localhost link. If you have both a local-network and a VPN address, you can pick which one to share.
2. Colleagues open the link, type their name and vote. No install needed.
3. Keep the terminal open and your computer awake; the game lives on your machine (in `data/`). Ctrl+C stops it. Games are still there next time you run it, and colleagues reconnect automatically if your laptop briefly sleeps.

**Who can join:**

- **Same office LAN / Wi-Fi:** use the *Your network* link.
- **Remote colleagues on the company VPN:** use the *VPN* link. This works only if the VPN allows device-to-device traffic; many corporate VPNs block it.

**If the link does not open for colleagues:**

- **VPN client:** FortiClient and similar clients often block local-network traffic while connected. Try the other link, or check whether your VPN profile allows it.
- **macOS firewall:** if it is on, allow incoming connections for `node` when macOS asks (System Settings → Network → Firewall).
- **Guest Wi-Fi:** guest and hotel networks usually isolate devices from each other.
- **Last resort:** deploy it (Docker/Railway, below). That is also the best option for a team that uses it every sprint.

Avoid public tunnels (ngrok, Cloudflare Tunnel…). They put names and issue titles on the internet, so check with security@emag.ro first.

### Docker / Railway

```bash
docker build -t scrum-poker .
docker run -p 3000:3000 -v scrum-poker-data:/app/data scrum-poker
```

`railway.json` deploys the Dockerfile with a `/healthz` health check, in the EU (`europe-west4`), capped at 1 vCPU / 0.5 GB. Serverless is on (`sleepApplication`): with no player connected for about 10 minutes the service sleeps, and the next visit wakes it in a few seconds. Games are saved on shutdown, so attach a volume at `/app/data` to keep them across sleeps and deploys. The container runs as the non-root `node` user; if the platform mounts volumes owned by root, grant that user write access. On Railway, set `RAILWAY_RUN_UID=0`, and set `PORT=3000` so it matches the domain's target port (Railway otherwise injects `8080`).

Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies in front of the app (usually `1`, e.g. Railway or nginx). If the proxy rewrites the `Host` header, also list the public origin in `ALLOWED_ORIGINS`. The proxy must forward WebSocket upgrades on `/ws`.

## Configuration

All settings are optional environment variables (see `.env.example`; a local `.env` file is loaded if present).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` (`127.0.0.1` in dev) | Interface to listen on |
| `DATA_DIR` | `./data` | Where `games.json` is written |
| `PERSIST` | `1` | `0` keeps games in memory only |
| `ROOM_TTL_DAYS` | `30` | Delete games inactive for this long (never-used games: after 7 days) |
| `PLAYER_GRACE_SECONDS` | `60` | How long a disconnected player keeps their seat and vote |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front; enables `X-Forwarded-*` (client IP, host, HTTPS) |
| `ALLOWED_ORIGINS` | — | Origins allowed to open WebSockets in addition to the app's own host (comma-separated) |
| `MAX_GAMES` / `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | `5000` / `10000` / `200` | Resource caps |
| `GAME_CREATES_PER_MINUTE` | `30` | Per-IP rate limit for creating games |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | `pretty` in a terminal, else `json` | Force `json` or `pretty` log lines |

## Security & privacy

- **Data collected:** the display names players type, their votes, and issue titles/links. There are no accounts, no emails, no cookies, no analytics and no third-party requests (system fonts, no CDNs).
- **Retention (GDPR data minimization):**
  - A disconnected player is removed from the game after the grace period.
  - A game is deleted after `ROOM_TTL_DAYS` without activity, or after 7 days if it was never used. *Game settings → Delete game* deletes it immediately.
  - The snapshot file is written with owner-only permissions (`0600`), and `data/` is git-ignored.
- **Logs** never contain names, issue titles or full game ids (only a 4-character prefix).
- **Identity:** each browser generates a random 256-bit secret, stored in `localStorage` and only ever sent to this server. The server derives a public player id from it with a one-way hash. Other players never see the secret, so nobody can impersonate or unmask another player.
- **Hardening:**
  - strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`
  - `Referrer-Policy: no-referrer`, so game links don't leak to Jira when opening issue links
  - issue links limited to http(s)
  - control and bidi characters stripped from all text
  - WebSocket origin check, frame size limit, per-connection and per-IP limits
  - rate limiting, heartbeats, and CSV exports protected against formula injection
- **Access model:** anyone who has the link can join a game — like planningpokeronline.com. Treat links as internal. For access control, put the service behind your SSO/VPN proxy.
- **Sharing from your computer (`./run.sh`):** traffic inside your network is plain HTTP, and anyone who can reach your machine can open the start page and create games. That is fine for a team session. For everyday use, deploy it behind HTTPS. `./run.sh --local` keeps it on your computer only.
- No secrets or credentials are required. Questions: security@emag.ro.

## How it works

```
src/
  shared/    decks, statistics (average, agreement, suggestion), protocol types, limits
  server/    room.ts   game rules (transport-agnostic, unit-tested)
             store.ts  rooms in memory + JSON snapshot + expiry
             hub.ts    WebSocket connections, validation, rate limits, personalized broadcasts
             http.ts   REST API (create game / game info), security headers, static files
  client/    React UI (Vite): pages, components, reconnecting connection, styles
tests/       node:test unit + integration tests (real HTTP/WebSocket server)
```

- **REST:** `POST /api/games` creates a game (the creator's derived id becomes facilitator). `GET /api/games/:id` returns its name. `GET /healthz` is the health check.
- **WebSocket `/ws`:** the client sends `join`, then commands such as `vote`, `reveal`, `reset`, `issues:add` and `timer`. After every change the server pushes a personalized `state` to each player, where hidden votes are only included for their own voter. Issues and history are sent separately, only when they change.
- Single process with in-memory state; one instance serves many teams at once. Running several replicas would need a shared store (e.g. Redis pub/sub), so keep `numReplicas: 1`.

## Development

```bash
npm run typecheck    # client + server TypeScript
npm test             # unit + integration tests
npm run check        # typecheck + tests + production build
```
# scrum-poker-tool
