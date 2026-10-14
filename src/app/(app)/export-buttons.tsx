"use client";

import { useState } from "react";

/** Downloads through fetch so a failure shows a readable message instead of a raw error page. */
export function ExportButtons({ kind, params, label }: { kind: "leads" | "call-logs"; params: Record<string, string>; label: string }) {
  const [busy, setBusy] = useState<"csv" | "xlsx" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(format: "csv" | "xlsx") {
    setBusy(format);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ ...params, format });
      const res = await fetch(`/api/export/${kind}?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMessage({ ok: false, text: body?.message ?? "The export didn't work. Please try again." });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `dialdesk-${kind}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ ok: true, text: `Downloaded ${name}. This export has been recorded in the audit log.` });
    } catch {
      setMessage({ ok: false, text: "We couldn't reach the server. Check your internet and try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        <button type="button" className="btn flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void run("csv")}>
          {busy === "csv" ? "Preparing…" : "Export CSV"}
        </button>
        <button type="button" className="btn flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void run("xlsx")}>
          {busy === "xlsx" ? "Preparing…" : "Export Excel"}
        </button>
      </div>
      <div aria-live="polite">
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
