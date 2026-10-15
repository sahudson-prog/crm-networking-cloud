export const LEGAL_DOCUMENT_VERSION = "1.1";
export const LEGAL_DOCUMENT_EFFECTIVE_DATE = "15 de octubre de 2026";
export const LEGAL_ACCEPTANCE_METHOD = "explicit_web";
export const LEGAL_TERMS_SHA256 = "73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43";
export const LEGAL_PRIVACY_SHA256 = "653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f";

export const LEGAL_CONTRACT_V1 = {
  acceptanceMethod: LEGAL_ACCEPTANCE_METHOD,
  privacySha256: "f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30",
  privacyVersion: "1.0",
  termsSha256: "80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12",
  termsVersion: "1.0"
} as const;

export const CURRENT_LEGAL_CONTRACT = {
  acceptanceMethod: LEGAL_ACCEPTANCE_METHOD,
  privacySha256: LEGAL_PRIVACY_SHA256,
  privacyVersion: LEGAL_DOCUMENT_VERSION,
  termsSha256: LEGAL_TERMS_SHA256,
  termsVersion: LEGAL_DOCUMENT_VERSION
} as const;
