# Live Stock Tracker

Track several tickers at once. Prices stream to the browser over a WebSocket and update every few seconds, with a small sparkline of recent prices.

This is a fresh build using the stack from your CV (Python, Flask, WebSocket, Redis, React). It is not a recovery of any earlier code.

## How it works

1. The React app opens a Socket.IO (WebSocket) connection to the Flask server and emits `subscribe` with a ticker.
2. The server fetches the quote from Finnhub, joins the client to a room named after the ticker, and replies with the first `quote` event.
3. A background task runs every `POLL_SECONDS` (default 15). It collects every ticker that has at least one subscriber, fetches each once, and pushes a `quote` event to that ticker's room.
4. Quotes are cached in Redis for slightly less than the poll interval, so ten clients watching AAPL cost one API call per cycle. If Redis is not running, the server falls back to an in-memory cache and says so on startup.
5. The frontend keeps the last 40 prices per ticker for the sparkline.

## Tech stack

- Backend: Python, Flask, Flask-SocketIO (threading mode), Redis, requests
- Frontend: React 18, Vite, socket.io-client
- Data: Finnhub quote endpoint (free API key)

## Setup

Get a free key at https://finnhub.io

Start Redis (optional):

```bash
docker compose up -d
```

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # then put your key in .env
python app.py
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. On Windows, activate the venv with `.venv\Scripts\activate`.

## Socket events

| Direction | Event | Payload |
| --- | --- | --- |
| client to server | `subscribe` | `{ symbol }` |
| client to server | `unsubscribe` | `{ symbol }` |
| server to client | `quote` | `{ symbol, price, change, percent, high, low, open, prev_close, ts }` |
| server to client | `feed_error` | `{ symbol, message }` |

`GET /api/health` reports the cache backend in use.

## Notes

Finnhub free keys have rate limits and market data is only live during trading hours. Check Finnhub's current limits on their site.
