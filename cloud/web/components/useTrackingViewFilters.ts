"use client";

import { useCallback, useMemo, useSyncExternalStore, type SetStateAction } from "react";
import { defaultTrackingFilters, type TrackingFilters } from "../lib/trackingModel";

// Presentation context only. No storage, account reads or synchronization effects.
// Carry the former dashboard's cross-block filters through the temporary navigation.
export const TRACKING_QUERY_KEY = "ux-tracking";
const eventName = "coffeecito:tracking-view-filters";
type ViewFilters = { filters: TrackingFilters; quickQuery: string; domains: string[] };
const empty = (): ViewFilters => ({ filters: { ...defaultTrackingFilters, priorityIds: [] }, quickQuery: "", domains: [] });
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function read(value: string): ViewFilters {
  try {
    const data = JSON.parse(value);
    return {
      filters: {
        priorityIds: strings(data?.filters?.priorityIds),
        headhunters: data?.filters?.headhunters === "only" ? "only" : data?.filters?.headhunters === "exclude" ? "exclude" : "all",
        groupHeadhunters: data?.filters?.groupHeadhunters === true
      },
      quickQuery: typeof data?.quickQuery === "string" ? data.quickQuery : "",
      domains: strings(data?.domains)
    };
  } catch { return empty(); }
}
function snapshot() { return new URLSearchParams(window.location.search).get(TRACKING_QUERY_KEY) ?? ""; }
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(eventName, listener); };
}
function update(change: (current: ViewFilters) => ViewFilters) {
  const previous = read(snapshot());
  const next = change(previous);
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  const url = new URL(window.location.href);
  url.searchParams.set(TRACKING_QUERY_KEY, JSON.stringify(next));
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(eventName));
}
function resolve<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function" ? (value as (previous: T) => T)(current) : value;
}
export function useTrackingViewFilters() {
  const query = useSyncExternalStore(subscribe, snapshot, () => "");
  const value = useMemo(() => read(query), [query]);
  const selectedDomains = useMemo(() => new Set(value.domains), [value.domains]);
  const setFilters = useCallback((next: SetStateAction<TrackingFilters>) => update(current => ({ ...current, filters: resolve(next, current.filters) })), []);
  const setQuickQuery = useCallback((next: string) => update(current => ({ ...current, quickQuery: next })), []);
  const setSelectedDomains = useCallback((next: SetStateAction<Set<string>>) => update(current => ({ ...current, domains: [...resolve(next, new Set(current.domains))] })), []);
  return { ...value, selectedDomains, setFilters, setQuickQuery, setSelectedDomains, query };
}
