"use client";

import { useEffect, useMemo, useState } from "react";
import {
  grantUserRole,
  loadAccessAdminModel,
  saveUserPlan,
  setUserRoleActive,
  type AccessAdminModel,
  type AccessRole,
  type AccessUser
} from "../lib/accessAdminActions";
import {
  authorizeBetaAccessEmail,
  betaAllowlistLabel,
  betaEffectiveAccessLabel,
  betaRegistrationLabel,
  loadBetaAccessAllowlist,
  loadBetaAccessDiagnostic,
  normalizeAdminEmailInput,
  revokeBetaAccessEmail,
  type BetaAccessRow
} from "../lib/betaAccessAdminActions";
import { Button } from "./ui/Button";

type DraftRoleByUser = Record<string, string>;
type DiagnosticByUser = Record<string, BetaAccessRow | null>;
type ExpandedCapabilitiesByUser = Record<string, boolean>;
type AccessFilter =
  | "all"
  | "authorized"
  | "revoked"
  | "registered"
  | "unregistered"
  | "allowed"
  | "blocked";

type AccessTableRow = {
  accessAllowed: boolean | null;
  accessReason: string;
  accountStatus: string;
  allowlist?: BetaAccessRow;
  allowlistStatus: BetaAccessRow["allowlistStatus"];
  betaAccessStatus: string;
  capabilities: string[];
  email: string;
  fullName: string;
  note: string;
  planCode: string;
  registered: boolean;
  roles: string[];
  rowId: string;
  user?: AccessUser;
  userId: string;
};

const ACCESS_FILTERS: Array<{ label: string; value: AccessFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Autorizados", value: "authorized" },
  { label: "Revocados", value: "revoked" },
  { label: "Registrados", value: "registered" },
  { label: "No registrados", value: "unregistered" },
  { label: "Acceso permitido", value: "allowed" },
  { label: "Acceso bloqueado", value: "blocked" }
];

export function AccessAdminPanel() {
  const [model, setModel] = useState<AccessAdminModel | null>(null);
  const [allowlistRows, setAllowlistRows] = useState<BetaAccessRow[]>([]);
  const [draftRoles, setDraftRoles] = useState<DraftRoleByUser>({});
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccessFilter>("all");
  const [selectedRowId, setSelectedRowId] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticByUser>({});
  const [diagnosticLoading, setDiagnosticLoading] = useState("");
  const [expandedCapabilities, setExpandedCapabilities] = useState<ExpandedCapabilitiesByUser>({});
  const [showAccessCatalogs, setShowAccessCatalogs] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  const activeRoles = useMemo(() => model?.roles.filter((role) => role.isActive) ?? [], [model]);
  const activePlans = useMemo(() => model?.plans.filter((plan) => plan.isActive) ?? [], [model]);
  const activeSystemAdminCount = useMemo(
    () => model?.users.reduce((count, user) => (
      count + (user.roles.some((role) => role.roleCode === "system_admin" && role.isActive) ? 1 : 0)
    ), 0) ?? 0,
    [model]
  );
  const normalizedEmail = useMemo(() => normalizeAdminEmailInput(email), [email]);
  const rows = useMemo(
    () => buildAccessRows(model, allowlistRows).sort(compareAccessRows),
    [allowlistRows, model]
  );
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesAccessFilter(row, filter, query)),
    [filter, query, rows]
  );
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowIds.includes(row.rowId)),
    [rows, selectedRowIds]
  );
  const selectedDetail = rows.find((row) => row.rowId === selectedRowId) ?? filteredRows[0] ?? rows[0] ?? null;
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedRowIds.includes(row.rowId));
  const revokeEligibleRows = selectedRows.filter((row) => row.allowlistStatus === "authorized" && row.email);
  const reauthorizeEligibleRows = selectedRows.filter((row) => row.allowlistStatus === "revoked" && row.email);

  useEffect(() => {
    if (!selectedDetail) {
      setSelectedRowId("");
      return;
    }
    if (!rows.some((row) => row.rowId === selectedRowId)) {
      setSelectedRowId(selectedDetail.rowId);
    }
  }, [rows, selectedDetail, selectedRowId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextModel, nextAllowlistRows] = await Promise.all([
        loadAccessAdminModel(),
        loadBetaAccessAllowlist()
      ]);
      setModel(nextModel);
      setAllowlistRows(nextAllowlistRows);
      setDraftRoles(defaultDraftRoles(nextModel.users, nextModel.roles));
      setSelectedRowIds((current) => current.filter((rowId) => (
        buildAccessRows(nextModel, nextAllowlistRows).some((row) => row.rowId === rowId)
      )));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pude cargar accesos.");
    } finally {
      setLoading(false);
    }
  }

  async function authorize() {
    if (!normalizedEmail) return;
    setSaving(`authorize-${normalizedEmail}`);
    setMessage("");
    setError("");
    try {
      await authorizeBetaAccessEmail(normalizedEmail, note);
      setEmail("");
      setNote("");
      setMessage("Email autorizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude autorizar el email.");
    } finally {
      setSaving("");
    }
  }

  async function revoke(row: AccessTableRow) {
    if (!row.email) return;
    if (row.registered) {
      const confirmed = window.confirm(
        `Revocar el acceso de ${row.email}? La persona no podra entrar, pero sus datos no se borraran.`
      );
      if (!confirmed) return;
    }

    setSaving(`revoke-${row.email}`);
    setMessage("");
    setError("");
    try {
      await revokeBetaAccessEmail(row.email);
      setMessage("Acceso revocado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude revocar el acceso.");
    } finally {
      setSaving("");
    }
  }

  async function reauthorize(row: AccessTableRow) {
    if (!row.email) return;
    setSaving(`reauthorize-${row.email}`);
    setMessage("");
    setError("");
    try {
      await authorizeBetaAccessEmail(row.email, row.note);
      setMessage(row.allowlistStatus === "missing" ? "Email autorizado." : "Email reautorizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude reautorizar el email.");
    } finally {
      setSaving("");
    }
  }

  async function bulkRevoke() {
    if (!revokeEligibleRows.length) return;
    const skipped = selectedRows.length - revokeEligibleRows.length;
    const confirmed = window.confirm(
      `Revocar ${revokeEligibleRows.length} acceso(s)?${skipped ? ` ${skipped} fila(s) no aplican y quedaran sin cambios.` : ""}`
    );
    if (!confirmed) return;
    setSaving("bulk-revoke");
    setMessage("");
    setError("");
    try {
      for (const row of revokeEligibleRows) {
        await revokeBetaAccessEmail(row.email);
      }
      setMessage(`Revocados: ${revokeEligibleRows.length}${skipped ? ` · sin cambios: ${skipped}` : ""}.`);
      setSelectedRowIds([]);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude revocar la seleccion.");
    } finally {
      setSaving("");
    }
  }

  async function bulkReauthorize() {
    if (!reauthorizeEligibleRows.length) return;
    const skipped = selectedRows.length - reauthorizeEligibleRows.length;
    const confirmed = window.confirm(
      `Reautorizar ${reauthorizeEligibleRows.length} acceso(s)?${skipped ? ` ${skipped} fila(s) no aplican y quedaran sin cambios.` : ""}`
    );
    if (!confirmed) return;
    setSaving("bulk-reauthorize");
    setMessage("");
    setError("");
    try {
      for (const row of reauthorizeEligibleRows) {
        await authorizeBetaAccessEmail(row.email, row.note);
      }
      setMessage(`Reautorizados: ${reauthorizeEligibleRows.length}${skipped ? ` · sin cambios: ${skipped}` : ""}.`);
      setSelectedRowIds([]);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude reautorizar la seleccion.");
    } finally {
      setSaving("");
    }
  }

  async function updatePlan(user: AccessUser, planCode: string) {
    const nextPlan = activePlans.find((plan) => plan.planCode === planCode);
    const confirmed = window.confirm(
      `Cambiar plan de ${user.email || user.fullName || "este usuario"} a ${nextPlan?.displayName ?? "Sin plan"}?`
    );
    if (!confirmed) return;
    setSaving(`plan-${user.userId}`);
    setMessage("");
    setError("");
    try {
      await saveUserPlan(user.userId, planCode);
      setMessage("Plan actualizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude guardar el plan.");
    } finally {
      setSaving("");
    }
  }

  async function addRole(user: AccessUser) {
    const roleCode = draftRoles[user.userId];
    if (!roleCode) return;
    const role = activeRoles.find((activeRole) => activeRole.roleCode === roleCode);
    const confirmed = window.confirm(
      `Asignar rol ${role?.displayName ?? roleCode} a ${user.email || user.fullName || "este usuario"}?`
    );
    if (!confirmed) return;
    setSaving(`role-${user.userId}`);
    setMessage("");
    setError("");
    try {
      await grantUserRole(user.userId, roleCode);
      setMessage("Rol asignado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude asignar el rol.");
    } finally {
      setSaving("");
    }
  }

  async function toggleRole(user: AccessUser, role: AccessUser["roles"][number], isActive: boolean) {
    if (!model) return;
    const roleDefinition = model.roles.find((availableRole) => availableRole.roleCode === role.roleCode);
    const targetUser = user.email || user.fullName || "este usuario";

    if (!isActive && role.roleCode === "system_admin" && activeSystemAdminCount <= 1) {
      setMessage("");
      setError("No puedes desactivar el ultimo administrador sistema.");
      return;
    }

    if (!isActive && user.userId === model.currentUserId && role.roleCode === "system_admin") {
      const typedConfirmation = window.prompt(
        "Estas desactivando tu propio rol de administrador sistema. Para confirmar, escribe: DESACTIVAR MI ADMIN"
      );
      if (typedConfirmation !== "DESACTIVAR MI ADMIN") return;
    } else {
      const action = isActive ? "Activar" : "Desactivar";
      const confirmed = window.confirm(
        `${action} rol ${roleDefinition?.displayName ?? role.roleCode} para ${targetUser}?`
      );
      if (!confirmed) return;
    }

    const assignmentId = role.assignmentId;
    setSaving(assignmentId);
    setMessage("");
    setError("");
    try {
      await setUserRoleActive(assignmentId, isActive);
      setMessage(isActive ? "Rol activado." : "Rol desactivado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude cambiar el rol.");
    } finally {
      setSaving("");
    }
  }

  async function toggleDiagnostic(row: AccessTableRow) {
    const user = row.user;
    if (!user) return;
    if (diagnostics[user.userId] !== undefined) {
      setDiagnostics((current) => {
        const next = { ...current };
        delete next[user.userId];
        return next;
      });
      setExpandedCapabilities((current) => {
        const next = { ...current };
        delete next[user.userId];
        return next;
      });
      return;
    }

    setDiagnosticLoading(user.userId);
    setMessage("");
    setError("");
    try {
      const diagnostic = await loadBetaAccessDiagnostic(user.userId);
      setDiagnostics((current) => ({ ...current, [user.userId]: diagnostic }));
    } catch (diagnosticError) {
      setError(diagnosticError instanceof Error ? diagnosticError.message : "No pude cargar el diagnostico.");
    } finally {
      setDiagnosticLoading("");
    }
  }

  function toggleRowSelection(rowId: string) {
    setSelectedRowIds((current) => (
      current.includes(rowId) ? current.filter((currentId) => currentId !== rowId) : [...current, rowId]
    ));
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      setSelectedRowIds((current) => current.filter((rowId) => !filteredRows.some((row) => row.rowId === rowId)));
      return;
    }
    setSelectedRowIds((current) => [...new Set([...current, ...filteredRows.map((row) => row.rowId)])]);
  }

  return (
    <section className="maintenance-service-group access-admin-panel">
      <div className="maintenance-service-header">
        <h3>Accesos</h3>
        <span>{loading ? "cargando" : `${filteredRows.length} de ${rows.length} registro(s)`}</span>
      </div>

      <p className="meta">
        Administra acceso beta, usuarios registrados, planes y roles desde una sola tabla.
      </p>

      <div className="access-admin-authorize">
        <label className="field">
          <span>Email</span>
          <input
            placeholder="usuario@empresa.com"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Nota admin</span>
          <input
            placeholder="opcional"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button disabled={!normalizedEmail || Boolean(saving)} icon="check" onClick={authorize} tone="primary">
          {saving === `authorize-${normalizedEmail}` ? "Autorizando..." : "Autorizar email"}
        </Button>
      </div>

      {message ? <p className="meta">{message}</p> : null}
      {error ? <p className="form-error">{friendlyAccessError(error)}</p> : null}

      <div className="access-table-toolbar">
        <label className="search-field access-search">
          <span className="sr-only">Buscar acceso</span>
          <input
            placeholder="Buscar por nombre, email, plan o rol"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="access-filter-tabs" aria-label="Filtro de accesos">
          {ACCESS_FILTERS.map((option) => (
            <button
              aria-pressed={filter === option.value}
              className={filter === option.value ? "active" : ""}
              key={option.value}
              onClick={() => setFilter(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="access-bulk-bar">
        <span>{selectedRows.length} seleccionado(s)</span>
        <Button disabled={!revokeEligibleRows.length || Boolean(saving)} icon="close" onClick={bulkRevoke} tone="danger">
          Revocar
        </Button>
        <Button disabled={!reauthorizeEligibleRows.length || Boolean(saving)} icon="check" onClick={bulkReauthorize}>
          Reautorizar
        </Button>
      </div>

      <div className="table-wrap access-table-wrap">
        <table className="table access-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label="Seleccionar filas visibles"
                  checked={allVisibleSelected}
                  disabled={!filteredRows.length}
                  type="checkbox"
                  onChange={toggleVisibleSelection}
                />
              </th>
              <th>Nombre / email</th>
              <th>Registrado</th>
              <th>Allowlist</th>
              <th>Acceso</th>
              <th>Cuenta</th>
              <th>Beta</th>
              <th>Plan</th>
              <th>Roles</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9}>Cargando accesos...</td>
              </tr>
            ) : null}
            {!loading && !filteredRows.length ? (
              <tr>
                <td colSpan={9}>No hay registros para este filtro.</td>
              </tr>
            ) : null}
            {!loading && filteredRows.map((row) => (
              <tr
                className={selectedDetail?.rowId === row.rowId ? "selected" : ""}
                key={row.rowId}
                onClick={() => setSelectedRowId(row.rowId)}
              >
                <td onClick={(event) => event.stopPropagation()}>
                  <input
                    aria-label={`Seleccionar ${row.email || row.fullName}`}
                    checked={selectedRowIds.includes(row.rowId)}
                    type="checkbox"
                    onChange={() => toggleRowSelection(row.rowId)}
                  />
                </td>
                <td>
                  <button className="access-name-button" onClick={() => setSelectedRowId(row.rowId)} type="button">
                    <strong>{row.fullName || row.email || "Usuario sin nombre"}</strong>
                    <span>{row.email || "sin correo"}</span>
                  </button>
                </td>
                <td>{betaRegistrationLabel(row)}</td>
                <td><AccessStatusPill status={row.allowlistStatus} /></td>
                <td>{accessLabel(row)}</td>
                <td>{row.accountStatus || "sin perfil"}</td>
                <td>{row.betaAccessStatus || "sin perfil"}</td>
                <td>{displayPlanName(row.planCode, activePlans)}</td>
                <td><CompactInlineList values={row.roles} emptyValue="sin roles" limit={2} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AccessDetailPanel
        activePlans={activePlans}
        activeRoles={activeRoles}
        diagnostic={selectedDetail?.user ? diagnostics[selectedDetail.user.userId] : undefined}
        diagnosticLoading={diagnosticLoading}
        draftRole={selectedDetail?.user ? draftRoles[selectedDetail.user.userId] ?? "" : ""}
        expandedCapabilities={selectedDetail?.user ? Boolean(expandedCapabilities[selectedDetail.user.userId]) : false}
        row={selectedDetail}
        saving={saving}
        onAddRole={addRole}
        onReauthorize={reauthorize}
        onRevoke={revoke}
        onToggleCapabilityExpansion={() => {
          if (!selectedDetail?.user) return;
          setExpandedCapabilities((current) => ({
            ...current,
            [selectedDetail.user!.userId]: !current[selectedDetail.user!.userId]
          }));
        }}
        onToggleDiagnostic={toggleDiagnostic}
        onToggleRole={toggleRole}
        onUpdateDraftRole={(userId, roleCode) => setDraftRoles((current) => ({ ...current, [userId]: roleCode }))}
        onUpdatePlan={updatePlan}
      />

      <section className="access-catalogs">
        <button
          aria-expanded={showAccessCatalogs}
          className="access-catalogs-toggle"
          onClick={() => setShowAccessCatalogs((current) => !current)}
          type="button"
        >
          <span>
            <strong>Configuracion disponible</strong>
            <em>
              {(model?.plans.length ?? 0)} planes · {(model?.roles.length ?? 0)} roles ·{" "}
              {(model?.capabilities.length ?? 0)} capacidades
            </em>
          </span>
          <b>{showAccessCatalogs ? "Ocultar" : "Ver detalles"}</b>
        </button>

        {showAccessCatalogs ? (
          <div className="access-admin-summary">
            <AccessSummary title="Planes" items={model?.plans.map((plan) => `${plan.displayName} · ${plan.planCode}`) ?? []} />
            <AccessSummary title="Roles" items={model?.roles.map((role) => `${role.displayName} · ${role.roleCode}`) ?? []} />
            <AccessSummary
              title="Capacidades"
              items={model?.capabilities.map((capability) => `${capability.capabilityArea} · ${capability.displayName}`) ?? []}
            />
          </div>
        ) : null}
      </section>
    </section>
  );
}

function AccessDetailPanel({
  activePlans,
  activeRoles,
  diagnostic,
  diagnosticLoading,
  draftRole,
  expandedCapabilities,
  row,
  saving,
  onAddRole,
  onReauthorize,
  onRevoke,
  onToggleCapabilityExpansion,
  onToggleDiagnostic,
  onToggleRole,
  onUpdateDraftRole,
  onUpdatePlan
}: {
  activePlans: AccessAdminModel["plans"];
  activeRoles: AccessRole[];
  diagnostic: BetaAccessRow | null | undefined;
  diagnosticLoading: string;
  draftRole: string;
  expandedCapabilities: boolean;
  row: AccessTableRow | null;
  saving: string;
  onAddRole: (user: AccessUser) => void;
  onReauthorize: (row: AccessTableRow) => void;
  onRevoke: (row: AccessTableRow) => void;
  onToggleCapabilityExpansion: () => void;
  onToggleDiagnostic: (row: AccessTableRow) => void;
  onToggleRole: (user: AccessUser, role: AccessUser["roles"][number], isActive: boolean) => void;
  onUpdateDraftRole: (userId: string, roleCode: string) => void;
  onUpdatePlan: (user: AccessUser, planCode: string) => void;
}) {
  if (!row) {
    return <section className="access-detail-panel empty">Selecciona un registro para revisar su detalle.</section>;
  }

  const user = row.user;

  return (
    <section className="access-detail-panel">
      <div className="access-detail-header">
        <div>
          <h4>{row.fullName || row.email || "Usuario sin nombre"}</h4>
          <span>{row.email || "sin correo"}</span>
        </div>
        <div className="access-detail-actions">
          <Button
            disabled={row.allowlistStatus !== "authorized" || !row.email || saving === `revoke-${row.email}`}
            icon="close"
            onClick={() => onRevoke(row)}
            tone="danger"
          >
            Revocar
          </Button>
          <Button
            disabled={
              (row.allowlistStatus !== "revoked" && row.allowlistStatus !== "missing")
              || !row.email
              || saving === `reauthorize-${row.email}`
            }
            icon="check"
            onClick={() => onReauthorize(row)}
          >
            {row.allowlistStatus === "missing" ? "Autorizar" : "Reautorizar"}
          </Button>
          <Button
            disabled={!user || diagnosticLoading === user.userId}
            icon="history"
            onClick={() => onToggleDiagnostic(row)}
          >
            {diagnostic !== undefined ? "Ocultar diagnostico" : "Diagnosticar acceso"}
          </Button>
        </div>
      </div>

      <div className="access-detail-grid">
        <AccessDetailFact label="Registrado" value={betaRegistrationLabel(row)} />
        <AccessDetailFact label="Acceso" value={accessLabel(row)} />
        <AccessDetailFact label="Allowlist" value={betaAllowlistLabel(row.allowlistStatus)} />
        <AccessDetailFact label="Cuenta" value={user ? row.accountStatus || "sin perfil" : "No aplica"} />
        <AccessDetailFact label="Beta" value={user ? row.betaAccessStatus || "sin perfil" : "No aplica"} />
        <AccessDetailFact label="Plan" value={user ? displayPlanName(row.planCode, activePlans) : "Disponible después del registro"} />
      </div>

      <div className="access-detail-edit">
        <label className="field">
          <span>Plan</span>
          <select
            disabled={!user || saving === `plan-${user?.userId}`}
            value={user?.planCode ?? ""}
            onChange={(event) => {
              if (user) onUpdatePlan(user, event.target.value);
            }}
          >
            <option value="">Sin plan</option>
            {activePlans.map((plan) => (
              <option key={plan.planCode} value={plan.planCode}>{plan.displayName}</option>
            ))}
          </select>
          {!user ? <small className="meta">Disponible después del registro</small> : null}
        </label>

        <div className="access-detail-section">
          <span>Roles</span>
          <div className="access-role-list">
            {user?.roles.length ? user.roles.map((role) => (
              <button
                className={`access-role-pill ${role.isActive ? "active" : ""}`}
                disabled={saving === role.assignmentId}
                key={role.assignmentId}
                onClick={() => onToggleRole(user, role, !role.isActive)}
                title={role.isActive ? "Desactivar rol" : "Activar rol"}
                type="button"
              >
                {role.roleCode}
              </button>
            )) : (
              <span className="empty">{user ? "sin roles" : "Disponible después del registro"}</span>
            )}
          </div>
        </div>

        <div className="access-detail-section">
          <span>Agregar rol</span>
          <div className="access-role-add">
            <select
              disabled={!user}
              value={user ? draftRole : ""}
              onChange={(event) => {
                if (user) onUpdateDraftRole(user.userId, event.target.value);
              }}
            >
              {!user ? <option value="">No aplica</option> : null}
              {activeRoles.map((role) => (
                <option key={role.roleCode} value={role.roleCode}>{role.displayName}</option>
              ))}
            </select>
            <Button disabled={!user || saving === `role-${user?.userId}`} icon="plus" onClick={() => user && onAddRole(user)}>
              Agregar rol
            </Button>
          </div>
        </div>
      </div>

      <AccessDiagnosticList
        canExpand
        expanded={expandedCapabilities}
        label="Capacidades"
        limit={4}
        values={user ? diagnostic?.capabilities ?? row.capabilities : []}
        emptyValue={user ? "sin capacidades efectivas" : "No aplica hasta que exista un usuario registrado"}
        onToggle={onToggleCapabilityExpansion}
      />

      <div className="access-diagnostic-detail">
        {!user ? (
          <div className="access-diagnostic-line">
            <strong>Diagnostico no disponible</strong>
            <span>Disponible después del registro.</span>
          </div>
        ) : diagnostic === undefined ? (
          <div className="access-diagnostic-line">
            <strong>Diagnostico tecnico</strong>
            <span>Usa Diagnosticar acceso para revisar el acceso efectivo.</span>
          </div>
        ) : diagnostic ? (
          <>
            <div className="access-diagnostic-line">
              <strong>{betaEffectiveAccessLabel(diagnostic)}</strong>
              <span>Allowlist: {betaAllowlistLabel(diagnostic.allowlistStatus)}</span>
            </div>
            <div className="access-diagnostic-facts">
              <AccessDiagnosticFact label="Cuenta" value={diagnostic.accountStatus || "sin perfil"} />
              <AccessDiagnosticFact label="Beta" value={diagnostic.betaAccessStatus || "sin perfil"} />
              <AccessDiagnosticFact label="Plan" value={diagnostic.planCode || "sin plan"} />
            </div>
            <AccessDiagnosticList label="Roles" values={diagnostic.roles} emptyValue="sin roles" />
          </>
        ) : (
          <div className="access-diagnostic-line">
            <strong>Diagnostico sin datos</strong>
            <span>No hay informacion para este usuario.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function AccessDetailFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <b>{label}</b>
      <em>{value}</em>
    </span>
  );
}

function AccessDiagnosticFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <b>{label}:</b> {value}
    </span>
  );
}

function AccessDiagnosticList({
  canExpand = false,
  emptyValue = "sin dato",
  expanded = false,
  label,
  limit = 99,
  onToggle,
  values
}: {
  canExpand?: boolean;
  emptyValue?: string;
  expanded?: boolean;
  label: string;
  limit?: number;
  onToggle?: () => void;
  values: string[];
}) {
  const visibleValues = expanded ? values : values.slice(0, limit);
  const hiddenCount = Math.max(values.length - visibleValues.length, 0);

  return (
    <div className="access-diagnostic-list">
      <span>{label}</span>
      {values.length ? (
        <div className="access-diagnostic-chip-list">
          {visibleValues.map((item) => <em key={item}>{item}</em>)}
          {!expanded && hiddenCount > 0 ? <em>+{hiddenCount}</em> : null}
          {canExpand && values.length > limit ? (
            <button onClick={onToggle} type="button">
              {expanded ? "Ocultar" : "Ver todas"}
            </button>
          ) : null}
        </div>
      ) : (
        <strong>{emptyValue}</strong>
      )}
    </div>
  );
}

function AccessStatusPill({ status }: { status: BetaAccessRow["allowlistStatus"] }) {
  return (
    <span className={`access-status-pill ${status}`}>
      {betaAllowlistLabel(status)}
    </span>
  );
}

function CompactInlineList({
  emptyValue,
  limit,
  values
}: {
  emptyValue: string;
  limit: number;
  values: string[];
}) {
  if (!values.length) return <span className="access-muted-cell">{emptyValue}</span>;
  const visibleValues = values.slice(0, limit);
  const hiddenCount = values.length - visibleValues.length;
  return (
    <span className="access-inline-list">
      {visibleValues.join(" · ")}
      {hiddenCount > 0 ? ` · +${hiddenCount}` : ""}
    </span>
  );
}

function AccessSummary({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="access-summary-block">
      <strong>{title}</strong>
      <div>
        {items.slice(0, 10).map((item) => <span key={item}>{item}</span>)}
        {items.length > 10 ? <span>+{items.length - 10} mas</span> : null}
        {!items.length ? <span>sin datos</span> : null}
      </div>
    </div>
  );
}

function buildAccessRows(model: AccessAdminModel | null, allowlistRows: BetaAccessRow[]): AccessTableRow[] {
  const rowsByKey = new Map<string, AccessTableRow>();
  const allowlistByEmail = new Map(allowlistRows.map((row) => [row.email.toLowerCase(), row]));

  for (const user of model?.users ?? []) {
    const emailKey = user.email.toLowerCase();
    const allowlist = emailKey ? allowlistByEmail.get(emailKey) : undefined;
    if (allowlist) allowlistByEmail.delete(emailKey);
    const row = rowFromUser(user, allowlist);
    rowsByKey.set(row.rowId, row);
  }

  for (const allowlist of allowlistByEmail.values()) {
    const row = rowFromAllowlist(allowlist);
    rowsByKey.set(row.rowId, row);
  }

  return [...rowsByKey.values()];
}

function rowFromUser(user: AccessUser, allowlist?: BetaAccessRow): AccessTableRow {
  return {
    accessAllowed: allowlist?.accessAllowed ?? null,
    accessReason: allowlist?.accessReason ?? "",
    accountStatus: allowlist?.accountStatus || user.accountStatus,
    allowlist,
    allowlistStatus: allowlist?.allowlistStatus ?? "missing",
    betaAccessStatus: allowlist?.betaAccessStatus || user.betaAccessStatus,
    capabilities: allowlist?.capabilities ?? [],
    email: user.email,
    fullName: user.fullName,
    note: allowlist?.note ?? "",
    planCode: allowlist?.planCode || user.planCode,
    registered: true,
    roles: user.roles.map((role) => role.roleCode),
    rowId: `user:${user.userId}`,
    user,
    userId: user.userId
  };
}

function rowFromAllowlist(allowlist: BetaAccessRow): AccessTableRow {
  return {
    accessAllowed: allowlist.accessAllowed,
    accessReason: allowlist.accessReason,
    accountStatus: allowlist.accountStatus,
    allowlist,
    allowlistStatus: allowlist.allowlistStatus,
    betaAccessStatus: allowlist.betaAccessStatus,
    capabilities: allowlist.capabilities,
    email: allowlist.email,
    fullName: "",
    note: allowlist.note,
    planCode: allowlist.planCode,
    registered: allowlist.registered,
    roles: allowlist.roles,
    rowId: `email:${allowlist.email}`,
    userId: allowlist.userId
  };
}

function matchesAccessFilter(row: AccessTableRow, filter: AccessFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const queryMatches = !normalizedQuery || [
    row.fullName,
    row.email,
    row.allowlistStatus,
    row.accountStatus,
    row.betaAccessStatus,
    row.planCode,
    ...row.roles
  ].some((value) => value.toLowerCase().includes(normalizedQuery));

  if (!queryMatches) return false;
  if (filter === "authorized") return row.allowlistStatus === "authorized";
  if (filter === "revoked") return row.allowlistStatus === "revoked";
  if (filter === "registered") return row.registered;
  if (filter === "unregistered") return !row.registered;
  if (filter === "allowed") return row.accessAllowed === true;
  if (filter === "blocked") return row.accessAllowed === false;
  return true;
}

function compareAccessRows(left: AccessTableRow, right: AccessTableRow) {
  if (left.registered !== right.registered) return left.registered ? -1 : 1;
  const leftName = left.fullName || left.email;
  const rightName = right.fullName || right.email;
  return leftName.localeCompare(rightName, "es");
}

function accessLabel(row: Pick<AccessTableRow, "accessAllowed" | "accessReason" | "registered">) {
  if (row.accessAllowed === true || row.accessAllowed === false) return betaEffectiveAccessLabel(row);
  return row.registered ? "Sin diagnosticar" : "No aplica hasta registro";
}

function displayPlanName(planCode: string, plans: AccessAdminModel["plans"]) {
  if (!planCode) return "sin plan";
  return plans.find((plan) => plan.planCode === planCode)?.displayName ?? planCode;
}

function defaultDraftRoles(users: AccessUser[], roles: AccessRole[]): DraftRoleByUser {
  const firstRole = roles.find((role) => role.isActive)?.roleCode ?? "";
  return Object.fromEntries(users.map((user) => [user.userId, firstRole]));
}

function friendlyAccessError(message: string) {
  if (message.includes("admin.manage_access")) return "Tu usuario no tiene permiso para administrar accesos.";
  if (message.includes("invalid email")) return "Revisa el formato del email.";
  if (message.includes("cannot revoke own app access")) {
    return "No puedes revocar tu propio acceso desde Coffeecito. Usa otro administrador para hacerlo.";
  }
  if (message.includes("app_roles") || message.includes("user_access_profiles")) {
    return "Falta ejecutar el modelo de acceso v0.1.";
  }
  return message;
}
