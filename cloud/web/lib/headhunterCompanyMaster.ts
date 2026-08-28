import { cleanContactCompany } from "./format.ts";
import type { ContactRow } from "./readModel.ts";

export type HeadhunterCompanyMasterRow = {
  id: string;
  displayName: string;
  normalizedName: string;
  domains: string[];
};

export type HeadhunterCompanyResolution =
  | {
      status: "matched_company";
      company: HeadhunterCompanyMasterRow;
      domain: string | null;
      suggestedCompany: string;
    }
  | {
      status: "matched_domain";
      company: HeadhunterCompanyMasterRow;
      domain: string;
      suggestedCompany: string;
    }
  | {
      status: "company_mismatch";
      candidates: HeadhunterCompanyMasterRow[];
      domains: string[];
      suggestedCompany: "";
    }
  | {
      status: "ambiguous";
      candidates: HeadhunterCompanyMasterRow[];
      domains: string[];
      suggestedCompany: "";
    }
  | {
      status: "unresolved";
      domains: string[];
      suggestedCompany: "";
    };

export function normalizeHeadhunterCompanyName(value: string | null | undefined) {
  return cleanContactCompany(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHeadhunterDomain(value: string | null | undefined) {
  const clean = (value || "").trim().toLowerCase();
  if (!clean) return "";
  const source = clean.includes("@") ? clean.slice(clean.lastIndexOf("@") + 1) : clean.replace(/^https?:\/\//, "");
  const domain = source
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/^[.@]+/, "")
    .replace(/[,\s;]+$/g, "");
  return domain ? `@${domain}` : "";
}

export function domainsForHeadhunterResolution(contact: Pick<ContactRow, "contact_emails" | "headhunter_domains">) {
  const domains = new Set<string>();
  for (const domain of contact.headhunter_domains ?? []) {
    const normalized = normalizeHeadhunterDomain(domain);
    if (normalized) domains.add(normalized);
  }
  for (const email of contact.contact_emails ?? []) {
    const normalized = normalizeHeadhunterDomain(email.domain || email.email);
    if (normalized) domains.add(normalized);
  }
  return Array.from(domains).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

export function resolveHeadhunterCompany(
  contact: Pick<ContactRow, "company" | "contact_emails" | "headhunter_domains">,
  masterRows: HeadhunterCompanyMasterRow[]
): HeadhunterCompanyResolution {
  const companyName = normalizeHeadhunterCompanyName(contact.company);
  const domains = domainsForHeadhunterResolution(contact);
  const activeMaster = masterRows.filter((row) => row.displayName.trim());

  if (companyName) {
    const matchedByCompany = activeMaster.find((row) => row.normalizedName === companyName);
    if (matchedByCompany) {
      return {
        status: "matched_company",
        company: matchedByCompany,
        domain: domains.find((domain) => matchedByCompany.domains.includes(domain)) ?? null,
        suggestedCompany: matchedByCompany.displayName
      };
    }
    const candidates = uniqueCompanies(
      domains.flatMap((domain) => activeMaster.filter((row) => row.domains.includes(domain)))
    );
    return {
      status: "company_mismatch",
      candidates,
      domains,
      suggestedCompany: ""
    };
  }

  const matchedByDomain = uniqueCompanies(
    domains.flatMap((domain) => activeMaster.filter((row) => row.domains.includes(domain)))
  );

  if (matchedByDomain.length === 1) {
    return {
      status: "matched_domain",
      company: matchedByDomain[0],
      domain: domains.find((domain) => matchedByDomain[0].domains.includes(domain)) ?? "",
      suggestedCompany: matchedByDomain[0].displayName
    };
  }

  if (matchedByDomain.length > 1) {
    return {
      status: "ambiguous",
      candidates: matchedByDomain,
      domains,
      suggestedCompany: ""
    };
  }

  return {
    status: "unresolved",
    domains,
    suggestedCompany: ""
  };
}

function uniqueCompanies(rows: HeadhunterCompanyMasterRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
