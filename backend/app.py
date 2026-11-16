"""Live Stock Tracker backend: Flask + Flask-SocketIO (WebSocket) + Redis cache.

Clients emit "subscribe" with a ticker. A background task polls Finnhub for every
ticker that has at least one subscriber and pushes "quote" events to that
ticker's room. Quotes are cached in Redis so many clients cost one API call.
"""
import json
import os
import threading
import time

import redis
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

load_dotenv()

FINNHUB_KEY = os.getenv("FINNHUB_API_KEY")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "15"))
PORT = int(os.getenv("PORT", "5001"))

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Redis cache with an in-memory fallback so the app still runs without Redis.
try:
    cache = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    cache.ping()
    CACHE_BACKEND = "redis"
except redis.RedisError:
    cache = None
    CACHE_BACKEND = "memory"
_memory = {}  # symbol -> (expires_at, json string)

subs = {}  # sid -> set of symbols
subs_lock = threading.Lock()


def cache_get(symbol):
    if cache:
        raw = cache.get(f"quote:{symbol}")
    else:
        entry = _memory.get(symbol)
        raw = entry[1] if entry and entry[0] > time.time() else None
    return json.loads(raw) if raw else None


def cache_set(symbol, quote):
    raw = json.dumps(quote)
    ttl = max(POLL_SECONDS - 1, 1)
    if cache:
        cache.setex(f"quote:{symbol}", ttl, raw)
    else:
        _memory[symbol] = (time.time() + ttl, raw)


def get_quote(symbol):
    """Return a quote dict, or None if the symbol is unknown. Raises on network errors."""
    cached = cache_get(symbol)
    if cached:
        return cached
    res = requests.get(
        "https://finnhub.io/api/v1/quote",
        params={"symbol": symbol, "token": FINNHUB_KEY},
        timeout=10,
    )
    res.raise_for_status()
    d = res.json()
    if not d.get("c"):  # Finnhub returns zeros for unknown symbols
        return None
    quote = {
        "symbol": symbol,
        "price": d["c"],
        "change": d["d"],
        "percent": d["dp"],
        "high": d["h"],
        "low": d["l"],
        "open": d["o"],
        "prev_close": d["pc"],
        "ts": d["t"],
    }
    cache_set(symbol, quote)
    return quote


def poll_loop():
    while True:
        with subs_lock:
            active = set().union(*subs.values()) if subs else set()
        for symbol in active:
            try:
                quote = get_quote(symbol)
                if quote:
                    socketio.emit("quote", quote, to=symbol)
            except requests.RequestException as exc:
                socketio.emit("feed_error", {"symbol": symbol, "message": str(exc)}, to=symbol)
        socketio.sleep(POLL_SECONDS)


@app.get("/api/health")
def health():
    return jsonify(status="ok", cache=CACHE_BACKEND, poll_seconds=POLL_SECONDS)


@socketio.on("subscribe")
def on_subscribe(data):
    from flask import request

    symbol = str((data or {}).get("symbol", "")).strip().upper()
    if not symbol.replace(".", "").replace("-", "").isalpha() or len(symbol) > 10:
        emit("feed_error", {"symbol": symbol, "message": "Invalid ticker."})
        return
    if not FINNHUB_KEY:
        emit("feed_error", {"symbol": symbol, "message": "Server is missing FINNHUB_API_KEY."})
        return
    try:
        quote = get_quote(symbol)
    except requests.RequestException as exc:
        emit("feed_error", {"symbol": symbol, "message": str(exc)})
        return
    if not quote:
        emit("feed_error", {"symbol": symbol, "message": f"No data found for {symbol}."})
        return
    join_room(symbol)
    with subs_lock:
        subs.setdefault(request.sid, set()).add(symbol)
    emit("quote", quote)


@socketio.on("unsubscribe")
def on_unsubscribe(data):
    from flask import request

    symbol = str((data or {}).get("symbol", "")).strip().upper()
    leave_room(symbol)
    with subs_lock:
        subs.get(request.sid, set()).discard(symbol)


@socketio.on("disconnect")
def on_disconnect():
    from flask import request

    with subs_lock:
        subs.pop(request.sid, None)


if __name__ == "__main__":
    socketio.start_background_task(poll_loop)
    print(f"Live tracker on http://localhost:{PORT} (cache: {CACHE_BACKEND})")
    socketio.run(app, host="0.0.0.0", port=PORT, allow_unsafe_werkzeug=True)
