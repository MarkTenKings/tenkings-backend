'use client';

import { nanoid } from "nanoid";
import { useEffect, useState } from "react";

const VISITOR_ID_KEY = "tk-kingshunt-visitor-id";

export function useVisitorId(): string | null {
  const [visitorId, setVisitorId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const existingId = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existingId) {
      setVisitorId(existingId);
      return;
    }

    const nextId = typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : nanoid();
    window.localStorage.setItem(VISITOR_ID_KEY, nextId);
    setVisitorId(nextId);
  }, []);

  return visitorId;
}
