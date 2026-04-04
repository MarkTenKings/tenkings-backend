'use client';

import { useCallback, useState } from "react";
import type { ComputeRouteRequest, ComputeRouteResponse } from "../lib/kingsHunt";

export interface UseRouteComputationReturn {
  computeRoute: (request: ComputeRouteRequest) => Promise<ComputeRouteResponse>;
  isComputing: boolean;
  lastRoute: ComputeRouteResponse | null;
  error: string | null;
}

export function useRouteComputation(): UseRouteComputationReturn {
  const [isComputing, setIsComputing] = useState(false);
  const [lastRoute, setLastRoute] = useState<ComputeRouteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const computeRoute = useCallback(async (request: ComputeRouteRequest) => {
    setIsComputing(true);
    setError(null);

    try {
      const response = await fetch("/api/kingshunt/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const payload = (await response.json().catch(() => ({}))) as ComputeRouteResponse & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Unable to compute walking route");
      }

      setLastRoute(payload);
      return payload;
    } catch (routeError) {
      const message = routeError instanceof Error ? routeError.message : "Unable to compute walking route";
      setError(message);
      throw routeError;
    } finally {
      setIsComputing(false);
    }
  }, []);

  return { computeRoute, isComputing, lastRoute, error };
}
