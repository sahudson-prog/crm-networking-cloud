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
import { Button } from "./ui/Button";

type DraftRoleByUser = Record<string, string>;

export function AccessAdminPanel() {
  const [model, setModel] = useState<AccessAdminModel | null>(null);
  const [draftRoles, setDraftRoles] = useState<DraftRoleByUser>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
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

  async function load() {
    setLoading(true);
    setError("");
    try {
      const nextModel = await loadAccessAdminModel();
      setModel(nextModel);
      setDraftRoles(defaultDraftRoles(nextModel.users, nextModel.roles));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pude cargar accesos.");
    } finally {
      setLoading(false);
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

  return (
    <section className="maintenance-service-group">
      <div className="maintenance-service-header">
        <h3>Accesos</h3>
        <span>{loading ? "cargando" : `${model?.users.length ?? 0} usuario(s)`}</span>
      </div>

      <p className="meta">
        Gestiona usuarios, planes y roles desde datos persistentes. Cada cambio pide confirmacion antes de guardarse.
      </p>

      {message ? <p className="meta">{message}</p> : null}
      {error ? <p className="form-error">{friendlyAccessError(error)}</p> : null}

      <div className="access-admin-grid">
        <div className="access-admin-users">
          {loading ? <span className="empty">Cargando usuarios...</span> : null}
          {!loading && !model?.users.length ? <span className="empty">Aun no hay usuarios.</span> : null}
          {model?.users.map((user) => (
            <article className="access-user-row" key={user.userId}>
              <div className="access-user-main">
                <strong>{user.email || user.fullName || "Usuario sin correo"}</strong>
                <span>{user.fullName || "sin nombre"} · {user.accountStatus} · beta {user.betaAccessStatus}</span>
              </div>

              <label className="field access-user-plan">
                <span>Plan</span>
                <select
                  disabled={saving === `plan-${user.userId}`}
                  value={user.planCode}
                  onChange={(event) => updatePlan(user, event.target.value)}
                >
                  <option value="">Sin plan</option>
                  {activePlans.map((plan) => (
                    <option key={plan.planCode} value={plan.planCode}>{plan.displayName}</option>
                  ))}
                </select>
              </label>

              <div className="access-role-list">
                {user.roles.length ? user.roles.map((role) => (
                  <button
                    className={`access-role-pill ${role.isActive ? "active" : ""}`}
                    disabled={saving === role.assignmentId}
                    key={role.assignmentId}
                    onClick={() => toggleRole(user, role, !role.isActive)}
                    title={role.isActive ? "Desactivar rol" : "Activar rol"}
                    type="button"
                  >
                    {role.roleCode}
                  </button>
                )) : <span className="empty">sin roles</span>}
              </div>

              <div className="access-role-add">
                <select
                  value={draftRoles[user.userId] ?? ""}
                  onChange={(event) => setDraftRoles((current) => ({ ...current, [user.userId]: event.target.value }))}
                >
                  {activeRoles.map((role) => (
                    <option key={role.roleCode} value={role.roleCode}>{role.displayName}</option>
                  ))}
                </select>
                <Button disabled={saving === `role-${user.userId}`} icon="plus" onClick={() => addRole(user)}>
                  Agregar rol
                </Button>
              </div>
            </article>
          ))}
        </div>

        <div className="access-admin-summary">
          <AccessSummary title="Planes" items={model?.plans.map((plan) => `${plan.displayName} · ${plan.planCode}`) ?? []} />
          <AccessSummary title="Roles" items={model?.roles.map((role) => `${role.displayName} · ${role.roleCode}`) ?? []} />
          <AccessSummary
            title="Capacidades"
            items={model?.capabilities.map((capability) => `${capability.capabilityArea} · ${capability.displayName}`) ?? []}
          />
        </div>
      </div>
    </section>
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

function defaultDraftRoles(users: AccessUser[], roles: AccessRole[]): DraftRoleByUser {
  const firstRole = roles.find((role) => role.isActive)?.roleCode ?? "";
  return Object.fromEntries(users.map((user) => [user.userId, firstRole]));
}

function friendlyAccessError(message: string) {
  if (message.includes("app_roles") || message.includes("user_access_profiles")) {
    return "Falta ejecutar el modelo de acceso v0.1.";
  }
  return message;
}
