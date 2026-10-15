import type { Metadata } from "next";
import { PublicContactPage } from "../../components/PublicContactPage";

export const metadata: Metadata = {
  description: "Contacta a Coffeecito para consultas, soporte o solicitudes sobre tus datos personales.",
  title: "Contacto | Coffeecito"
};

export default function ContactoPage() {
  return <PublicContactPage />;
}
