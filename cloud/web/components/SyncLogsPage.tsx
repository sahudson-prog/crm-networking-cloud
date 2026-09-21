"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type SyncRunLogRow = {
  created_at: string;
  detail: string | null;
  id: string;
  operation: string;
  provider: string;
  resource_type: string;
  run_id: string;
  scope_label: string | null;
  status: string;
  step: string;
  step_order: number;
};

export function SyncLogsPage() {
  const [rows, setRows] = useState<SyncRunLogRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadLogs()
      .then((nextRows) => {
        if (!active) return;
        setRows(nextRows);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "No pude cargar logs.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Logs</h2>
          <span className="panel-caption">Ultimos pasos de sincronizacion</span>
        </div>
        <Link className="button secondary" href="/sistema">Volver a Sistema</Link>
      </div>

      {error ? (
        <p className="form-error">
          {error.includes("sync_run_logs")
            ? "Aun falta crear la tabla de logs en Supabase."
            : error}
        </p>
      ) : null}

      <div className="sync-log-list" aria-label="Ultimos logs de sincronizacion">
        {rows.length ? rows.slice(0, 10).map((row) => (
          <article className={`sync-log-row ${row.status}`} key={row.id}>
            <time>{formatDate(row.created_at)}</time>
            <strong>{row.step}</strong>
            <span>{resourceLabel(row)}</span>
            {row.detail ? <p>{row.detail}</p> : null}
          </article>
        )) : (
          <span className="empty">Aun no hay logs de sincronizacion.</span>
        )}
      </div>
    </section>
  );
}

async function loadLogs() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("sync_run_logs")
    .select("id,run_id,provider,resource_type,operation,scope_label,step_order,step,status,detail,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as SyncRunLogRow[];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-CL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}

function resourceLabel(row: SyncRunLogRow) {
  const scope = row.scope_label ? ` · ${row.scope_label}` : "";
  return `${row.provider} · ${row.resource_type} · ${row.operation}${scope}`;
}
