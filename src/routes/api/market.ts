import { createFileRoute } from "@tanstack/react-router";
import type { AssetId, Timeframe } from "@/lib/lab/types";
import { ASSETS, TIMEFRAME_SEC } from "@/lib/lab/constants";
import { loadSpot } from "@/lib/lab/feed";

const ASSET_IDS = new Set(ASSETS.map((a) => a.id));

export const Route = createFileRoute("/api/market")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const asset = url.searchParams.get("asset") as AssetId | null;
        const tf = (url.searchParams.get("tf") ?? "1m") as Timeframe;
        if (!asset || !ASSET_IDS.has(asset)) {
          return Response.json({ ok: false, error: "unknown asset" }, { status: 400 });
        }
        if (!(tf in TIMEFRAME_SEC)) {
          return Response.json({ ok: false, error: "unknown timeframe" }, { status: 400 });
        }
        const snap = await loadSpot(asset, tf);
        return Response.json(snap);
      },
    },
  },
});
