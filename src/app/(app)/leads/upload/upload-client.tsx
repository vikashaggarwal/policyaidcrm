"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyseLocally, applyExisting, countRows, invalidRowsCsv, summariseAssignments, type AnalysedRow } from "@/lib/upload/analyse";
import type { CallerRef } from "@/lib/upload/assignee";
import { FIELD_LABELS, LEAD_FIELDS, type HeaderMapping } from "@/lib/upload/headers";
import { CHUNK_SIZE, mapRows, readFile, readPasted, UploadError, type Table } from "@/lib/upload/parse";
import { beginUpload, findExisting, finishUpload, importChunk } from "./actions";

type Stage = "start" | "reading" | "checking" | "preview" | "importing" | "done";
type Source = { kind: "file"; name: string } | { kind: "paste" };

const SERVER_LOOKUP_BATCH = 2000;
const UNEXPECTED = "Something went wrong while reading that. Please try again.";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-ok-bg text-ok",
  duplicate: "bg-warn-bg",
  invalid: "bg-danger-bg text-danger",
};
const STATUS_LABEL: Record<string, string> = { new: "New", duplicate: "Duplicate", invalid: "Invalid" };

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const headers = [
    "STATE", "REG NO", "RTO CODE", "REG DATE", "OWNER NAME", "OWNER(S/W/D)", "ADDRESS", "ENGINE NO",
    "CHASIS NO", "VEHICLE MAKE", "VEHICLE MODEL VARIANT", "VEHICLE CLASS", "FUEL", "SALE AMOUNT",
    "SEAT CAPACITY", "MOBILE", "ASSIGNED TO",
  ];
  const sample = [
    ["MAHARASHTRA", "MH12AB0001", "MH12", "15/01/2026", "SAMPLE OWNER ONE", "SAMPLE GUARDIAN", "1 Example Street, Pune", "ENG000001", "CHS000001", "HONDA", "ACTIVA 6G", "M-CYCLE/SCOOTER", "PETROL", 85000, 2, "9800000101", "caller01"],
    ["DELHI", "DL01CD0002", "DL01", "20/01/2026", "SAMPLE OWNER TWO", "SAMPLE GUARDIAN", "2 Example Road, New Delhi", "ENG000002", "CHS000002", "HYUNDAI", "CRETA SX", "MOTOR CAR", "DIESEL", 1650000, 5, "9800000102", ""],
  ];
  const notes = [
    ["How to fill this sheet"],
    ["Required: REG NO, OWNER NAME, MOBILE. Everything else is optional."],
    ["MOBILE: 10 digits. +91, spaces and a leading 0 are fine."],
    ["REG DATE: day first, e.g. 15/01/2026. Policy expiry is worked out as registration date + 5 days."],
    ["ASSIGNED TO: a caller's login ID or full name. Leave blank to assign later."],
    ["Only the first sheet is read. Delete the two sample rows before uploading."],
    ["Check numbers against the NDNC registry before uploading."],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  // Phones as text so Excel doesn't turn them into numbers or scientific notation.
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), "Read me");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  download("policyaid-lead-template.xlsx", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export function UploadClient({ callers }: { callers: CallerRef[] }) {
  const [stage, setStage] = useState<Stage>("start");
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<HeaderMapping | null>(null);
  const [rows, setRows] = useState<AnalysedRow[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [result, setResult] = useState<{ added: number; duplicates: number; invalid: number; unassigned: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const import$ = useRef({ batchId: "", next: 0, added: 0, duplicates: 0, invalid: 0, unassigned: 0 });

  // Don't let someone close the tab mid-import without a warning.
  useEffect(() => {
    if (stage !== "importing") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);

  const reset = () => {
    setStage("start"); setError(null); setTable(null); setMapping(null); setRows([]); setResult(null);
    setImportError(null); setSource(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const analyse = useCallback(async (read: () => Promise<Table>, src: Source) => {
    setError(null);
    setStage("reading");
    try {
      const t = await read();
      const { mapping: m, rows: mapped } = mapRows(t);
      if (m.missingRequired.length > 0) {
        const found = Object.keys(m.columns).map((f) => FIELD_LABELS[f as keyof typeof FIELD_LABELS]).join(", ") || "none";
        setError(
          `We couldn't find a column for: ${m.missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}. ` +
          `Columns we did recognise: ${found}. Rename the headers in your sheet (or use the template) and try again.`,
        );
        setStage("start");
        return;
      }
      if (mapped.length === 0) {
        setError("That file has a header row but no leads under it.");
        setStage("start");
        return;
      }

      const local = analyseLocally(mapped);
      setStage("checking");
      const regNos = local.filter((r) => r.status === "new" && r.lead).map((r) => r.lead!.reg_no);
      const existing = new Set<string>();
      setProgress({ done: 0, total: regNos.length, label: "Checking for leads you already have…" });
      for (let i = 0; i < regNos.length; i += SERVER_LOOKUP_BATCH) {
        const res = await findExisting(regNos.slice(i, i + SERVER_LOOKUP_BATCH));
        if (!res.ok) { setError(res.message); setStage("start"); return; }
        res.existing.forEach((r) => existing.add(r));
        setProgress((p) => ({ ...p, done: Math.min(i + SERVER_LOOKUP_BATCH, regNos.length) }));
      }

      setTable(t); setMapping(m); setSource(src);
      setRows(applyExisting(local, existing));
      setStage("preview");
    } catch (e) {
      setError(e instanceof UploadError ? e.message : UNEXPECTED);
      setStage("start");
    }
  }, []);

  const runImport = useCallback(async (fromScratch: boolean) => {
    const toImport = rows.filter((r) => r.status === "new");
    const s = import$.current;
    setImportError(null);
    setStage("importing");
    try {
      if (fromScratch) {
        const name = source?.kind === "file" ? source.name : "Pasted rows";
        const begun = await beginUpload(name, rows.length);
        if (!begun.ok) { setImportError(begun.message); setStage("preview"); return; }
        Object.assign(s, { batchId: begun.batchId, next: 0, added: 0, duplicates: 0, invalid: 0, unassigned: 0 });
      }
      setProgress({ done: s.next, total: toImport.length, label: "Importing…" });
      while (s.next < toImport.length) {
        const chunk = toImport.slice(s.next, s.next + CHUNK_SIZE);
        const res = await importChunk({
          batchId: s.batchId,
          rows: chunk.map((r) => ({ rowNumber: r.rowNumber, raw: r.raw })),
        });
        if (!res.ok) {
          setImportError(`${res.message} ${s.added.toLocaleString("en-IN")} leads are already saved. Press "Resume" to continue.`);
          setStage("importing");
          return;
        }
        s.added += res.added; s.duplicates += res.duplicates; s.invalid += res.invalid; s.unassigned += res.unassigned;
        s.next += chunk.length;
        setProgress({ done: s.next, total: toImport.length, label: "Importing…" });
      }
      const counts = countRows(rows);
      const fin = await finishUpload(s.batchId, counts.duplicate + s.duplicates, counts.invalid + s.invalid);
      if (!fin.ok) { setImportError(`${fin.message} Your leads are saved; press "Resume" to finish recording the upload.`); return; }
      setResult({ added: fin.added, duplicates: counts.duplicate + s.duplicates, invalid: counts.invalid + s.invalid, unassigned: s.unassigned });
      setStage("done");
    } catch {
      setImportError(`We lost the connection. ${s.added.toLocaleString("en-IN")} leads are already saved. Press "Resume" when you're back online.`);
    }
  }, [rows, source]);

  const counts = countRows(rows);
  const assignments = summariseAssignments(rows, callers);

  // ---------------------------------------------------------------- start
  if (stage === "start" || stage === "reading") {
    const reading = stage === "reading";
    return (
      <div className="space-y-4">
        <div role="tablist" aria-label="How to add leads" className="flex gap-2">
          {(["file", "paste"] as const).map((t) => (
            <button
              key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
              className={`btn flex-1 ${tab === t ? "btn-primary" : ""}`}
            >
              {t === "file" ? "Upload a file" : "Paste rows"}
            </button>
          ))}
        </div>

        {tab === "file" ? (
          <div className="card p-4">
            <label htmlFor="file" className="mb-2 block font-medium">Choose an Excel or CSV file</label>
            <input
              ref={fileInput} id="file" type="file" disabled={reading}
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="field !py-2.5"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analyse(() => readFile(f), { kind: "file", name: f.name });
              }}
            />
            <p className="mt-2 text-sm text-muted">Up to 10 MB and 30,000 rows. Only the first sheet is read.</p>
          </div>
        ) : (
          <div className="card p-4">
            <label htmlFor="paste" className="mb-2 block font-medium">Paste rows (with the header row)</label>
            <textarea
              id="paste" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} disabled={reading}
              className="field !min-h-40 py-3 font-mono text-sm" spellCheck={false}
              placeholder={"REG NO\tOWNER NAME\tMOBILE\nMH12AB0001\tSample Owner\t9800000101"}
            />
            <button
              type="button" className="btn btn-primary mt-3 w-full" disabled={reading || !pasted.trim()}
              onClick={() => void analyse(() => readPasted(pasted), { kind: "paste" })}
            >
              Check these rows
            </button>
          </div>
        )}

        <div aria-live="polite">
          {reading && <p className="text-sm text-muted">Reading your file…</p>}
          {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        </div>

        <button type="button" className="btn w-full" onClick={() => void downloadTemplate()}>
          Download sample Excel template
        </button>
        <p className="text-sm text-muted">
          Compliance: check numbers against the NDNC registry before uploading. Numbers on it must not be loaded.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- checking / importing
  if (stage === "checking" || stage === "importing") {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="card space-y-3 p-5" aria-live="polite">
        <p className="font-semibold">{stage === "checking" ? progress.label : importError ? "Import paused" : "Importing leads…"}</p>
        <div
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress"
          className="h-3 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted">
          {progress.done.toLocaleString("en-IN")} of {progress.total.toLocaleString("en-IN")} · {pct}%
        </p>
        {stage === "importing" && !importError && (
          <p className="text-sm text-muted">Keep this page open until it finishes.</p>
        )}
        {importError && (
          <>
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{importError}</p>
            <button type="button" className="btn btn-primary w-full" onClick={() => void runImport(false)}>Resume</button>
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- done
  if (stage === "done" && result) {
    return (
      <div className="card space-y-4 p-5">
        <div role="status">
          <p className="text-lg font-bold">Upload complete</p>
          <p className="text-muted">{result.added.toLocaleString("en-IN")} leads were added.</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[["Added", result.added], ["Duplicates skipped", result.duplicates], ["Invalid", result.invalid]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg border border-line p-3">
              <dd className="text-xl font-bold">{(v as number).toLocaleString("en-IN")}</dd>
              <dt className="text-xs text-muted">{k}</dt>
            </div>
          ))}
        </dl>
        {result.unassigned > 0 && (
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm">
            {result.unassigned.toLocaleString("en-IN")} leads named a caller we couldn&apos;t match, so they&apos;re unassigned.
          </p>
        )}
        {counts.invalid > 0 && mapping && (
          <button type="button" className="btn w-full" onClick={() => download("invalid-rows.csv", new Blob([invalidRowsCsv(rows, Object.keys(mapping.columns))], { type: "text/csv;charset=utf-8" }))}>
            Download the {counts.invalid.toLocaleString("en-IN")} invalid rows (CSV)
          </button>
        )}
        <div className="flex gap-2">
          <Link href="/leads" className="btn flex-1 text-center leading-[48px]">Back to leads</Link>
          <button type="button" className="btn btn-primary flex-1" onClick={reset}>Upload another</button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- preview
  return (
    <div className="space-y-5">
      <section aria-labelledby="summary" className="card p-4">
        <h2 id="summary" className="font-semibold">
          {source?.kind === "file" ? source.name : "Pasted rows"}
          <span className="font-normal text-muted"> · {counts.total.toLocaleString("en-IN")} rows</span>
        </h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {([["new", "New", counts.new], ["duplicate", "Duplicate", counts.duplicate], ["invalid", "Invalid", counts.invalid]] as const).map(([k, label, n]) => (
            <div key={k} className={`rounded-lg p-3 ${STATUS_STYLE[k]}`}>
              <dd className="text-2xl font-bold">{n.toLocaleString("en-IN")}</dd>
              <dt className="text-xs">{label}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted">
          Duplicates are leads already in the system, or repeated in this file (matched on registration number). They won&apos;t be imported.
        </p>
      </section>

      {counts.new > 0 && (
        <section aria-labelledby="assign-h" className="card space-y-3 p-4">
          <h2 id="assign-h" className="font-semibold">Who gets these leads</h2>
          {assignments.perCaller.length === 0 && assignments.unmatched.length === 0 ? (
            <p className="text-sm text-muted">
              The sheet has no &ldquo;Assigned to&rdquo; values, so all {counts.new.toLocaleString("en-IN")} new leads will be unassigned.
              You can assign them afterwards from the Leads page.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {assignments.perCaller.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span className="truncate">{c.name}</span>
                  <span className="font-medium">{c.count.toLocaleString("en-IN")}</span>
                </li>
              ))}
              {assignments.unassignedBlank > 0 && (
                <li className="flex justify-between gap-3 text-muted">
                  <span>Unassigned (blank in the sheet)</span>
                  <span className="font-medium">{assignments.unassignedBlank.toLocaleString("en-IN")}</span>
                </li>
              )}
            </ul>
          )}
          {assignments.unmatched.length > 0 && (
            <div role="alert" className="rounded-lg bg-warn-bg px-3 py-2 text-sm">
              <p className="font-medium">
                {assignments.unmatchedTotal.toLocaleString("en-IN")} {assignments.unmatchedTotal === 1 ? "lead names" : "leads name"} someone we couldn&apos;t match. They&apos;ll import unassigned.
              </p>
              <ul className="mt-1 space-y-0.5">
                {assignments.unmatched.slice(0, 8).map((u) => (
                  <li key={u.text}>&ldquo;{u.text}&rdquo; ×{u.count.toLocaleString("en-IN")}</li>
                ))}
              </ul>
              <p className="mt-1 text-muted">
                Use a caller&apos;s exact full name or login ID. If a name is wrong, press &ldquo;Choose a different file&rdquo;, fix the sheet and upload again.
              </p>
            </div>
          )}
        </section>
      )}

      {mapping && table && (
        <details className="card p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Columns we recognised ({Object.keys(mapping.columns).length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {LEAD_FIELDS.filter((f) => mapping.columns[f] !== undefined).map((f) => (
              <li key={f} className="flex justify-between gap-3">
                <span className="truncate text-muted">{String(table.headers[mapping.columns[f]!])}</span>
                <span className="shrink-0">→ {FIELD_LABELS[f]}</span>
              </li>
            ))}
          </ul>
          {mapping.ignored.length > 0 && (
            <p className="mt-3 text-sm text-muted">Ignored: {mapping.ignored.join(", ")}</p>
          )}
        </details>
      )}

      <section aria-labelledby="first10">
        <h2 id="first10" className="mb-2 font-semibold">First 10 rows</h2>
        <ul className="space-y-2">
          {rows.slice(0, 10).map((r) => (
            <li key={r.rowNumber} className="card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-medium">
                  <span className="text-muted">Row {r.rowNumber} · </span>
                  {r.lead?.name ?? String(r.raw.name ?? "—")}
                </p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <p className="mt-1 text-muted">
                {r.lead
                  ? `${r.lead.phone} · ${r.lead.reg_no}${r.lead.vehicle_make ? ` · ${r.lead.vehicle_make} ${r.lead.vehicle_model ?? ""}` : ""}`
                  : `${String(r.raw.phone ?? "—")} · ${String(r.raw.reg_no ?? "—")}`}
              </p>
              {r.reasons.length > 0 && <p className="mt-1 text-danger">{r.reasons.join("; ")}</p>}
            </li>
          ))}
        </ul>
      </section>

      {importError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{importError}</p>}

      <div className="space-y-2">
        <button type="button" className="btn btn-primary w-full" disabled={counts.new === 0} onClick={() => void runImport(true)}>
          {counts.new === 0 ? "Nothing new to import" : `Import ${counts.new.toLocaleString("en-IN")} leads`}
        </button>
        {counts.invalid > 0 && mapping && (
          <button
            type="button" className="btn w-full"
            onClick={() => download("invalid-rows.csv", new Blob([invalidRowsCsv(rows, Object.keys(mapping.columns))], { type: "text/csv;charset=utf-8" }))}
          >
            Download the {counts.invalid.toLocaleString("en-IN")} invalid rows (CSV)
          </button>
        )}
        <button type="button" className="btn w-full" onClick={reset}>Choose a different file</button>
      </div>
    </div>
  );
}
