"use client";

import { AuthGate } from "../../components/AuthGate";
import { Shell } from "../../components/Shell";
import { PlanningView } from "../../components/StructuralViews";

export default function PlanificarPage() {
  return <AuthGate><Shell><PlanningView /></Shell></AuthGate>;
}
