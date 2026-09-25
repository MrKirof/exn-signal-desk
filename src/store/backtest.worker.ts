import { buildBacktestReport, type BacktestJob } from "@/lib/lab/backtest-job";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BacktestJob>) => void) | null;
  postMessage: (data: unknown) => void;
};

scope.onmessage = (event) => {
  scope.postMessage(buildBacktestReport(event.data));
};
