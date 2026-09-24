export function postDesk(body: unknown) {
  if (typeof fetch === "undefined") return;
  void fetch("/api/desk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}
