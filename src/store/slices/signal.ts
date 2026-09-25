import type { LabSnapshot } from "@/store/lab-store";

type Get = () => LabSnapshot;
type Set = (partial: Partial<LabSnapshot>) => void;

/** Manual actions only. The desk never sends an order. */
export function signalActions(set: Set, get: Get) {
  return {
    paper: () => {
      set({ toast: "Read only. This desk does not place an order." });
    },
    flatten: () => {
      set({ toast: "Read only. Nothing to close.", open: null, manage: null });
    },
    skip: () =>
      set({
        signal: get().signal
          ? { ...get().signal!, direction: "WAIT", lifecycle: "EXPIRED", cancelledReason: "Skipped" }
          : null,
        lifecycle: "IDLE",
      }),
  };
}
