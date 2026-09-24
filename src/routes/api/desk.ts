import { createFileRoute } from "@tanstack/react-router";
import {
  backupNow,
  deskAuthed,
  exportPack,
  importPack,
  ingestBars,
  loadOpen,
  postRunner,
  readFolderFile,
  readStatus,
  rememberOutcome,
  rememberStep,
  saveOpen,
  setMaster,
  startDeskLoop,
  takeNotify,
  tickDesk,
  writeConfig,
  writeFolderFile,
  readReplay,
  folderPath,
  type DeskBar,
} from "@/lib/lab/desk-io";
import type { DeskOutcome } from "@/lib/lab/desk-logic";

startDeskLoop();

function denied() {
  return Response.json({ ok: false, error: "pair required" }, { status: 401 });
}

export const Route = createFileRoute("/api/desk")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("pair") === "1") {
          return Response.json({ ok: false, error: "Paste the token shown on the desk. This URL does not hand out a token." }, { status: 403 });
        }
        if (url.searchParams.get("notify") === "1") return Response.json({ ok: true, notify: takeNotify() });
        if (url.searchParams.get("replay") === "1") return Response.json({ ok: true, steps: readReplay() });
        if (url.searchParams.get("open") === "1") return Response.json({ ok: true, open: loadOpen() });
        const file = url.searchParams.get("file");
        if (file) return Response.json({ ok: true, dir: folderPath(), value: readFolderFile(file, null) });
        if (url.searchParams.get("report") === "1") {
          const pack = exportPack();
          return new Response(pack.html, { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        const status = await tickDesk();
        return Response.json({ ok: true, status });
      },
      POST: async ({ request }) => {
        if (!deskAuthed(request.headers.get("x-desk-token"), request.headers.get("origin"))) {
          return denied();
        }
        const body = (await request.json()) as { action?: string; [k: string]: unknown };
        const action = body.action || "";
        if (action === "pair") {
          return Response.json({ ok: false, error: "The desktop app shows the pairing token. This endpoint does not." }, { status: 403 });
        }
        if (action === "ingest") {
          const bars = Array.isArray(body.bars) ? (body.bars as DeskBar[]) : [];
          return Response.json({ ok: true, ...ingestBars(bars) });
        }
        if (action === "outcome") {
          rememberOutcome(body.outcome as DeskOutcome);
          return Response.json({ ok: true });
        }
        if (action === "step") {
          rememberStep(body.step as { at: number; asset: string; direction: string; price: number; note: string });
          return Response.json({ ok: true });
        }
        if (action === "runner") {
          postRunner(String(body.note || ""));
          return Response.json({ ok: true });
        }
        if (action === "open") {
          saveOpen(body.ticket ?? null);
          return Response.json({ ok: true });
        }
        if (action === "backup") return Response.json({ ok: true, file: backupNow() });
        if (action === "config") return Response.json({ ok: true, config: writeConfig((body.config as object) || {}) });
        if (action === "master") {
          setMaster(Boolean(body.off), String(body.reason || ""));
          return Response.json({ ok: true });
        }
        if (action === "import") {
          importPack(String(body.sealed || ""));
          return Response.json({ ok: true });
        }
        if (action === "file") {
          try {
            const dir = writeFolderFile(String(body.name || ""), body.value ?? null);
            return Response.json({ ok: true, dir });
          } catch {
            return Response.json({ ok: false, error: "bad file" }, { status: 400 });
          }
        }
        if (action === "tick") return Response.json({ ok: true, status: await tickDesk() });
        return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
      },
    },
  },
});
