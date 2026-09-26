"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  INITIAL_ONBOARDING_STATE,
  INACTIVE_ONBOARDING_SESSION,
  beginOnboarding,
  beginOnboardingReplay,
  completeOnboarding,
  deferOnboarding,
  dismissOnboarding,
  isOnboardingTestResetAvailable,
  markOnboardingIntroSeen,
  moveOnboardingToStep,
  onboardingRouteFor,
  onboardingRouteIdFromPathname,
  onboardingStepFromPathname,
  shouldShowAutomaticOnboardingIntro,
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
  defer: () => Promise<void>;
  error: string;
  exit: (step?: OnboardingStep) => Promise<void>;
  loading: boolean;
  moveTo: (step: OnboardingStep) => Promise<void>;
  openIntro: () => void;
  replay: () => void;
  replaying: boolean;
  resetForDevelopment: () => Promise<void>;
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
  const [routeReady, setRouteReady] = useState(false);
  const [error, setError] = useState("");
  const routeSyncRequest = useRef(0);
  const routeSyncStep = useRef<OnboardingStep | null>(null);

  useEffect(() => {
    let active = true;
    const storedSession = readOnboardingSession();
    setSession(storedSession);

    async function load() {
      try {
        const stored = await loadProductOnboardingState();
        if (!active) return;
        let loadedState = stored.state;

        if (shouldShowAutomaticOnboardingIntro(stored)) {
          const seenState = markOnboardingIntroSeen(stored.state);
          try {
            await saveProductOnboardingState(seenState);
            if (!active) return;
            loadedState = seenState;
            if (onboardingRouteIdFromPathname(pathname) !== "intro") {
              router.replace(onboardingRouteFor("intro"));
            }
          } catch {
            if (!active) return;
            setError("No pudimos guardar el avance de la guía. Puedes seguir usando Coffeecito normalmente.");
          }
        }

        setState(loadedState);
      } catch {
        if (!active) return;
        setError("No pudimos cargar la guía. Puedes seguir usando Coffeecito normalmente.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const routeId = onboardingRouteIdFromPathname(pathname);
    const routeStep = onboardingStepFromPathname(pathname);

    if (!routeId) {
      setRouteReady(true);
      if (state.status === "in_progress") {
        if (!session.active || session.replay) {
          const nextSession = { active: true, replay: false };
          writeOnboardingSession(nextSession);
          setSession(nextSession);
        }
        setRouteReady(false);
        router.replace(onboardingRouteFor(state.lastStep ?? "objectives"));
      } else if (session.active && !session.replay) {
        clearOnboardingSession();
        setSession(INACTIVE_ONBOARDING_SESSION);
      }
      return;
    }

    if (routeId === "intro") {
      if ((state.status === "dismissed" || state.status === "completed") && !session.replay) {
        setRouteReady(false);
        router.replace("/");
        return;
      }
      if (state.status === "in_progress" && !session.active && !session.replay) {
        if (!session.active) {
          const nextSession = { active: true, replay: false };
          writeOnboardingSession(nextSession);
          setSession(nextSession);
        }
        setRouteReady(false);
        router.replace(onboardingRouteFor(state.lastStep ?? "objectives"));
        return;
      }
      setRouteReady(true);
      return;
    }

    if (session.active && session.replay) {
      setRouteReady(true);
      return;
    }

    if (state.status !== "in_progress" || !routeStep) {
      setRouteReady(false);
      router.replace(onboardingRouteFor("intro"));
      return;
    }

    if (!session.active) {
      const nextSession = { active: true, replay: false };
      writeOnboardingSession(nextSession);
      setSession(nextSession);
    }

    if (state.lastStep === routeStep) {
      if (routeSyncStep.current === routeStep) return;
      setRouteReady(true);
      return;
    }

    const requestId = routeSyncRequest.current + 1;
    routeSyncRequest.current = requestId;
    const nextState = moveOnboardingToStep(state, routeStep);
    routeSyncStep.current = routeStep;
    setState(nextState);
    setRouteReady(false);
    saveProductOnboardingState(nextState)
      .then(() => {
        if (requestId !== routeSyncRequest.current) return;
        routeSyncStep.current = null;
        setRouteReady(true);
      })
      .catch(() => {
        if (requestId !== routeSyncRequest.current) return;
        routeSyncStep.current = null;
        setError("No pudimos guardar el avance de la guía. Intenta nuevamente.");
        router.replace(onboardingRouteFor("intro"));
      });
  }, [loading, pathname, router, session.active, session.replay, state]);

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
    router.push(onboardingRouteFor("intro"));
  }

  async function start() {
    if (session.replay) {
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

  async function defer() {
    const nextState = deferOnboarding();
    if (!(await persist(nextState))) return;
    clearOnboardingSession();
    setSession(INACTIVE_ONBOARDING_SESSION);
    router.push("/");
  }

  async function exit(step?: OnboardingStep) {
    if (!session.replay) {
      const nextState = dismissOnboarding(state, step);
      if (!(await persist(nextState))) return;
    }
    clearOnboardingSession();
    setSession(INACTIVE_ONBOARDING_SESSION);
    router.push("/");
  }

  async function moveTo(step: OnboardingStep) {
    if (!session.replay) {
      const nextState = moveOnboardingToStep(state, step);
      if (!(await persist(nextState))) return;
    }
    const nextSession = { active: true, replay: session.replay };
    writeOnboardingSession(nextSession);
    setSession(nextSession);
    router.push(onboardingRouteFor(step));
  }

  async function complete() {
    if (!session.replay && !(await persist(completeOnboarding()))) return;
    clearOnboardingSession();
    setSession(INACTIVE_ONBOARDING_SESSION);
    router.push("/objetivos");
  }

  function replay() {
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

  return (
    <OnboardingContext.Provider
      value={{
        active: session.active,
        complete,
        defer,
        error,
        exit,
        loading,
        moveTo,
        openIntro,
        replay,
        replaying: session.replay,
        resetForDevelopment,
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
