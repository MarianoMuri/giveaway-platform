import { useEffect, useState, useCallback } from 'react';
import { api } from './api';

// Carga datos de la API; si se pasa intervalo, refresca solo.
export function useApi(path, { auth = false, interval = 0 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api(path, { auth }));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [path, auth]);

  useEffect(() => {
    reload();
    if (!interval) return undefined;
    const t = setInterval(reload, interval);
    return () => clearInterval(t);
  }, [reload, interval]);

  return { data, error, loading, reload, setData };
}
