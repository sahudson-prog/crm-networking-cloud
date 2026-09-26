export const PRODUCT_ONBOARDING_SETTING_KEY = "product_onboarding_v1";

export const ONBOARDING_STEPS = [
  "objectives",
  "contacts",
  "contact",
  "google",
  "final"
] as const;

export const ONBOARDING_FLOW = [
  { id: "intro", path: "/onboarding" },
  { id: "objectives", path: "/onboarding/objetivos" },
  { id: "contacts", path: "/onboarding/contactos" },
  { id: "contact", path: "/onboarding/contacto" },
  { id: "google", path: "/onboarding/google" },
  { id: "final", path: "/onboarding/final" }
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingRouteId = (typeof ONBOARDING_FLOW)[number]["id"];
export type OnboardingStatus = "not_started" | "in_progress" | "dismissed" | "completed";

export type ProductOnboardingState = {
  version: 1;
  status: OnboardingStatus;
  introSeen: boolean;
  lastStep?: OnboardingStep;
};

export type OnboardingSessionState = {
  active: boolean;
  replay: boolean;
};

export const INITIAL_ONBOARDING_STATE: ProductOnboardingState = {
  version: 1,
  status: "not_started",
  introSeen: false
};

export const INACTIVE_ONBOARDING_SESSION: OnboardingSessionState = {
  active: false,
  replay: false
};

export function parseProductOnboardingState(value: string): ProductOnboardingState | null {
  if (!value.trim()) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.version !== 1) return null;
    if (!isOnboardingStatus(parsed.status)) return null;
    if (typeof parsed.introSeen !== "boolean") return null;
    if (parsed.lastStep !== undefined && !isOnboardingStep(parsed.lastStep)) return null;

    return {
      version: 1,
      status: parsed.status,
      introSeen: parsed.introSeen,
      ...(parsed.lastStep ? { lastStep: parsed.lastStep } : {})
    };
  } catch {
    return null;
  }
}

export function serializeProductOnboardingState(state: ProductOnboardingState) {
  return JSON.stringify(state);
}

export function resolveStoredOnboardingState(input: {
  exists: boolean;
  value: string | null;
}): ProductOnboardingState {
  if (!input.exists) return INITIAL_ONBOARDING_STATE;
  return parseProductOnboardingState(input.value ?? "") ?? {
    ...INITIAL_ONBOARDING_STATE,
    introSeen: true
  };
}

export function shouldShowAutomaticOnboardingIntro(input: {
  exists: boolean;
  state: ProductOnboardingState;
}) {
  return !input.exists && input.state.status === "not_started" && !input.state.introSeen;
}

export function shouldShowOnboardingStart(state: ProductOnboardingState) {
  return state.status === "not_started";
}

export function isOnboardingTestResetAvailable(environment = process.env.NODE_ENV) {
  return environment === "development";
}

export function markOnboardingIntroSeen(state: ProductOnboardingState): ProductOnboardingState {
  return { ...state, introSeen: true };
}

export function beginOnboarding(_state: ProductOnboardingState): ProductOnboardingState {
  return {
    version: 1,
    status: "in_progress",
    introSeen: true,
    lastStep: "objectives"
  };
}

export function deferOnboarding(): ProductOnboardingState {
  return {
    version: 1,
    status: "not_started",
    introSeen: true
  };
}

export function dismissOnboarding(
  state: ProductOnboardingState,
  lastStep: OnboardingStep | undefined = state.lastStep
): ProductOnboardingState {
  if (state.status === "completed") return state;
  return {
    version: 1,
    status: "dismissed",
    introSeen: true,
    ...(lastStep ? { lastStep } : {})
  };
}

export function moveOnboardingToStep(
  state: ProductOnboardingState,
  lastStep: OnboardingStep
): ProductOnboardingState {
  if (state.status === "completed") return state;
  return {
    version: 1,
    status: "in_progress",
    introSeen: true,
    lastStep
  };
}

export function completeOnboarding(): ProductOnboardingState {
  return {
    version: 1,
    status: "completed",
    introSeen: true,
    lastStep: "final"
  };
}

export function beginOnboardingReplay(state: ProductOnboardingState) {
  return {
    state,
    session: { active: true, replay: true } satisfies OnboardingSessionState,
    route: "/onboarding" as const
  };
}

export function onboardingRouteFor(routeId: OnboardingRouteId) {
  return ONBOARDING_FLOW.find((entry) => entry.id === routeId)?.path ?? "/onboarding";
}

export function onboardingRouteIdFromPathname(pathname: string): OnboardingRouteId | null {
  return ONBOARDING_FLOW.find((entry) => entry.path === pathname)?.id ?? null;
}

export function onboardingStepFromPathname(pathname: string): OnboardingStep | null {
  const routeId = onboardingRouteIdFromPathname(pathname);
  return routeId && routeId !== "intro" ? routeId : null;
}

export function onboardingRouteNavigation(routeId: OnboardingRouteId) {
  const index = ONBOARDING_FLOW.findIndex((entry) => entry.id === routeId);
  return {
    back: index > 0 ? ONBOARDING_FLOW[index - 1].id : null,
    next: index >= 0 && index < ONBOARDING_FLOW.length - 1 ? ONBOARDING_FLOW[index + 1].id : null
  };
}

function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return value === "not_started" || value === "in_progress" || value === "dismissed" || value === "completed";
}

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === "string" && ONBOARDING_STEPS.includes(value as OnboardingStep);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
