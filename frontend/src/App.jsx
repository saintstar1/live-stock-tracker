import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_POINTS = 40;
const SUGGESTIONS = ['AAPL', 'MSFT', 'NVDA', 'TSLA'];

function Sparkline({ points, up, id }) {
  if (points.length < 2) return <div className="spark empty">Collecting data</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * 100, 36 - ((p - min) / span) * 32]);
  const line = xy.map(([x, y]) => `${x},${y}`).join(' ');
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${line} 100,40`} fill={`url(#g-${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RangeBar({ low, high, price }) {
  if (!(high > low)) return null;
  const pos = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return (
    <div className="range">
      <span>{low.toFixed(2)}</span>
      <div className="track"><i style={{ left: `${pos}%` }} /></div>
      <span>{high.toFixed(2)}</span>
    </div>
  );
}

function Card({ q, points, onRemove }) {
  const up = q.change >= 0;
  const [flash, setFlash] = useState('');
  const prev = useRef(q.price);

  useEffect(() => {
    if (q.price !== prev.current) {
      setFlash(q.price > prev.current ? 'flash-up' : 'flash-down');
      prev.current = q.price;
      const t = setTimeout(() => setFlash(''), 700);
      return () => clearTimeout(t);
    }
  }, [q.price]);

  const updated = q.ts ? new Date(q.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <article className={`card ${flash}`}>
      <header>
        <h2>{q.symbol}</h2>
        <button className="x" onClick={onRemove} aria-label={`Stop tracking ${q.symbol}`}>&times;</button>
      </header>
      <div className="price">{q.price.toFixed(2)}</div>
      <div className={`pill ${up ? 'up' : 'down'}`}>
        {up ? '\u25B2' : '\u25BC'} {Math.abs(q.change).toFixed(2)} ({Math.abs(q.percent).toFixed(2)}%)
      </div>
      <Sparkline points={points} up={up} id={q.symbol} />
      <RangeBar low={q.low} high={q.high} price={q.price} />
      <dl>
        <div><dt>Open</dt><dd>{q.open.toFixed(2)}</dd></div>
        <div><dt>Prev close</dt><dd>{q.prev_close.toFixed(2)}</dd></div>
        <div><dt>Updated</dt><dd>{updated}</dd></div>
      </dl>
    </article>
  );
}

export default function App() {
  const [symbol, setSymbol] = useState('');
  const [quotes, setQuotes] = useState({});
  const [history, setHistory] = useState({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('quote', (q) => {
      setQuotes((prev) => ({ ...prev, [q.symbol]: q }));
      setHistory((prev) => ({
        ...prev,
        [q.symbol]: [...(prev[q.symbol] || []), q.price].slice(-MAX_POINTS),
      }));
    });
    socket.on('feed_error', (e) => setError(e.message));
    return () => socket.disconnect();
  }, []);

  function track(raw) {
    const s = raw.trim().toUpperCase();
    if (!s) return;
    setError('');
    socketRef.current.emit('subscribe', { symbol: s });
  }

  function remove(s) {
    socketRef.current.emit('unsubscribe', { symbol: s });
    setQuotes(({ [s]: _gone, ...rest }) => rest);
    setHistory(({ [s]: _gone, ...rest }) => rest);
  }

  const list = Object.values(quotes);

  return (
    <main>
      <div className="top">
        <h1>Live Stock Tracker</h1>
        <span className={`status ${connected ? 'on' : ''}`}>
          <i /> {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); track(symbol); setSymbol(''); }}>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Add a ticker, e.g. MSFT" aria-label="Ticker symbol" />
        <button disabled={!connected || !symbol.trim()}>Track</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {list.length === 0 ? (
        <div className="empty">
          <p>Nothing tracked yet. Add a ticker or start with one of these.</p>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" disabled={!connected} onClick={() => track(s)}>{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <section className="grid">
          {list.map((q) => (
            <Card key={q.symbol} q={q} points={history[q.symbol] || []} onRemove={() => remove(q.symbol)} />
          ))}
        </section>
      )}
    </main>
  );
}
