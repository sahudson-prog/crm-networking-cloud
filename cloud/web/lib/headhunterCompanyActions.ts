import { normalizeHeadhunterCompanyName, normalizeHeadhunterDomain, type HeadhunterCompanyMasterRow } from "./headhunterCompanyMaster.ts";
import { requireCurrentUserCapability } from "./accessControl.ts";
import { supabase } from "./supabaseClient.ts";

type HeadhunterCompanyDbRow = {
  id: string;
  display_name: string;
  normalized_name: string;
  headhunter_company_domains?: Array<{
    domain: string;
    normalized_domain: string;
    is_active: boolean;
  }>;
};

export async function readHeadhunterCompanyMaster(): Promise<HeadhunterCompanyMasterRow[]> {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const { data, error } = await supabase
    .from("headhunter_companies")
    .select("id,display_name,normalized_name,headhunter_company_domains(domain,normalized_domain,is_active)")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as HeadhunterCompanyDbRow[]).map((row) => ({
    domains: (row.headhunter_company_domains ?? [])
      .filter((domain) => domain.is_active)
      .map((domain) => normalizeHeadhunterDomain(domain.normalized_domain || domain.domain))
      .filter(Boolean),
    displayName: row.display_name,
    id: row.id,
    normalizedName: row.normalized_name
  }));
}

export async function createHeadhunterCompany(input: { displayName: string; domains: string[] }) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_global_masters", "administrar empresas headhunter");

  const displayName = input.displayName.trim();
  const normalizedName = normalizeHeadhunterCompanyName(displayName);
  const domains = unique(input.domains.map(normalizeHeadhunterDomain).filter(Boolean));

  if (!displayName || !normalizedName) throw new Error("La empresa necesita un nombre.");

  const { data: company, error: companyError } = await supabase
    .from("headhunter_companies")
    .insert({
      display_name: displayName,
      normalized_name: normalizedName
    })
    .select("id")
    .single();

  if (companyError) throw companyError;

  if (domains.length) {
    const { error: domainError } = await supabase.from("headhunter_company_domains").insert(
      domains.map((domain, index) => ({
        company_id: company.id,
        domain,
        is_primary: index === 0,
        normalized_domain: domain
      }))
    );
    if (domainError) throw domainError;
  }

  return { companyId: company.id };
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
