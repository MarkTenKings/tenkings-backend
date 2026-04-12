import { useCallback, useEffect, useState } from "react";
import type { StockerShiftData } from "../types/stocker";

type UseStockerShiftResult = {
  shift: StockerShiftData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useStockerShift(token: string | null | undefined): UseStockerShiftResult {
  const [shift, setShift] = useState<StockerShiftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setShift(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/stocker/shift/current", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error?.message ?? "Failed to load shift");
      }
      setShift(payload?.data?.shift ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load shift");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { shift, loading, error, refresh };
}
