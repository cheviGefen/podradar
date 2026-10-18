import { useCallback, useEffect, useState } from "react";

/**
 * Calls `load` now and then again `intervalMs` after each answer. `data` keeps the last good answer,
 * and `error` says why the latest call failed (null once a call succeeds again). `refresh` calls
 * right away, so the result of an action shows without waiting.
 *
 * `load` must keep the same identity between renders (a module-level function), or polling restarts.
 */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const result = await load();
        if (!active) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
      timer = window.setTimeout(poll, intervalMs);
    };
    poll();

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load, intervalMs, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return { data, error, refresh };
}
