"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  INITIAL_ONBOARDING_STATE,
  INACTIVE_ONBOARDING_SESSION,
  ONBOARDING_PRODUCT_DESTINATION,
  beginOnboarding,
  beginOnboardingReplay,
  canMoveOnboardingToStep,
  completeOnboarding,
  isOnboardingReplayAllowed,
  isOnboardingRouteAdmitted,
  isOnboardingTestResetAvailable,
  isProductOnboardingComplete,
  moveOnboardingToStep,
  normalizeOnboardingSession,
  onboardingRouteFor,
  onboardingRouteIdFromPathname,
  onboardingStepFromPathname,
  requiredOnboardingRoute,
  type OnboardingSessionState,
  type OnboardingStep,
  type ProductOnboardingState
} from "../lib/onboarding";
import {
  deleteProductOnboardingState,
  loadProductOnboardingState,
  saveProductOnboardingState
} from "../lib/onboardingStore";

const ONBOARDING_SESSION_KEY = "coffeecito_onboarding_session_v1";

type OnboardingContextValue = {
  active: boolean;
  complete: () => Promise<void>;
  completing: boolean;
  error: string;
  exit: (step?: OnboardingStep) => Promise<void>;
  loadFailed: boolean;
  loading: boolean;
  moveTo: (step: OnboardingStep) => Promise<void>;
  openIntro: () => void;
  replay: () => void;
  replaying: boolean;
  resetForDevelopment: () => Promise<void>;
  retry: () => void;
  routeReady: boolean;
  start: () => Promise<void>;
  state: ProductOnboardingState;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<ProductOnboardingState>(INITIAL_ONBOARDING_STATE);
  const [session, setSession] = useState<OnboardingSessionState>(INACTIVE_ONBOARDING_SESSION);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [loadRequest, setLoadRequest] = useState(0);
  const completionPending = useRef(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    let active = true;
    const storedSession = readOnboardingSession();
    setLoading(true);
    setLoadFailed(false);
    setError("");

    async function load() {
      try {
        const stored = await loadProductOnboardingState();
        if (!active) return;
        const nextSession = normalizeOnboardingSession(stored.state, storedSession);
        if (nextSession !== storedSession) clearOnboardingSession();
        setState(stored.state);
        setSession(nextSession);
      } catch {
        if (!active) return;
        setLoadFailed(true);
        setError("No pudimos comprobar el avance de la guía. Intenta nuevamente.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [loadRequest]);

  useEffect(() => {
    if (loading || loadFailed) return;
    const routeId = onboardingRouteIdFromPathname(pathname);
    const routeStep = onboardingStepFromPathname(pathname);
    const replayAllowed = isOnboardingReplayAllowed(state, session);

    if (!routeId) {
      if (!isProductOnboardingComplete(state)) {
        router.replace(onboardingRouteFor(requiredOnboardingRoute(state)));
      }
      return;
    }

    if (routeId === "intro") {
      if (isProductOnboardingComplete(state) && !replayAllowed) {
        router.replace(ONBOARDING_PRODUCT_DESTINATION);
        return;
      }
      if (state.status === "in_progress" && !replayAllowed) {
        router.replace(onboardingRouteFor(requiredOnboardingRoute(state)));
        return;
      }
      return;
    }

    if (replayAllowed) return;

    if (state.status !== "in_progress" || !routeStep) {
      router.replace(isProductOnboardingComplete(state)
        ? ONBOARDING_PRODUCT_DESTINATION
        : onboardingRouteFor(requiredOnboardingRoute(state)));
      return;
    }

    if (requiredOnboardingRoute(state) !== routeStep) {
      router.replace(onboardingRouteFor(requiredOnboardingRoute(state)));
      return;
    }

    if (!session.active || session.replay) {
      const nextSession = { active: true, replay: false };
      writeOnboardingSession(nextSession);
      setSession(nextSession);
    }
  }, [loadFailed, loading, pathname, router, session, state]);

  const routeId = onboardingRouteIdFromPathname(pathname);
  const routeReady = !loading && !loadFailed && isOnboardingRouteAdmitted(state, session, routeId);

  async function persist(nextState: ProductOnboardingState) {
    setError("");
    try {
      await saveProductOnboardingState(nextState);
      setState(nextState);
      return true;
    } catch {
      setError("No pudimos guardar el avance de la guía. Intenta nuevamente.");
      return false;
    }
  }

  function openIntro() {
    if (isOnboardingReplayAllowed(state, session)) router.push(onboardingRouteFor("intro"));
  }

  async function start() {
    if (isOnboardingReplayAllowed(state, session)) {
      router.push(onboardingRouteFor("objectives"));
      return;
    }

    const nextState = beginOnboarding(state);
    if (!(await persist(nextState))) return;
    const nextSession = { active: true, replay: false };
    writeOnboardingSession(nextSession);
    setSession(nextSession);
    router.push(onboardingRouteFor(nextState.lastStep ?? "objectives"));
  }

  async function exit(_step?: OnboardingStep) {
    if (!isOnboardingReplayAllowed(state, session)) return;
    clearOnboardingSession();
    setSession(INACTIVE_ONBOARDING_SESSION);
    router.push(ONBOARDING_PRODUCT_DESTINATION);
  }

  async function moveTo(step: OnboardingStep) {
    if (!isOnboardingReplayAllowed(state, session)) {
      const currentStep = state.status === "in_progress" ? state.lastStep ?? "objectives" : null;
      if (!currentStep || !canMoveOnboardingToStep(currentStep, step)) {
        setError("No pudimos avanzar la guía desde este paso.");
        return;
      }
      const nextState = moveOnboardingToStep(state, step);
      if (!(await persist(nextState))) return;
    }
    const nextSession = { active: true, replay: session.replay };
    writeOnboardingSession(nextSession);
    setSession(nextSession);
    router.push(onboardingRouteFor(step));
  }

  async function complete() {
    if (completionPending.current) return;
    completionPending.current = true;
    setCompleting(true);

    const replayAllowed = isOnboardingReplayAllowed(state, session);
    if (!replayAllowed) {
      if (state.status !== "in_progress" || state.lastStep !== "final") {
        setError("Completa los pasos anteriores antes de finalizar la guía.");
        completionPending.current = false;
        setCompleting(false);
        return;
      }
      if (!(await persist(completeOnboarding()))) {
        completionPending.current = false;
        setCompleting(false);
        return;
      }
    }
    clearOnboardingSession();
    setSession(INACTIVE_ONBOARDING_SESSION);
    if (replayAllowed) router.push(ONBOARDING_PRODUCT_DESTINATION);
  }

  function replay() {
    if (!isProductOnboardingComplete(state)) return;
    const transition = beginOnboardingReplay(state);
    writeOnboardingSession(transition.session);
    setSession(transition.session);
    router.push(transition.route);
  }

  async function resetForDevelopment() {
    if (!isOnboardingTestResetAvailable()) return;
    setError("");
    try {
      await deleteProductOnboardingState();
      clearOnboardingSession();
      setSession(INACTIVE_ONBOARDING_SESSION);
      setState(INITIAL_ONBOARDING_STATE);
      router.push("/");
    } catch {
      setError("No pudimos reiniciar el onboarding de prueba.");
    }
  }

  function retry() {
    clearOnboardingSession();
    setSession(INACTIVE_ONBOARDING_SESSION);
    setLoadRequest((current) => current + 1);
  }

  return (
    <OnboardingContext.Provider
      value={{
        active: session.active,
        complete,
        completing,
        error,
        exit,
        loadFailed,
        loading,
        moveTo,
        openIntro,
        replay,
        replaying: isOnboardingReplayAllowed(state, session),
        resetForDevelopment,
        retry,
        routeReady,
        start,
        state
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error("useOnboarding debe usarse dentro de OnboardingProvider.");
  return context;
}

function readOnboardingSession(): OnboardingSessionState {
  if (typeof window === "undefined") return INACTIVE_ONBOARDING_SESSION;
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_SESSION_KEY);
    if (!raw) return INACTIVE_ONBOARDING_SESSION;
    const parsed = JSON.parse(raw) as Partial<OnboardingSessionState>;
    if (parsed.active !== true) return INACTIVE_ONBOARDING_SESSION;
    return { active: true, replay: parsed.replay === true };
  } catch {
    return INACTIVE_ONBOARDING_SESSION;
  }
}

function writeOnboardingSession(state: OnboardingSessionState) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ONBOARDING_SESSION_KEY, JSON.stringify(state));
}

function clearOnboardingSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ONBOARDING_SESSION_KEY);
}
