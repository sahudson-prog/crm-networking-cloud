import { isValidEmail, isValidPhone, normalizeEmail } from "./contactActions";
import { cleanContactCompany, cleanContactRole } from "./format";
import { supabase } from "./supabaseClient";

export type ReferralEditorInput = {
  referralId?: string;
  referredByContactId: string;
  linkedContactId?: string | null;
  referredName: string;
  referredCompany: string;
  referredRole: string;
  referredEmail: string;
  referredPhone: string;
  notes: string;
  status?: "active" | "dismissed" | "converted";
  source?: string;
};

export async function saveReferralFromEditor(input: ReferralEditorInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const normalized = normalizeReferralEditorInput(input);
  if (!normalized.referredByContactId) throw new Error("Debe existir un contacto que refiere.");
  if (!hasReferralContent(normalized)) {
    throw new Error("Agrega al menos un dato del referido antes de guardar.");
  }
  if (normalized.referredEmail && !isValidEmail(normalized.referredEmail)) {
    throw new Error("El correo del referido no tiene un formato valido.");
  }
  if (normalized.referredPhone && !isValidPhone(normalized.referredPhone)) {
    throw new Error("El telefono del referido debe tener al menos 7 digitos.");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  await assertContactBelongsToUser(userId, normalized.referredByContactId, "No encontre el contacto que refiere.");
  if (normalized.linkedContactId) {
    await assertContactBelongsToUser(userId, normalized.linkedContactId, "No encontre el contacto vinculado.");
  }

  const isCreate = !normalized.referralId;
  const actionName = isCreate ? "referral.create" : "referral.update";
  const now = new Date().toISOString();
  const before = isCreate ? null : await readReferralSnapshot(userId, normalized.referralId);

  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: actionName,
      actor_type: "user",
      status: "confirmed",
      object_type: "referral",
      object_id: normalized.referralId || null,
      input_json: {
        ...normalized,
        source: normalized.source || "referral_editor"
      },
      requires_confirmation: false,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    let referralId = normalized.referralId;
    const payload = {
      referred_by_contact_id: normalized.referredByContactId,
      linked_contact_id: normalized.linkedContactId || null,
      referred_name: normalized.referredName,
      referred_company: normalized.referredCompany,
      referred_role: normalized.referredRole,
      referred_email: normalized.referredEmail,
      referred_phone: normalized.referredPhone,
      notes: normalized.notes,
      status: normalized.status || "active",
      updated_at: now
    };

    if (isCreate) {
      const { data: created, error: createError } = await supabase
        .from("referrals")
        .insert({
          user_id: userId,
          ...payload
        })
        .select("id")
        .single();
      if (createError) throw createError;
      referralId = created.id;
    } else {
      const { error: updateError } = await supabase
        .from("referrals")
        .update(payload)
        .eq("id", referralId)
        .eq("user_id", userId);
      if (updateError) throw updateError;
    }

    if (!referralId) throw new Error("No pude determinar el ID del referido.");
    const after = await readReferralSnapshot(userId, referralId);
    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: actionName,
      object_type: "referral",
      object_id: referralId,
      before_json: before,
      after_json: after
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        object_id: referralId,
        output_json: { referral_id: referralId, linked_contact_id: normalized.linkedContactId || null },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;

    return { referralId };
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al guardar referido."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }
}

export async function dismissReferrals(referralIds: string[], source = "contact_profile") {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const uniqueIds = Array.from(new Set(referralIds.filter(Boolean)));
  if (!uniqueIds.length) return { dismissed: 0 };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const { data: existing, error: existingError } = await supabase
    .from("referrals")
    .select("id,status,referred_name,linked_contact_id")
    .eq("user_id", userId)
    .in("id", uniqueIds);
  if (existingError) throw existingError;

  const activeIds = ((existing ?? []) as Array<{ id: string; status: string }>).filter((row) => row.status === "active").map((row) => row.id);
  if (!activeIds.length) return { dismissed: 0 };

  const now = new Date().toISOString();
  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: "referral.dismiss",
      actor_type: "user",
      status: "confirmed",
      object_type: "referral",
      object_id: activeIds.length === 1 ? activeIds[0] : null,
      input_json: { referral_ids: activeIds, source },
      requires_confirmation: true,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    const { error: updateError } = await supabase
      .from("referrals")
      .update({ status: "dismissed", updated_at: now })
      .eq("user_id", userId)
      .in("id", activeIds);
    if (updateError) throw updateError;

    await supabase.from("audit_log").insert(
      activeIds.map((referralId) => ({
        user_id: userId,
        actor: "user",
        action: "referral.dismiss",
        object_type: "referral",
        object_id: referralId,
        before_json: { status: "active" },
        after_json: { status: "dismissed" }
      }))
    );

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        output_json: { dismissed: activeIds.length, referral_ids: activeIds },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;

    return { dismissed: activeIds.length };
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al eliminar referidos."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }
}

function normalizeReferralEditorInput(input: ReferralEditorInput): ReferralEditorInput {
  return {
    referralId: input.referralId || undefined,
    referredByContactId: input.referredByContactId,
    linkedContactId: input.linkedContactId || null,
    referredName: input.referredName.trim(),
    referredCompany: cleanContactCompany(input.referredCompany),
    referredRole: cleanContactRole(input.referredRole),
    referredEmail: normalizeEmail(input.referredEmail),
    referredPhone: input.referredPhone.trim(),
    notes: input.notes.trim(),
    status: input.status || "active",
    source: input.source
  };
}

function hasReferralContent(input: ReferralEditorInput) {
  return Boolean(
    input.referredName ||
      input.referredCompany ||
      input.referredRole ||
      input.referredEmail ||
      input.referredPhone ||
      input.notes
  );
}

async function assertContactBelongsToUser(userId: string, contactId: string, message: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(message);
}

async function readReferralSnapshot(userId: string, referralId: string | undefined): Promise<Record<string, unknown> | null> {
  if (!referralId || !supabase) return null;
  const { data, error } = await supabase
    .from("referrals")
    .select(
      "id,referred_by_contact_id,linked_contact_id,referred_name,referred_company,referred_role,referred_email,referred_phone,notes,status,updated_at"
    )
    .eq("id", referralId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No encontre el referido.");
  return data;
}
