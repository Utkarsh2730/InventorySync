// useInventory: the React side of store.js. Loads the saved data, listens for
// changes from other tabs (R4), and runs every write the same way app.js does:
// re-read the latest saved state, apply one rule from inventory.js, save once.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as store from '../../js/store.js';
import sampleUrl from '../../data/sample-data.json?url';

store.configure({ sampleUrl });

export function useInventory() {
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const stateRef = useRef(null);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    store.load()
      .then((result) => {
        if (cancelled) return;
        setState(result.state);
        setNotice(result.notice);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    // Other tabs saved: take their data. No save here, so no redraw loop.
    const unsubscribe = store.subscribe((fresh) => setState(fresh));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Newest saved data (or what we have in memory if storage is unavailable).
  const latest = useCallback(() => {
    const fresh = store.readLatest();
    if (fresh) {
      setState(fresh);
      return fresh;
    }
    return stateRef.current;
  }, []);

  // apply(state) returns { ok, errors, state } from inventory.js.
  const write = useCallback((apply) => {
    const base = latest();
    const result = apply(base);
    if (!result.ok) return result;
    const saved = store.save(result.state);
    if (!saved.ok) return { ok: false, errors: [saved.error], state: base };
    setState(result.state);
    return result;
  }, [latest]);

  const reset = useCallback(async () => {
    const result = await store.reset();
    setState(result.state);
    return result;
  }, []);

  return { state, notice, loadError, latest, write, reset };
}
