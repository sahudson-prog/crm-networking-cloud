"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type ImportBatch = {
  id: string;
  source_type: string;
  source_filename: string | null;
  status: string;
  imported_at: string | null;
  created_at: string;
};

export function SystemReadiness() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError("Supabase no esta configurado.");
      return;
    }

    supabase
      .from("import_batches")
      .select("id,source_type,source_filename,status,imported_at,created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        else setBatches((data ?? []) as ImportBatch[]);
      });
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Sistema</h2>
        <span className="panel-caption">Preparacion cloud</span>
      </div>
      <div className="compact-list">
        <div className="compact-row">
          <strong>Base</strong>
          <span>Supabase/Postgres v0.1 con RLS activo.</span>
        </div>
        <div className="compact-row">
          <strong>App</strong>
          <span>Version cloud beta. Contactos ya puede probar sync Google con confirmacion previa.</span>
        </div>
        <div className="compact-row">
          <strong>Costos</strong>
          <span>Operaciones controladas desde la aplicacion web.</span>
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <Link className="button" href="/sistema/diseno">
          Guia visual cloud
        </Link>
        <Link className="button" href="/cuenta">
          Cuenta y conexiones
        </Link>
        <Link className="button" href="/sistema/mantencion">
          Mantencion admin
        </Link>
        <Link className="button" href="/sistema/logs">
          Logs
        </Link>
      </div>
      {error ? <p className="meta">Error leyendo cargas: {error}</p> : null}
      <h3 className="panel-title" style={{ marginTop: 18 }}>Ultimas cargas</h3>
      <div className="compact-list" style={{ marginTop: 10 }}>
        {batches.length ? (
          batches.map((batch) => (
            <div className="compact-row" key={batch.id}>
              <strong>{batch.status}</strong>
              <span>{batch.source_filename || batch.source_type}</span>
            </div>
          ))
        ) : (
          <span className="empty">Aun no aparecen cargas para esta sesion.</span>
        )}
      </div>
    </section>
  );
}
