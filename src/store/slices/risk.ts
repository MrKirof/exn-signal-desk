import { emptyRisk } from "@/lib/lab/layers/risk";
import { postDesk } from "@/lib/lab/layers/agents";
import type { LabSettings } from "@/lib/lab/layers/domain";
import type { LabSnapshot } from "@/store/lab-store";

type Get = () => LabSnapshot;
type Set = (partial: Partial<LabSnapshot>) => void;

export function riskActions(set: Set, get: Get) {
  return {
    patchSettings: (p: Partial<LabSettings>) => {
      const settings = { ...get().settings, ...p };
      if (p.bankroll != null && Number.isFinite(p.bankroll)) {
        const b = Math.max(10, Math.round(p.bankroll * 100) / 100);
        settings.bankroll = b;
        const risk = get().risk;
        set({
          settings,
          risk: { ...risk, bankroll: b, equity: b, peakEquity: Math.max(risk.peakEquity, b) },
          toast: `Balance set to $${b.toLocaleString()}`,
        });
      } else {
        set({ settings });
      }
      try {
        window.localStorage.setItem(
          "exn-account",
          JSON.stringify({ bankroll: settings.bankroll, leverageCap: settings.leverageCap, riskPercent: settings.riskPercent }),
        );
      } catch {
        /* ignore quota */
      }
      postDesk({ action: "file", name: "settings.json", value: settings });
    },
    toggleKill: () => {
      const killed = !get().risk.killed;
      set({ risk: { ...get().risk, killed }, toast: killed ? "Kill-switch ON" : "Kill-switch OFF" });
    },
    requestResetRisk: () => set({ resetOpen: true }),
    confirmResetRisk: () => set({ risk: emptyRisk(get().settings.bankroll), resetOpen: false, toast: "Risk state reset" }),
    cancelResetRisk: () => set({ resetOpen: false }),
    ackMartingale: (on: boolean) => set({ martingaleAck: on, settings: { ...get().settings, martingaleEnabled: on } }),
  };
}
