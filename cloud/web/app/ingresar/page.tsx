"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// AuthGate mounts this page only after the existing access and legal gates pass.
export default function SignInPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return <p role="status">Cargando…</p>;
}
