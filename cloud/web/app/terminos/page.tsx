import type { Metadata } from "next";
import { LegalDocumentPage } from "../../components/LegalDocumentPage";
import { legalDocuments } from "../../content/legalDocuments";

export const metadata: Metadata = {
  description: legalDocuments.terms.description,
  title: "Términos de Servicio | Coffeecito"
};

export default function TerminosPage() {
  return <LegalDocumentPage document={legalDocuments.terms} />;
}
