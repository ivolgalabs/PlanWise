import { useEffect, useState } from "react";

// Общий хук media-запроса: на каждый запрос — ОДИН window.matchMedia и один
// change-listener, сколько бы компонентов его ни использовали. Раньше каждый
// TaskCard/TimePicker/вид вешал собственный listener — при сотне задач это
// сотня одинаковых подписок на одни и те же запросы.

interface Entry {
  mql: MediaQueryList;
  onChange: (ev: MediaQueryListEvent) => void;
  refs: number;
  subscribers: Set<(matches: boolean) => void>;
}

const registry = new Map<string, Entry>();

function getEntry(query: string): Entry {
  let e = registry.get(query);
  if (!e) {
    const mql = window.matchMedia(query);
    const entry: Entry = { mql, onChange: () => {}, refs: 0, subscribers: new Set() };
    entry.onChange = (ev: MediaQueryListEvent) => {
      for (const fn of entry.subscribers) fn(ev.matches);
    };
    mql.addEventListener("change", entry.onChange);
    registry.set(query, entry);
    e = entry;
  }
  return e;
}

/** Реактивно: true, если запрос [query] сейчас выполняется. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const entry = getEntry(query);
    entry.refs += 1;
    entry.subscribers.add(setMatches);
    // Мгновенная синхронизация: запрос мог измениться, пока не было подписок.
    setMatches(entry.mql.matches);
    return () => {
      entry.subscribers.delete(setMatches);
      entry.refs -= 1;
      if (entry.refs === 0) {
        entry.mql.removeEventListener("change", entry.onChange);
        registry.delete(query);
      }
    };
  }, [query]);

  return matches;
}
