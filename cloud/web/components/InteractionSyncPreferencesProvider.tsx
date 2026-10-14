"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_INTERACTION_SYNC_PREFERENCES,
  withInteractionSyncService,
  type InteractionSyncPreferences,
  type InteractionSyncService
} from "../lib/interactionSyncPreferences";
import {
  loadInteractionSyncPreferences,
  saveInteractionSyncPreferences
} from "../lib/interactionSyncPreferencesStore";

type InteractionSyncPreferencesContextValue = {
  error: string;
  loading: boolean;
  preferences: InteractionSyncPreferences;
  saving: boolean;
  setServiceEnabled: (service: InteractionSyncService, enabled: boolean) => Promise<void>;
};

const InteractionSyncPreferencesContext = createContext<InteractionSyncPreferencesContextValue | null>(null);

export function InteractionSyncPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<InteractionSyncPreferences>(DEFAULT_INTERACTION_SYNC_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    let active = true;
    loadInteractionSyncPreferences()
      .then((loaded) => {
        if (!active) return;
        preferencesRef.current = loaded;
        setPreferences(loaded);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "No pude leer las preferencias de sincronización.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setServiceEnabled = useCallback(async (service: InteractionSyncService, enabled: boolean) => {
    const previous = preferencesRef.current;
    const next = withInteractionSyncService(previous, service, enabled);
    preferencesRef.current = next;
    setPreferences(next);
    setSaving(true);
    setError("");
    try {
      const saved = await saveInteractionSyncPreferences(next);
      preferencesRef.current = saved;
      setPreferences(saved);
    } catch (saveError) {
      preferencesRef.current = previous;
      setPreferences(previous);
      setError(saveError instanceof Error ? saveError.message : "No pude guardar las preferencias de sincronización.");
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <InteractionSyncPreferencesContext.Provider value={{ error, loading, preferences, saving, setServiceEnabled }}>
      {children}
    </InteractionSyncPreferencesContext.Provider>
  );
}

export function useInteractionSyncPreferences() {
  const value = useContext(InteractionSyncPreferencesContext);
  if (!value) throw new Error("useInteractionSyncPreferences debe usarse dentro de InteractionSyncPreferencesProvider.");
  return value;
}
