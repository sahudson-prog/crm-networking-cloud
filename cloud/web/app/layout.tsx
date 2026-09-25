import type { Metadata } from "next";
import { Lato } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const lato = Lato({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-coffeecito-wordmark",
  weight: "900"
});

export const metadata: Metadata = {
  title: "Coffeecito",
  description: "Gestiona contactos, objetivos e interacciones profesionales en Coffeecito."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={lato.variable}>{children}</body>
    </html>
  );
}
