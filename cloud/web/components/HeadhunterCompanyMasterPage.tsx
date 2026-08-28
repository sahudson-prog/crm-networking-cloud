"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadAdminAccessState, type AdminAccessState } from "../lib/adminAccess";
import { createHeadhunterCompany, readHeadhunterCompanyMaster } from "../lib/headhunterCompanyActions";
import type { HeadhunterCompanyMasterRow } from "../lib/headhunterCompanyMaster";
import { EmptyValue } from "./ui/EmptyValue";
import { Button } from "./ui/Button";

export function HeadhunterCompanyMasterPage() {
  const [admin, setAdmin] = useState<AdminAccessState>({
    allowed: false,
    capabilityCode: "admin.manage_global_masters",
    checked: false,
    email: "",
    message: "",
    status: "denied"
  });
  const [companies, setCompanies] = useState<HeadhunterCompanyMasterRow[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [domainsText, setDomainsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadAdminAccessState("admin.manage_global_masters").then((state) => {
      if (!active) return;
      setAdmin(state);
      if (state.allowed) load();
      else setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const domains = useMemo(() => splitLines(domainsText), [domainsText]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setCompanies(await readHeadhunterCompanyMaster());
    } catch (loadError) {
      setError(readableMasterError(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await createHeadhunterCompany({ displayName, domains });
      setDisplayName("");
      setDomainsText("");
      setMessage("Empresa guardada.");
      await load();
    } catch (saveError) {
      setError(readableMasterError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Empresas headhunter</h2>
          <span className="panel-caption">Maestro de empresas y dominios para agrupar contactos.</span>
        </div>
        <Link className="button secondary" href="/sistema/mantencion">Volver a Mantencion</Link>
      </div>

      {!admin.checked ? <span className="empty">Revisando acceso...</span> : null}
      {admin.checked && !admin.allowed ? (
        <p className="meta">
          {admin.message || "Este mantenedor es solo para administradores."}
        </p>
      ) : null}

      {admin.allowed ? <div className="headhunters-master-grid">
        <form
          className="headhunters-master-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="field">
            <span>Empresa</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Spencer Stuart" />
          </label>
          <label className="field">
            <span>Dominios</span>
            <textarea
              value={domainsText}
              onChange={(event) => setDomainsText(event.target.value)}
              placeholder="@spencerstuart.com"
              rows={5}
            />
            <small className="meta">Un dominio por linea. La app los normaliza con @ al guardar.</small>
          </label>
          <Button disabled={saving || !displayName.trim()} icon="plus" tone="primary" type="submit">
            {saving ? "Guardando..." : "Crear empresa"}
          </Button>
        </form>

        <div className="headhunters-master-list">
          {loading ? <span className="empty">Cargando maestro...</span> : null}
          {!loading && !companies.length && !error ? <span className="empty">Aun no hay empresas registradas.</span> : null}
          {companies.map((company) => (
            <article className="headhunters-master-row" key={company.id}>
              <strong>{company.displayName}</strong>
              <span>{company.domains.length ? company.domains.join(" · ") : <EmptyValue>sin dominios</EmptyValue>}</span>
            </article>
          ))}
        </div>
      </div> : null}

      {message ? <p className="meta">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function splitLines(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readableMasterError(error: unknown) {
  const message = error instanceof Error ? error.message : "No pude leer el maestro.";
  if (message.includes("headhunter_companies") || message.includes("Could not find the table")) {
    return "Falta instalar el maestro en Supabase. Ejecuta el SQL add_headhunter_company_master_v0_1.";
  }
  if (message.includes("uq_headhunter_companies_name_active") || message.includes("uq_headhunter_companies_user_name_active")) {
    return "Esa empresa ya existe en el maestro.";
  }
  if (message.includes("uq_headhunter_company_domains_domain_active") || message.includes("uq_headhunter_company_domains_user_domain_active")) {
    return "Uno de esos dominios ya esta asociado a otra empresa.";
  }
  return message;
}
