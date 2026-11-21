# Slop Drift backend (Cloudflare Workers free tier)

One Worker: Hono REST under `/api/*`, one hibernating Durable Object room per event at
`/parties/room/<modeId>` (partyserver), and D1 for leaderboards and ghosts. The game works without
it: with no `VITE_API_HOST` the client uses tabs-of-this-browser multiplayer and a localStorage
leaderboard.

## Run locally (no Cloudflare account needed)

```sh
cd server
npm install
cp .dev.vars.example .dev.vars                      # TOKEN_SECRET for local tokens
npx wrangler d1 execute slop-drift --local --file=schema.sql
npx wrangler dev                                    # http://127.0.0.1:8787
```

Then run the game with the API pointed at it, from the repo root:

```sh
VITE_API_HOST=http://127.0.0.1:8787 npm run dev
NET_LIVE=http://127.0.0.1:8787 node tests/net.test.mjs   # includes live server tests
```

`tests/view-net.html?host=127.0.0.1:8787` (on the Vite dev server) opens two clients side by side.

## Deploy

1. Create a free account at https://dash.cloudflare.com/sign-up (email + password; no card needed
   for Workers Free). Verify the email.
2. Log in from this folder: `npx wrangler login` (opens the browser).
3. Create the database: `npx wrangler d1 create slop-drift`. Copy the printed `database_id` into
   `wrangler.jsonc` (replacing the zeros).
4. Create the tables: `npx wrangler d1 execute slop-drift --remote --file=schema.sql`
5. Set the token secret (any long random string, e.g. from `openssl rand -base64 32`):
   `npx wrangler secret put TOKEN_SECRET`. Changing it later invalidates every player's token.
6. Check `ALLOWED_ORIGINS` in `wrangler.jsonc` contains the production origin
   (`https://slop-drift.vercel.app`) and any custom domain.
7. Deploy: `npx wrangler deploy`. It prints the URL, e.g.
   `https://slop-drift-api.<your-subdomain>.workers.dev`.
8. In Vercel (Project → Settings → Environment Variables) set
   `VITE_API_HOST=https://slop-drift-api.<your-subdomain>.workers.dev` and redeploy the site.

Logs: `npx wrangler tail`. Schema changes: edit `schema.sql` (keep it idempotent) and run step 4 again.

## API

| Route | |
|---|---|
| `POST /api/register {playerId, name}` | `{token}`; the first claim of an id wins, later claims get 409 |
| `POST /api/score {modeId, playerId, token, name, level, time\|score, ghost}` | `{accepted, improved, rank, best, reason}`; 400 invalid, 401 bad token, 429 within 10 s |
| `GET /api/top?mode=X&limit=50` | `{mode, kind, entries}` (cached 30 s) |
| `GET /api/ghost?mode=X&player=Y` | `{ghost}` (cached 60 s) |
| `GET /api/online` | `{total, rooms}` (cached 15 s) |
| `WS /parties/room/<modeId>?playerId&name&level&paint&rim&number&token` | realtime room, max 16 |
| `WS /parties/room/party.<CODE>?…&instance&party=create\|join&partyMap&partyMode` | private party room, max 8 |

`modeId` / `mode` / room names are track keys (`src/meta/trackKey.js`): the bare event id on the
original Alpine map (`sprint`, `mountain`, ...), `<map>.<event>` on the others (`mussoorie.sprint`,
`mussoorie.mountain`, ...). Each track key is its own leaderboard and room; no schema change is needed.

## Party rooms (race with friends via code)

`party.<CODE>` rooms are private: `CODE` is 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
(no 0/O, 1/I/L look-alikes), at most 8 drivers. They relay car state like any room and also run the
party state machine in `src/net/party.js` (shared with the client's local-tab mode): the host picks an
event of the party's map, `start` sets a shared start 5 s ahead, the room's Durable Object alarm moves
it to racing at that time, finishes are collected, and 60 s after the first finisher (or 20 min after
the start) everyone left is marked DNF and the results go out. The state is kept in DO storage, so
hibernation loses nothing; an empty party is deleted.

- Join with `party=create` (plus `partyMap`, `partyMode`) to make the party, `party=join` to enter an
  existing one. Refusals: `{t:'party', error}` then close 4404 (no such party), 4409 (code taken),
  4003 (full). `instance` is the client's member id (it gets one assigned if missing or malformed).
- Client → room: `{t:'party', op:'select'|'ready'|'start'|'finish'|'rematch'|'sync', …}`.
- Room → each member: `{t:'party', state, now, you}` after every change (`now` lets clients estimate
  the clock offset for the synchronised countdown), `{t:'party', error, now}` for a refused op.
- The host role passes to the earliest remaining member when the host leaves.

Validation lives in `src/validate.js` (unit-tested from `tests/net.test.mjs`). The fastest believable
time is 0.85 × the author medal and the highest believable drift score 1.6 × the author medal
(`src/meta/catalog.js`). Timed runs need a ghost whose recorded length matches within ±1.5 s.

## Free-tier budget

Workers Free: 100,000 requests/day (Worker + Durable Object requests combined); a WebSocket message
into a DO bills as 1/20 of a request. At 6 Hz one driving player costs ~0.3 requests/s, about
1,100/hour. A dropped request returns an error instead of a bill.
