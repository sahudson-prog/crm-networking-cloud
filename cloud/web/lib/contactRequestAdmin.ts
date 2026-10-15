import { supabase } from "./supabaseClient";
import type {
  ContactRequestIdentityStatus,
  ContactRequestRow,
  ContactRequestStatus
} from "./contactRequests";

export async function readContactRequests(limit = 100) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.rpc("admin_list_contact_requests_v1", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ContactRequestRow[];
}

export async function updateContactRequest(input: {
  id: string;
  identityVerificationStatus: ContactRequestIdentityStatus;
  status: ContactRequestStatus;
}) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.rpc("admin_update_contact_request_v1", {
    p_identity_verification_status: input.identityVerificationStatus,
    p_request_id: input.id,
    p_status: input.status
  });
  if (error) throw error;
  const row = (data as ContactRequestRow[] | null)?.[0];
  if (!row) throw new Error("La solicitud ya no está disponible.");
  return row;
}
