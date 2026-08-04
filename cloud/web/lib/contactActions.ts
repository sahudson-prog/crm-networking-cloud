import { supabase } from "./supabaseClient";
import { cleanContactCompany, cleanContactRole } from "./format";
import type { ContactRow } from "./readModel";

const OFFICIAL_NETWORKING_STATUSES = new Set([
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
]);

export type ContactEditorInput = {
  contactId?: string;
  displayName: string;
  company: string;
  role: string;
  networkingStatus: string;
  networkingFocus: boolean;
  isHeadhunter: boolean;
  headhunterDomains: string[];
  emails: string[];
  phones: string[];
  source?: string;
};

export type ContactFlagsInput = {
  networkingFocus?: boolean;
  isHeadhunter?: boolean;
  source?: string;
};

export async function updateContactNetworkingStatus(contactId: string, nextStatus: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  if (!OFFICIAL_NETWORKING_STATUSES.has(nextStatus)) throw new Error("Estado networking no valido.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id,networking_status")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact) throw new Error("No encontre el contacto.");
  if (contact.networking_status === nextStatus) return { status: nextStatus };

  const now = new Date().toISOString();
  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: "contact.update_networking_status",
      actor_type: "user",
      status: "confirmed",
      object_type: "contact",
      object_id: contactId,
      input_json: {
        current_status: contact.networking_status,
        suggested_status: nextStatus,
        source: "contact_profile"
      },
      requires_confirmation: false,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    const { error: updateError } = await supabase
      .from("contacts")
      .update({ networking_status: nextStatus })
      .eq("id", contactId)
      .eq("user_id", userId);
    if (updateError) throw updateError;

    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: "contact.update_networking_status",
      object_type: "contact",
      object_id: contactId,
      before_json: { networking_status: contact.networking_status },
      after_json: { networking_status: nextStatus }
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        output_json: { contact_id: contactId, networking_status: nextStatus },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al actualizar estado networking."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }

  return { status: nextStatus };
}

export async function updateContactFlags(contactId: string, flags: ContactFlagsInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const patch: Record<string, boolean> = {};
  if (typeof flags.networkingFocus === "boolean") patch.networking_focus = flags.networkingFocus;
  if (typeof flags.isHeadhunter === "boolean") patch.is_headhunter = flags.isHeadhunter;
  if (!Object.keys(patch).length) return { updated: false };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id,networking_focus,is_headhunter")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact) throw new Error("No encontre el contacto.");

  const before = {
    networking_focus: contact.networking_focus,
    is_headhunter: contact.is_headhunter
  };
  const effectivePatch: Record<string, boolean> = {};
  if ("networking_focus" in patch && before.networking_focus !== patch.networking_focus) {
    effectivePatch.networking_focus = patch.networking_focus;
  }
  if ("is_headhunter" in patch && before.is_headhunter !== patch.is_headhunter) {
    effectivePatch.is_headhunter = patch.is_headhunter;
  }
  if (!Object.keys(effectivePatch).length) return { updated: false };

  const now = new Date().toISOString();
  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: "contact.update_flags",
      actor_type: "user",
      status: "confirmed",
      object_type: "contact",
      object_id: contactId,
      input_json: {
        before,
        patch: effectivePatch,
        source: flags.source || "contact_profile"
      },
      requires_confirmation: false,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    const { error: updateError } = await supabase
      .from("contacts")
      .update(effectivePatch)
      .eq("id", contactId)
      .eq("user_id", userId);
    if (updateError) throw updateError;

    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: "contact.update_flags",
      object_type: "contact",
      object_id: contactId,
      before_json: before,
      after_json: { ...before, ...effectivePatch }
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        output_json: { contact_id: contactId, ...effectivePatch },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al actualizar marcas del contacto."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }

  return { updated: true };
}

export async function saveContactFromEditor(input: ContactEditorInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const normalized = normalizeContactEditorInput(input);
  if (!normalized.displayName) throw new Error("El nombre del contacto es obligatorio.");
  if (!OFFICIAL_NETWORKING_STATUSES.has(normalized.networkingStatus)) throw new Error("Estado networking no valido.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const isCreate = !normalized.contactId;
  const now = new Date().toISOString();
  const actionName = isCreate ? "contact.create" : "contact.update";
  const before = isCreate ? null : await readContactSnapshot(userId, normalized.contactId);

  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: actionName,
      actor_type: "user",
      status: "confirmed",
      object_type: "contact",
      object_id: normalized.contactId || null,
      input_json: {
        ...normalized,
        source: normalized.source || "contact_editor"
      },
      requires_confirmation: false,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    let contactId = normalized.contactId;
    const contactPayload = {
      display_name: normalized.displayName,
      company: normalized.company,
      role: normalized.role,
      networking_status: normalized.networkingStatus,
      networking_focus: normalized.networkingFocus,
      is_headhunter: normalized.isHeadhunter,
      headhunter_domains: normalized.headhunterDomains
    };

    if (isCreate) {
      const { data: created, error: createError } = await supabase
        .from("contacts")
        .insert({
          user_id: userId,
          ...contactPayload
        })
        .select("id")
        .single();
      if (createError) throw createError;
      contactId = created.id;
    } else {
      const { error: updateError } = await supabase
        .from("contacts")
        .update(contactPayload)
        .eq("id", contactId)
        .eq("user_id", userId);
      if (updateError) throw updateError;
    }

    if (!contactId) throw new Error("No pude determinar el ID del contacto.");
    await replaceContactEmails(userId, contactId, normalized.emails);
    await replaceContactPhones(userId, contactId, normalized.phones);

    const after = await readContactSnapshot(userId, contactId);
    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: actionName,
      object_type: "contact",
      object_id: contactId,
      before_json: before,
      after_json: after
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        object_id: contactId,
        output_json: { contact_id: contactId },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;

    return { contactId };
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al guardar contacto."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }
}

function normalizeContactEditorInput(input: ContactEditorInput) {
  return {
    contactId: input.contactId || undefined,
    displayName: input.displayName.trim(),
    company: cleanContactCompany(input.company),
    role: cleanContactRole(input.role),
    networkingStatus: input.networkingStatus,
    networkingFocus: input.networkingFocus,
    isHeadhunter: input.isHeadhunter,
    headhunterDomains: uniqueClean(input.headhunterDomains.map(normalizeDomain).filter(Boolean)),
    emails: uniqueClean(input.emails.map(normalizeEmail).filter(Boolean)),
    phones: uniqueClean(input.phones.map((phone) => phone.trim()).filter(Boolean)),
    source: input.source
  };
}

async function readContactSnapshot(userId: string, contactId: string | undefined): Promise<Record<string, unknown> | null> {
  if (!contactId || !supabase) return null;
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id,display_name,company,role,networking_status,networking_focus,is_headhunter,headhunter_domains,is_active,updated_at")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact) throw new Error("No encontre el contacto.");

  const [{ data: emails, error: emailsError }, { data: phones, error: phonesError }] = await Promise.all([
    supabase
      .from("contact_emails")
      .select("email,normalized_email,domain,is_primary")
      .eq("contact_id", contactId)
      .eq("user_id", userId)
      .order("is_primary", { ascending: false }),
    supabase
      .from("contact_phones")
      .select("phone,normalized_phone,normalized_phone_last8,is_primary")
      .eq("contact_id", contactId)
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
  ]);
  if (emailsError) throw emailsError;
  if (phonesError) throw phonesError;

  return { contact, emails: emails ?? [], phones: phones ?? [] };
}

async function replaceContactEmails(userId: string, contactId: string, emails: string[]) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { error: deleteError } = await supabase
    .from("contact_emails")
    .delete()
    .eq("user_id", userId)
    .eq("contact_id", contactId);
  if (deleteError) throw deleteError;
  if (!emails.length) return;

  const { error: insertError } = await supabase.from("contact_emails").insert(
    emails.map((email, index) => ({
      user_id: userId,
      contact_id: contactId,
      email,
      normalized_email: normalizeEmail(email),
      domain: domainFromEmail(email),
      is_primary: index === 0,
      source: "app"
    }))
  );
  if (insertError) throw insertError;
}

async function replaceContactPhones(userId: string, contactId: string, phones: string[]) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { error: deleteError } = await supabase
    .from("contact_phones")
    .delete()
    .eq("user_id", userId)
    .eq("contact_id", contactId);
  if (deleteError) throw deleteError;
  if (!phones.length) return;

  const { error: insertError } = await supabase.from("contact_phones").insert(
    phones.map((phone, index) => {
      const normalized = normalizePhone(phone);
      return {
        user_id: userId,
        contact_id: contactId,
        phone,
        normalized_phone: normalized,
        normalized_phone_last8: normalized.slice(-8) || null,
        is_primary: index === 0,
        source: "app"
      };
    })
  );
  if (insertError) throw insertError;
}

function uniqueClean(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

export function isValidPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return true;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 7;
}

function domainFromEmail(email: string) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normalized.slice(at);
  return domain.length > 1 ? domain : null;
}

function normalizeDomain(domain: string) {
  const clean = domain.trim().toLowerCase();
  if (!clean) return "";
  return clean.startsWith("@") ? clean : `@${clean}`;
}

export function contactToEditorInput(contact: ContactRow): ContactEditorInput {
  return {
    contactId: contact.id,
    displayName: contact.display_name || "",
    company: cleanContactCompany(contact.company),
    role: cleanContactRole(contact.role),
    networkingStatus: contact.networking_status || "Pendiente",
    networkingFocus: Boolean(contact.networking_focus),
    isHeadhunter: Boolean(contact.is_headhunter),
    headhunterDomains: contact.headhunter_domains ?? [],
    emails: (contact.contact_emails ?? []).map((item) => item.email),
    phones: (contact.contact_phones ?? []).map((item) => item.phone),
    source: "contact_profile"
  };
}
