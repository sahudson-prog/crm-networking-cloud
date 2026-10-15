import type { Metadata } from "next";
import { LegalDocumentPage } from "../../components/LegalDocumentPage";
import { legalDocuments } from "../../content/legalDocuments";

export const metadata: Metadata = {
  description: legalDocuments.privacy.description,
  title: "Política de Privacidad | Coffeecito"
};

export default function PrivacidadPage() {
  return <LegalDocumentPage document={legalDocuments.privacy} />;
}
