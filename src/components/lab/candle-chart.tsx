import { useLayoutEffect, useRef, useState } from "react";
import type { Candle, NewsEvent, Outcome, Signal } from "@/lib/lab/types";
import type { PriceLevel } from "@/lib/lab/structure";
import { ema } from "@/lib/lab/indicators";

export function CandleChart({
  candles,
  forming,
  signal,
  outcomes,
  news,
  trailStop = 0,
  levels = [],
}: {
  candles: Candle[];
  forming: Candle | null;
  signal: Signal | null;
  outcomes: Outcome[];
  news: NewsEvent[];
  trailStop?: number;
  levels?: PriceLevel[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = box.w || canvas.parentElement?.clientWidth || 0;
    const h = box.h || canvas.parentElement?.clientHeight || 0;
    if (w < 8 || h < 8) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue("--color-bg").trim() || "#0e1116";
    const fg = css.getPropertyValue("--color-fg").trim() || "#e7edf4";
    const muted = css.getPropertyValue("--color-muted").trim() || "#8b929c";
    const call = css.getPropertyValue("--color-call").trim() || "#3f9d73";
    const put = css.getPropertyValue("--color-put").trim() || "#c45d5d";
    const border = "rgba(236,238,241,0.08)";
    const accent = css.getPropertyValue("--color-accent").trim() || "#c5ccd6";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const rows = forming ? [...candles, forming] : candles;
    const vis = rows.slice(-90);
    if (vis.length < 2) {
      ctx.fillStyle = muted;
      ctx.font = "15px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("Loading live FX…", w / 2, h / 2);
      return;
    }

    const padL = 8;
    const padR = 56;
    const padT = 12;
    const padB = 22;
    const highs = vis.map((c) => c.high);
    const lows = vis.map((c) => c.low);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    const span = Math.max(max - min, 1e-8);
    min -= span * 0.08;
    max += span * 0.08;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const slot = plotW / vis.length;
    const yOf = (p: number) => padT + ((max - p) / (max - min)) * plotH;

    const regime = signal?.regime ?? "";
    if (regime === "TREND_UP") {
      ctx.fillStyle = "rgba(125,211,252,0.06)";
      ctx.fillRect(padL, padT, plotW, plotH);
    } else if (regime === "TREND_DOWN") {
      ctx.fillStyle = "rgba(127,29,29,0.16)";
      ctx.fillRect(padL, padT, plotW, plotH);
    } else if (regime === "RANGE" || regime === "DEAD") {
      ctx.fillStyle = "rgba(197,204,214,0.04)";
      ctx.fillRect(padL, padT, plotW, plotH);
    }

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = padT + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const look = vis.slice(-40);
    const res = Math.max(...look.map((c) => c.high));
    const sup = Math.min(...look.map((c) => c.low));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = put;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(padL, yOf(res));
    ctx.lineTo(w - padR, yOf(res));
    ctx.stroke();
    ctx.strokeStyle = call;
    ctx.beginPath();
    ctx.moveTo(padL, yOf(sup));
    ctx.lineTo(w - padR, yOf(sup));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const struct = signal?.structure;
    if (struct && struct.swingHigh > 0 && struct.swingLow > 0) {
      ctx.strokeStyle = muted;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, yOf(struct.swingHigh));
      ctx.lineTo(w - padR, yOf(struct.swingHigh));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padL, yOf(struct.swingLow));
      ctx.lineTo(w - padR, yOf(struct.swingLow));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = muted;
      ctx.font = "13px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText("SH", padL + 4, yOf(struct.swingHigh) - 3);
      ctx.fillText("SL", padL + 4, yOf(struct.swingLow) + 11);
    }

    vis.forEach((c, i) => {
      const x = padL + i * slot + slot * 0.5;
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? call : put;
      ctx.fillStyle = up ? call : put;
      ctx.globalAlpha = c.closed === false ? 0.55 : 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.high));
      ctx.lineTo(x, yOf(c.low));
      ctx.stroke();
      const top = yOf(Math.max(c.open, c.close));
      const bot = yOf(Math.min(c.open, c.close));
      const bw = Math.max(2, slot * 0.62);
      ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
      ctx.globalAlpha = 1;
    });

    const closes = vis.map((c) => c.close);
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    const drawEma = (period: number, color: string, last: number | null) => {
      if (last == null || vis.length < period) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      vis.forEach((_, i) => {
        if (i < period - 1) return;
        const slice = closes.slice(0, i + 1);
        const v = ema(slice, period);
        if (v == null) return;
        const x = padL + i * slot + slot * 0.5;
        if (i === period - 1) ctx.moveTo(x, yOf(v));
        else ctx.lineTo(x, yOf(v));
      });
      ctx.stroke();
    };
    drawEma(9, accent, e9);
    drawEma(21, muted, e21);

    const t0 = vis[0]!.t;
    const t1 = vis[vis.length - 1]!.t;
    for (const n of news) {
      if (n.impact !== "high" || n.t < t0 || n.t > t1 + 60_000) continue;
      const frac = (n.t - t0) / Math.max(1, t1 - t0);
      const x = padL + frac * plotW;
      ctx.fillStyle = "rgba(196,161,90,0.8)";
      ctx.fillRect(x, padT, 1.5, plotH);
    }

    const marks = outcomes.slice(-12);
    marks.forEach((o) => {
      const idx = vis.findIndex((c) => Math.abs(c.close - o.entryPrice) < o.entryPrice * 0.0008);
      if (idx < 0) return;
      const x = padL + idx * slot + slot * 0.5;
      ctx.fillStyle = o.kind === "WIN" ? call : o.kind === "LOSS" ? put : muted;
      ctx.beginPath();
      ctx.arc(x, yOf(o.entryPrice), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    for (const lv of levels) {
      const y = yOf(lv.price);
      if (y < padT || y > padT + plotH) continue;
      ctx.strokeStyle = lv.kind === "support" ? "rgba(63,157,115,0.7)" : "rgba(196,93,93,0.7)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted;
      ctx.font = "13px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(lv.kind === "support" ? "S" : "R", padL + 2, y - 2);
    }

    const planDir = signal && signal.direction !== "WAIT" ? signal.direction : signal?.pendingDirection;
    if (signal && planDir && planDir !== "WAIT") {
      const x = padL + (vis.length - 1) * slot + slot * 0.5;
      const buy = planDir === "BUY";
      ctx.strokeStyle = buy ? call : put;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, yOf(signal.entryPrice));
      ctx.lineTo(w - padR, yOf(signal.entryPrice));
      ctx.stroke();
      if (signal.stopPrice > 0) {
        ctx.strokeStyle = put;
        ctx.beginPath();
        ctx.moveTo(padL, yOf(signal.stopPrice));
        ctx.lineTo(w - padR, yOf(signal.stopPrice));
        ctx.stroke();
      }
      if (signal.targetPrice > 0) {
        ctx.strokeStyle = call;
        ctx.beginPath();
        ctx.moveTo(padL, yOf(signal.targetPrice));
        ctx.lineTo(w - padR, yOf(signal.targetPrice));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = buy ? call : put;
      ctx.fillRect(x - 3, yOf(signal.entryPrice) - 3, 6, 6);
    }

    if (trailStop > 0) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(padL, yOf(trailStop));
      ctx.lineTo(w - padR, yOf(trailStop));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = muted;
    ctx.font = "13px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    const pxDigits = vis[0] && vis[0].close > 20 ? 2 : 5;
    ctx.fillText(max.toFixed(pxDigits), w - 8, padT + 10);
    ctx.fillText(min.toFixed(pxDigits), w - 8, h - padB);
    const lastPx = vis[vis.length - 1]!.close;
    ctx.fillStyle = accent;
    ctx.fillText(lastPx.toFixed(pxDigits), w - 8, yOf(lastPx) + 4);
    ctx.textAlign = "left";
    ctx.fillText("EMA9 / EMA21  ·  S support  ·  R resistance", padL, h - 6);
  }, [box.w, box.h, candles, forming, signal, outcomes, news, trailStop, levels]);

  return <canvas ref={ref} className="h-full w-full" role="img" aria-label="Price chart" />;
}
