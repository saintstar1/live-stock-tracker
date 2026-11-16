import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_POINTS = 40;

function Sparkline({ points, up }) {
  if (points.length < 2) return <span className="muted">collecting</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${28 - ((p - min) / span) * 26}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" width="100" height="30" aria-hidden="true">
      <polyline points={d} fill="none" stroke={up ? '#0f7b4f' : '#b3261e'} strokeWidth="1.5" />
    </svg>
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

  function add(e) {
    e.preventDefault();
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    setError('');
    socketRef.current.emit('subscribe', { symbol: s });
    setSymbol('');
  }

  function remove(s) {
    socketRef.current.emit('unsubscribe', { symbol: s });
    setQuotes(({ [s]: _gone, ...rest }) => rest);
    setHistory(({ [s]: _gone, ...rest }) => rest);
  }

  return (
    <main>
      <h1>Live Stock Tracker</h1>
      <p className="sub">
        <span className={connected ? 'dot on' : 'dot'} /> {connected ? 'Connected' : 'Disconnected'}
      </p>

      <form onSubmit={add}>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Add ticker, e.g. MSFT" aria-label="Ticker symbol" />
        <button disabled={!connected || !symbol.trim()}>Track</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {Object.keys(quotes).length === 0 ? (
        <p className="muted">Add a ticker to start streaming prices.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Symbol</th><th>Price</th><th>Change</th><th>Recent</th><th /></tr>
          </thead>
          <tbody>
            {Object.values(quotes).map((q) => (
              <tr key={q.symbol}>
                <td><strong>{q.symbol}</strong></td>
                <td>{q.price.toFixed(2)}</td>
                <td className={q.change >= 0 ? 'up' : 'down'}>
                  {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)} ({q.percent.toFixed(2)}%)
                </td>
                <td><Sparkline points={history[q.symbol] || []} up={q.change >= 0} /></td>
                <td><button className="ghost" onClick={() => remove(q.symbol)} aria-label={`Stop tracking ${q.symbol}`}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
