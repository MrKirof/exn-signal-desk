import { useEffect, useState } from "react";
import {
  SYMBOLS,
  fmt,
  levelBreak,
  lotsForRisk,
  money,
  moneyForPips,
  pricesFor,
  quoteFromMid,
  rawCommission,
  specOf,
  type AccountKind,
  type ExnessSymbol,
} from "@/lib/exness/ticket";

type Side = "BUY" | "SELL";

interface Position {
  id: string;
  symbol: ExnessSymbol;
  side: Side;
  lots: number;
  open: number;
  sl: number;
  tp: number;
  slPips: number;
  tpPips: number;
  account: AccountKind;
}

export function ExnessDesk() {
  const [symbol, setSymbol] = useState<ExnessSymbol>("EURUSD");
  const [account, setAccount] = useState<AccountKind>("standard");
  const [risk, setRisk] = useState(10);
  const [slPips, setSlPips] = useState(15);
  const [tpPips, setTpPips] = useState(20);
  const [quotes, setQuotes] = useState<Record<ExnessSymbol, { bid: number; ask: number }>>(() => {
    const seed = {} as Record<ExnessSymbol, { bid: number; ask: number }>;
    for (const s of SYMBOLS) {
      const q = quoteFromMid(s.seed, s);
      seed[s.id] = { bid: q.bid, ask: q.ask };
    }
    return seed;
  });
  const [source, setSource] = useState("Typical Standard spread on a public mid. Not your Exness terminal.");
  const [positions, setPositions] = useState<Position[]>([]);
  const [levelText, setLevelText] = useState("");
  const [closedPx, setClosedPx] = useState<number | null>(null);
  const [closedAt, setClosedAt] = useState(0);
  const [firedKey, setFiredKey] = useState("");
  const [note, setNote] = useState("");
  const spec = specOf(symbol);
  const bid = quotes[symbol].bid;
  const ask = quotes[symbol].ask;

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const res = await fetch(`/api/market?asset=${symbol}&tf=1m`);
        const json = await res.json();
        if (stop || !json?.ok || !(json.price > 0)) return;
        const bars = Array.isArray(json.bars) ? json.bars : [];
        const closed = bars.length >= 2 ? bars[bars.length - 2] : null;
        if (closed && closed.close > 0) {
          setClosedPx(closed.close);
          setClosedAt(closed.t || 0);
        }
        if (json.bid > 0 && json.ask > json.bid) {
          setQuotes((q) => ({ ...q, [symbol]: { bid: json.bid, ask: json.ask } }));
          setSource(`${json.venue || json.source} bid and ask`);
        } else {
          const q = quoteFromMid(json.price, spec);
          setQuotes((prev) => ({ ...prev, [symbol]: { bid: q.bid, ask: q.ask } }));
          setSource("Public mid. Bid and Ask use a measured Exness Standard spread, not your live terminal.");
        }
      } catch {
        /* keep the last quote */
      }
    }
    void pull();
    const id = window.setInterval(pull, 8000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [symbol, spec]);

  const spreadPips = spec.pip > 0 ? (ask - bid) / spec.pip : 0;
  const mid = (bid + ask) / 2;
  const lots = lotsForRisk(risk, slPips, spec, mid);
  const spreadCost = moneyForPips(spreadPips, lots, spec, mid);
  const commission = rawCommission(lots, account);
  const tpNet = moneyForPips(tpPips, lots, spec, mid) - commission;
  const slNet = -(moneyForPips(slPips, lots, spec, mid) + commission);
  const slInside = slPips <= spreadPips + 1e-9;
  const lotOk = lots >= 0.01;

  function pickSymbol(id: ExnessSymbol) {
    const next = specOf(id);
    const q = quoteFromMid(next.seed, next);
    setSymbol(id);
    setQuotes((prev) => ({ ...prev, [id]: prev[id] ?? { bid: q.bid, ask: q.ask } }));
    setSlPips(id === "XAUUSD" ? 80 : 15);
    setTpPips(id === "XAUUSD" ? 100 : 20);
    setNote("");
    setLevelText("");
    setClosedPx(null);
  }

  function open() {
    setNote("Read only. This screen does not place an order.");
  }

  function close(id: string) {
    setPositions((list) => list.filter((p) => p.id !== id));
  }

  const level = Number(levelText);
  const side = levelBreak(closedPx, Number.isFinite(level) ? level : null);
  const order = side === "WAIT" ? null : pricesFor(side, bid, ask, slPips, tpPips, spec);
  const signalKey = side === "WAIT" ? "" : `${symbol}|${closedAt}|${side}|${levelText}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-subtle uppercase">Exness paper ticket</p>
          <h1 className="font-serif text-3xl text-fg">Buy the ask. Sell the bid.</h1>
        </div>
        <div className="flex rounded-md border border-border p-1 text-sm">
          {(["standard", "raw"] as AccountKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setAccount(kind)}
              className={`rounded px-3 py-1 ${account === kind ? "bg-elevated text-fg" : "text-muted"}`}
            >
              {kind === "standard" ? "Standard" : "Raw Spread"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pickSymbol(s.id)}
            className={`rounded-full border px-3 py-1 text-sm ${symbol === s.id ? "border-accent text-fg" : "border-border text-muted"}`}
          >
            {s.id}
          </button>
        ))}
      </div>

      <section className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <button type="button" onClick={() => open()} className="rounded-lg bg-put px-4 py-4 text-left text-white">
          <div className="text-xs uppercase opacity-80">Sell</div>
          <div className="font-mono text-2xl">{fmt(bid, spec.digits)}</div>
          <div className="text-xs opacity-80">Opens at Bid</div>
        </button>
        <div className="flex flex-col items-center justify-center px-2 text-center">
          <div className="font-mono text-lg text-fg">{spreadPips.toFixed(1)}</div>
          <div className="text-xs text-subtle">spread pips</div>
        </div>
        <button type="button" onClick={() => open()} className="rounded-lg bg-call px-4 py-4 text-right text-black">
          <div className="text-xs uppercase opacity-80">Buy</div>
          <div className="font-mono text-2xl">{fmt(ask, spec.digits)}</div>
          <div className="text-xs opacity-80">Opens at Ask</div>
        </button>
      </section>
      <p className="text-sm text-muted">{source}</p>

      <section className="rounded-lg border border-border bg-surface p-4">
        <label className="text-sm text-muted">
          Your level
          <input
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-2 font-mono text-fg"
            inputMode="decimal"
            placeholder={fmt(mid, spec.digits)}
            value={levelText}
            onChange={(e) => setLevelText(e.target.value)}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-subtle uppercase">Last close</p>
            <p className="font-mono text-lg">{closedPx == null ? "Waiting for a closed candle" : fmt(closedPx, spec.digits)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-subtle uppercase">Bot</p>
            <p className={`font-mono text-2xl ${side === "BUY" ? "text-call" : side === "SELL" ? "text-put" : "text-muted"}`}>
              {side === "WAIT" ? "Wait" : side}
            </p>
          </div>
        </div>
        {order ? (
          <p className="mt-2 font-mono text-sm text-fg">
            {side} at {fmt(order.open, spec.digits)} · SL {fmt(order.sl, spec.digits)} · TP {fmt(order.tp, spec.digits)} · {lots.toFixed(2)} lot
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {levelText.trim() === ""
              ? "Type a price. A close above it is Buy. A close below it is Sell."
              : closedPx == null
                ? "Waiting for a candle to close."
                : "The last candle closed on your level. Wait for the next close."}
          </p>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <label className="text-sm text-muted">
          Risk, USD
          <input
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-2 font-mono text-fg"
            type="number"
            min={1}
            step={1}
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
          />
        </label>
        <label className="text-sm text-muted">
          Stop loss, pips
          <input
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-2 font-mono text-fg"
            type="number"
            min={1}
            step={1}
            value={slPips}
            onChange={(e) => setSlPips(Number(e.target.value))}
          />
        </label>
        <label className="text-sm text-muted">
          Take profit, pips
          <input
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-2 font-mono text-fg"
            type="number"
            min={1}
            step={1}
            value={tpPips}
            onChange={(e) => setTpPips(Number(e.target.value))}
          />
        </label>
        <p className="sm:col-span-3 text-sm text-fg">
          Lots <span className="font-mono">{lots.toFixed(2)}</span>
          {" · "}
          spread {money(spreadCost)}
          {account === "raw" ? ` · commission ${money(commission)}` : ""}
          {" · "}
          stop {money(slNet)}
          {" · "}
          target {money(tpNet)}
        </p>
        {slInside ? <p className="sm:col-span-3 text-sm text-put">Stop is inside the spread. No order.</p> : null}
        {!lotOk ? <p className="sm:col-span-3 text-sm text-put">Below the 0.01 lot minimum.</p> : null}
      </section>

      {note ? <p className="text-sm text-accent">{note}</p> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm text-subtle uppercase">Open paper</h2>
        {positions.length === 0 ? <p className="text-sm text-muted">No order yet. The bot writes one when a candle closes through your level.</p> : null}
        {positions.map((p) => {
          const s = specOf(p.symbol);
          const q = quotes[p.symbol];
          const mark = p.side === "BUY" ? q.bid : q.ask;
          const px = (q.bid + q.ask) / 2;
          const movePips = p.side === "BUY" ? (mark - p.open) / s.pip : (p.open - mark) / s.pip;
          const pnl = moneyForPips(movePips, p.lots, s, px) - (p.account === "raw" ? rawCommission(p.lots, "raw") : 0);
          return (
            <article key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
              <div>
                <div className="text-sm text-fg">
                  {p.side} {p.symbol} · {p.lots.toFixed(2)} lot
                </div>
                <div className="font-mono text-xs text-muted">
                  open {fmt(p.open, s.digits)} · SL {fmt(p.sl, s.digits)} · TP {fmt(p.tp, s.digits)}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono ${pnl >= 0 ? "text-call" : "text-put"}`}>{money(pnl)}</div>
                <button type="button" onClick={() => close(p.id)} className="text-xs text-muted underline">
                  Close at {p.side === "BUY" ? "Bid" : "Ask"}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <p className="text-xs leading-5 text-subtle">
        Standard spread is the cost. Raw Spread adds up to $3.50 per lot each side when the order closes. One lot of forex is 100,000.
        One lot of gold is 100 ounces. The bot uses your level only. It does not send orders to your Exness account.
      </p>
    </main>
  );
}
