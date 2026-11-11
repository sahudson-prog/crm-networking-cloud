"use client";

import { AuthGate } from "../../components/AuthGate";
import { Shell } from "../../components/Shell";
import { RegisterProgressView } from "../../components/StructuralViews";

export default function RegistrarAvancesPage() {
  return <AuthGate><Shell><RegisterProgressView /></Shell></AuthGate>;
}
