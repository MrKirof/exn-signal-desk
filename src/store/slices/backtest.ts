import { buildBacktestReport, type BacktestJob } from "@/lib/lab/backtest-job";
import { feedClaim } from "@/lib/lab/source-label";
import { generateHistory } from "@/lib/lab/layers/market";
import type { LabSnapshot } from "@/store/lab-store";

type Get = () => LabSnapshot;
type Set = (partial: Partial<LabSnapshot>) => void;

export function backtestActions(set: Set, get: Get, feedMode: () => string) {
  return {
    runBacktest: () => {
      const s = get();
      set({ backtestBusy: true, view: "backtest" });
      const live = s.candles;
      const useLive = feedMode() !== "simulated" && live.length >= 80;
      const hist = useLive ? live : generateHistory({ asset: s.asset, timeframe: s.timeframe, bars: 720, seed: 77 }).candles;
      const source = useLive ? feedClaim(s.health.source, s.collectorDemo).text : "Simulated";
      const job: BacktestJob = {
        candles: hist,
        settings: s.settings,
        model: s.model,
        asset: s.asset,
        timeframe: s.timeframe,
        source,
      };
      const finish = (report: ReturnType<typeof buildBacktestReport>) => set({ backtestReport: report, backtestBusy: false });
      if (typeof Worker !== "function") {
        finish(buildBacktestReport(job));
        return;
      }
      const worker = new Worker(new URL("../backtest.worker.ts", import.meta.url), { type: "module" });
      const timer = window.setTimeout(() => {
        worker.terminate();
        set({ backtestBusy: false, toast: "Backtest took too long and was stopped." });
      }, 30_000);
      worker.onmessage = (event: MessageEvent) => {
        window.clearTimeout(timer);
        finish(event.data);
        worker.terminate();
      };
      worker.onerror = () => {
        window.clearTimeout(timer);
        worker.terminate();
        finish(buildBacktestReport(job));
      };
      worker.postMessage(job);
    },
  };
}
