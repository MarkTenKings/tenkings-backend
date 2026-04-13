import { useCallback, useEffect, useState } from "react";
import type { StockerShiftData } from "../types/stocker";

type UseStockerShiftResult = {
  shift: StockerShiftData | null;
  shifts: StockerShiftData[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useStockerShift(token: string | null | undefined, shiftId?: string | null): UseStockerShiftResult {
  const [shift, setShift] = useState<StockerShiftData | null>(null);
  const [shifts, setShifts] = useState<StockerShiftData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setShift(null);
      setShifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (shiftId) params.set("shiftId", shiftId);
      const query = params.toString();
      const response = await fetch(`/api/stocker/shift/current${query ? `?${query}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error?.message ?? "Failed to load shift");
      }
      const nextShift = payload?.data?.shift ?? null;
      const nextShifts = Array.isArray(payload?.data?.shifts) ? payload.data.shifts : nextShift ? [nextShift] : [];
      setShift(nextShift);
      setShifts(nextShifts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load shift");
    } finally {
      setLoading(false);
    }
  }, [shiftId, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { shift, shifts, loading, error, refresh };
}
