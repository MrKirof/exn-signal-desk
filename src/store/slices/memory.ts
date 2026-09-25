import { MODEL_VERSION } from "@/lib/lab/layers/domain";
import { bucketStats, groupPerf, longestLose, maxDrawdown, profitFactor, scoreOutcomes, wipePersonal } from "@/lib/lab/layers/memory";
import { emptyRisk } from "@/lib/lab/layers/risk";
import type { LabSnapshot } from "@/store/lab-store";

type Get = () => LabSnapshot;
type Set = (partial: Partial<LabSnapshot>) => void;

export function memoryActions(set: Set, get: Get) {
  return {
    exportJournal: () => {
      const s = get();
      return JSON.stringify(
        {
          version: MODEL_VERSION,
          exportedAt: new Date().toISOString(),
          outcomes: s.outcomes,
          metrics: {
            buckets: bucketStats(s.outcomes),
            byAsset: groupPerf(s.outcomes, (o) => o.asset),
            byRegime: groupPerf(s.outcomes, (o) => o.regime),
            pf: profitFactor(s.outcomes),
            dd: maxDrawdown(s.outcomes.map((o) => o.grossProfit)),
            lose: longestLose(s.outcomes),
            scores: scoreOutcomes(s.outcomes),
          },
        },
        null,
        2,
      );
    },
    wipe: async () => {
      await wipePersonal();
      set({ outcomes: [], bookRows: [], risk: emptyRisk(get().settings.bankroll), toast: "Personal data deleted" });
    },
  };
}
