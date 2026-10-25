import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeInvitation, canAuthorizeInvitation, InvitationError, invitationRestriction,
  invitationShareLinks, loadInvitationAdminState, loadInvitations, parseInvitationAdminState,
  parseInvitationState, shareInvitationNatively,
  type InvitationRpcClient, type InvitationState
} from "../lib/invitations.ts";
import { resolveBootstrappedAppAccessForSession } from "../lib/appAccess.ts";

const fixture = (): InvitationState => ({
  personal_limit: 5, used_slots: 0, available_slots: 5, next_expiry_at: null,
  global_capacity: 500, used_capacity: 0, invitations_enabled: true, registrations_enabled: false, invitations: []
});
const row = { id: "synthetic", email: "invited@example.invalid", status: "pending" as const,
  authorized_at: "2026-10-25T12:00:00Z", expires_at: "2026-10-30T12:00:00Z", registered_at: null };
const client = (data: unknown, error: { message: string } | null = null): InvitationRpcClient => ({ rpc: async () => ({ data, error }) });

test("server quotas are preserved, including future personal limits and counts", async () => {
  const state = { ...fixture(), personal_limit: 9, available_slots: 7, used_slots: 2 };
  assert.deepEqual(await loadInvitations(client(state)), state);
});
test("malformed state fails closed", () => {
  for (const state of [null, {}, { ...fixture(), available_slots: -1 }, { ...fixture(), invitations_enabled: "true" },
    { ...fixture(), invitations: [{ ...row, expires_at: null }] }]) {
    assert.throws(() => parseInvitationState(state), InvitationError);
  }
});
test("administrative state uses its narrow RPC and rejects inconsistent aggregates", async () => {
  const value = {
    invitations_enabled: false, registrations_enabled: false, global_capacity: 500,
    pending_reservations: 3, registered_users: 2, used_capacity: 5,
    available_capacity: 495, updated_at: "2026-10-25T12:00:00Z"
  };
  const calls: string[] = [];
  const api: InvitationRpcClient = { rpc: async (name) => { calls.push(name); return { data: value, error: null }; } };
  assert.deepEqual(await loadInvitationAdminState(api), value);
  assert.deepEqual(calls, ["admin_invitation_program_state_v1"]);
  assert.throws(() => parseInvitationAdminState({ ...value, used_capacity: 6 }), InvitationError);
  assert.throws(() => parseInvitationAdminState({ ...value, email: "private@example.invalid" }), InvitationError);
});
test("pausing invitations blocks authorization but suspending registrations does not", () => {
  assert.equal(canAuthorizeInvitation(fixture()), true);
  assert.match(invitationRestriction(fixture()), /Puedes autorizar/);
  assert.equal(canAuthorizeInvitation({ ...fixture(), invitations_enabled: false }), false);
  assert.equal(canAuthorizeInvitation({ ...fixture(), used_capacity: 500 }), false);
  assert.equal(canAuthorizeInvitation({ ...fixture(), available_slots: 0 }), false);
});
test("authorization sends only normalized email and binds sharing to returned identity", async () => {
  const calls: unknown[] = [];
  const api: InvitationRpcClient = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: { ...fixture(), invitations: [row], invitation_id: row.id, result: "authorized" }, error: null };
  } };
  const result = await authorizeInvitation(api, " Invited@EXAMPLE.invalid ");
  assert.deepEqual(calls, [["authorize_current_user_invitation_v1", { p_email: row.email }]]);
  assert.equal(result.invitation.email, row.email);
});
test("own duplicate reuses server invitation; malformed mutation response is uncertain", async () => {
  assert.equal((await authorizeInvitation(client({ ...fixture(), invitations: [row], invitation_id: row.id, result: "existing" }), row.email)).existing, true);
  await assert.rejects(authorizeInvitation(client(fixture()), row.email), (error: unknown) => error instanceof InvitationError && error.uncertain);
});
test("network uncertainty does not automatically retry a mutation", async () => {
  let calls = 0;
  const api: InvitationRpcClient = { rpc: async () => { calls++; throw new Error("sensitive transport detail"); } };
  await assert.rejects(authorizeInvitation(api, row.email), (error: unknown) => error instanceof InvitationError && error.uncertain && !error.message.includes("sensitive"));
  assert.equal(calls, 1);
});
test("blocked, unavailable and self emails have the same public error", async () => {
  for (const message of ["cannot_invite_self", "invitation_email_blocked", "invitation_email_unavailable"]) {
    await assert.rejects(authorizeInvitation(client(null, { message }), row.email), { message: "No podemos autorizar este email." });
  }
});
test("share URL carries no email, ID, token or authorization and mail recipients are encoded", () => {
  const links = invitationShareLinks("person+test@example.invalid", "https://app.example.invalid");
  assert.equal(links.url, "https://app.example.invalid/");
  assert.match(links.mail, /^mailto:person%2Btest%40example.invalid\?/);
  assert.ok(!links.whatsapp.includes("person"));
});
test("native sharing is invoked synchronously from a new gesture", async () => {
  let called = false;
  const nav = { share: async () => { called = true; }, canShare: () => true, userActivation: { isActive: true, hasBeenActive: true } };
  const result = shareInvitationNatively(nav, "https://app.example.invalid");
  assert.equal(called, true);
  assert.equal(await result, "shared");
});
test("no activation or rejected native sharing uses fallback; cancellation is not an error", async () => {
  const base = { canShare: () => true, userActivation: { isActive: false, hasBeenActive: true }, share: async () => { throw new Error("must not run"); } };
  assert.equal(await shareInvitationNatively(base, "https://app.example.invalid"), "fallback");
  assert.equal(await shareInvitationNatively({ ...base, userActivation: { isActive: true, hasBeenActive: true } }, "https://app.example.invalid"), "fallback");
  assert.equal(await shareInvitationNatively({ ...base, userActivation: { isActive: true, hasBeenActive: true }, share: async () => { throw new DOMException("cancelled", "AbortError"); } }, "https://app.example.invalid"), "cancelled");
});
test("bootstrap is awaited before central access, without client identity arguments", async () => {
  const calls: string[] = [];
  let release!: (value: { data: unknown; error: null }) => void;
  const pending = resolveBootstrappedAppAccessForSession({ user: { id: "synthetic" } }, {
    rpc: (name) => {
      calls.push(name);
      return name === "bootstrap_current_user_invitation_v1" ? new Promise((resolve) => { release = resolve; })
        : Promise.resolve({ data: [{ allowed: true, reason: "allowed" }], error: null });
    }
  });
  assert.deepEqual(calls, ["bootstrap_current_user_invitation_v1"]);
  release({ data: [{ allowed: true, reason: "allowed", access_source: "invitation" }], error: null });
  assert.deepEqual(await pending, { status: "allowed" });
  assert.deepEqual(calls, ["bootstrap_current_user_invitation_v1", "current_user_app_access_status"]);
});
test("blocked bootstrap, malformed response, failure and timeout never consult access", async () => {
  for (const response of [
    { data: [{ allowed: false, reason: "blocked" }], error: null },
    { data: null, error: null }, { data: null, error: { message: "private reason" } }
  ]) {
    const calls: string[] = [];
    const result = await resolveBootstrappedAppAccessForSession({ user: { id: "synthetic" } }, { rpc: async (name) => { calls.push(name); return response; } });
    assert.notEqual(result.status, "allowed");
    assert.deepEqual(calls, ["bootstrap_current_user_invitation_v1"]);
    assert.ok(!JSON.stringify(result).includes("private reason"));
  }
  assert.equal((await resolveBootstrappedAppAccessForSession({ user: {} }, { rpc: () => new Promise(() => {}) }, 1)).status, "error");
});
test("legacy and registered accounts still require positive central access; no session does no RPC", async () => {
  let calls = 0;
  const api = { rpc: async () => ({ data: [{ allowed: ++calls === 1, reason: "revoked" }], error: null }) };
  assert.equal((await resolveBootstrappedAppAccessForSession(null, api)).status, "unauthenticated");
  assert.equal(calls, 0);
  assert.equal((await resolveBootstrappedAppAccessForSession({ user: {} }, api)).status, "denied");
});
test("initial and retry gate bootstrap before legal; denied view does not expose identity/reason", () => {
  const gate = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /resolveBootstrappedAppAccessForSession\(currentSession, supabase\)/);
  assert.match(gate, /resolveBootstrappedAppAccessForSession\(session, supabase\)/);
  const denied = gate.slice(gate.indexOf('if (access.status === "denied")'), gate.indexOf('if (access.status === "error")'));
  assert.doesNotMatch(denied, /session.user.email|access.reason|administrador|href=/);
  assert.match(gate, /requestId !== accessRequestId.current/);
});
