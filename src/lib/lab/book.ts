export interface BookRow {
  id: string;
  market: "forex";
  action: "buy" | "sell";
  symbol: string;
  price: number;
  quantity: number;
  content: string;
  executedAt: string;
  exitPrice: number | null;
  pnl: number | null;
  source: "self";
}

export function openBookRow(opts: {
  id: string;
  action: "buy" | "sell";
  symbol: string;
  price: number;
  quantity: number;
  note: string;
  at?: number;
}): BookRow {
  return {
    id: opts.id,
    market: "forex",
    action: opts.action,
    symbol: opts.symbol,
    price: opts.price,
    quantity: opts.quantity,
    content: opts.note,
    executedAt: new Date(opts.at ?? Date.now()).toISOString(),
    exitPrice: null,
    pnl: null,
    source: "self",
  };
}

export function closeBookRow(row: BookRow, exitPrice: number, pnl: number): BookRow {
  return { ...row, exitPrice, pnl };
}
