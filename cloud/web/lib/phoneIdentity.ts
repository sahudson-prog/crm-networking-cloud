export type SupportedPhoneCountry = "CL" | "PE" | "AR" | "CO" | "MX" | "BR" | "US";

type CountryRule = {
  country: SupportedPhoneCountry;
  callingCode: string;
  nationalLengths: number[];
  transformNational?: (national: string) => string[];
};

export const SUPPORTED_PHONE_COUNTRIES: CountryRule[] = [
  {
    country: "CL",
    callingCode: "56",
    nationalLengths: [8, 9],
    transformNational: (national) => {
      const variants = new Set([national]);
      if (national.startsWith("99") && national.length === 10) variants.add(national.slice(1));
      return Array.from(variants);
    }
  },
  { country: "PE", callingCode: "51", nationalLengths: [8, 9] },
  {
    country: "AR",
    callingCode: "54",
    nationalLengths: [10],
    transformNational: (national) => {
      const variants = new Set([national]);
      if (national.startsWith("9") && national.length === 11) variants.add(national.slice(1));
      if (national.startsWith("0")) variants.add(national.slice(1));
      return Array.from(variants);
    }
  },
  { country: "CO", callingCode: "57", nationalLengths: [10] },
  {
    country: "MX",
    callingCode: "52",
    nationalLengths: [10],
    transformNational: (national) => {
      const variants = new Set([national]);
      if (national.startsWith("1") && national.length === 11) variants.add(national.slice(1));
      return Array.from(variants);
    }
  },
  { country: "BR", callingCode: "55", nationalLengths: [10, 11] },
  { country: "US", callingCode: "1", nationalLengths: [10] }
];

export function normalizePhoneDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

export function phoneIdentitiesFor(phone: string) {
  const normalized = normalizePhoneDigits(phone);
  const identities = new Set<string>();
  if (!normalized) return identities;

  addPhoneVariant(identities, normalized);

  for (const rule of SUPPORTED_PHONE_COUNTRIES) {
    if (!normalized.startsWith(rule.callingCode)) continue;
    const national = normalized.slice(rule.callingCode.length);
    const variants = countryNationalVariants(rule, national);
    for (const variant of variants) {
      if (isLikelyNationalNumber(variant, rule)) addPhoneVariant(identities, variant, rule.country);
    }
  }

  for (const rule of SUPPORTED_PHONE_COUNTRIES) {
    for (const variant of countryNationalVariants(rule, normalized)) {
      if (isLikelyNationalNumber(variant, rule)) addPhoneVariant(identities, variant, rule.country);
    }
  }

  return identities;
}

export function phoneIdentitySet(phones: string[]) {
  const identities = new Set<string>();
  for (const phone of phones) {
    phoneIdentitiesFor(phone).forEach((identity) => identities.add(identity));
  }
  return identities;
}

export function phoneMatchesSet(identities: Set<string>, phone: string) {
  for (const identity of phoneIdentitiesFor(phone)) {
    if (identities.has(identity)) return true;
  }
  return false;
}

function countryNationalVariants(rule: CountryRule, national: string) {
  const variants = new Set<string>([national]);
  rule.transformNational?.(national).forEach((variant) => variants.add(variant));
  return Array.from(variants).filter(Boolean);
}

function isLikelyNationalNumber(value: string, rule: CountryRule) {
  return rule.nationalLengths.includes(value.length);
}

function addPhoneVariant(identities: Set<string>, digits: string, country?: SupportedPhoneCountry) {
  if (!digits) return;
  identities.add(`digits:${digits}`);
  if (country) identities.add(`${country}:${digits}`);
  const last8 = digits.slice(-8);
  if (last8.length === 8) identities.add(`last8:${last8}`);
}
