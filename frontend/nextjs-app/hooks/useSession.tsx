import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { requestLoginCode, verifyLoginCode, setAuthToken, fetchProfile } from "../lib/api";
import AuthModal from "../components/AuthModal";

export interface SessionPayload {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    phone: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  wallet: {
    id: string;
    balance: number;
  };
}

interface SessionContextValue {
  session: SessionPayload | null;
  loading: boolean;
  ensureSession: () => Promise<SessionPayload>;
  logout: () => void;
  updateWalletBalance: (balance: number) => void;
  updateProfile: (changes: { displayName?: string | null; avatarUrl?: string | null }) => void;
}

type Resolver = {
  resolve: (session: SessionPayload) => void;
  reject: (error: Error) => void;
};

type AuthState = {
  open: boolean;
  step: "phone" | "code";
  phone: string;
  code: string;
  loading: boolean;
  message: string | null;
  error: string | null;
};

const initialAuthState: AuthState = {
  open: false,
  step: "phone",
  phone: "",
  code: "",
  loading: false,
  message: null,
  error: null,
};

const normalizePhoneInput = (input: string) => {
  if (!input) {
    return "";
  }
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/[^0-9]/g, "");
    return digits ? `+${digits}` : "";
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
};

const extractErrorMessage = (value: unknown): string => {
  if (!value) {
    return "Something went wrong";
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") {
        return extractErrorMessage(parsed);
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        return extractErrorMessage(parsed[0]);
      }
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        return extractErrorMessage((parsed as { message: unknown }).message);
      }
    } catch (error) {
      // ignore parse errors and fall through
    }
    const trimmed = value.trim();
    if (trimmed.toLowerCase().includes("failed to fetch")) {
      return "Unable to reach Ten Kings right now. Check your connection and try again.";
    }
    return trimmed ? trimmed : "Something went wrong";
  }
  if (typeof value === "object" && value && "message" in value) {
    return extractErrorMessage((value as { message: unknown }).message);
  }
  return "Something went wrong";
};

const storageKey = "tenkings.session";

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<AuthState>(initialAuthState);
  const resolverRef = useRef<Resolver | null>(null);
  const profileRefreshRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setLoading(false);
        return;
      }
      const stored: SessionPayload = JSON.parse(raw);
      stored.user = {
        id: stored.user?.id ?? "",
        phone: stored.user?.phone ?? null,
        displayName: stored.user?.displayName ?? null,
        avatarUrl: stored.user?.avatarUrl ?? null,
      };
      if (new Date(stored.expiresAt).getTime() <= Date.now()) {
        window.localStorage.removeItem(storageKey);
        setLoading(false);
        return;
      }
      setSession(stored);
      setAuthToken(stored.token);
    } catch (error) {
      console.error("Failed to restore session", error);
      window.localStorage.removeItem(storageKey);
    } finally {
      setLoading(false);
    }
  }, []);

  const normalizeBalance = (balance: unknown): number => {
    if (typeof balance === "number" && Number.isFinite(balance)) {
      return balance;
    }
    if (typeof balance === "string") {
      const parsed = Number(balance);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (balance && typeof balance === "object" && "toString" in (balance as Record<string, unknown>)) {
      const parsed = Number((balance as { toString: () => string }).toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const persistSession = (payload: SessionPayload) => {
    const normalized: SessionPayload = {
      token: payload.token,
      expiresAt: payload.expiresAt,
      user: {
        id: payload.user.id,
        phone: payload.user.phone ?? null,
        displayName: payload.user.displayName ?? null,
        avatarUrl: payload.user.avatarUrl ?? null,
      },
      wallet: {
        id: payload.wallet.id,
        balance: normalizeBalance(payload.wallet.balance),
      },
    };
    setSession(normalized);
    setAuthToken(normalized.token);
    profileRefreshRef.current = false;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    }
  };

  const clearSession = () => {
    setSession(null);
    setAuthToken(null);
    profileRefreshRef.current = false;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  };

  const updateWalletBalance = useCallback((balance: number) => {
    setSession((prev) => {
      if (!prev) {
        return prev;
      }
      const updated = {
        ...prev,
        wallet: { ...prev.wallet, balance: normalizeBalance(balance) },
      };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  const updateProfile = useCallback((changes: { displayName?: string | null; avatarUrl?: string | null }) => {
    setSession((prev) => {
      if (!prev) {
        return prev;
      }
      const updatedUser = { ...prev.user };
      if (Object.prototype.hasOwnProperty.call(changes, "displayName")) {
        updatedUser.displayName = changes.displayName ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(changes, "avatarUrl")) {
        updatedUser.avatarUrl = changes.avatarUrl ?? null;
      }
      const updated = { ...prev, user: updatedUser };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const result = await fetchProfile();
      setSession((prev) => {
        if (!prev) {
          return prev;
        }
        const updated = {
          ...prev,
          user: {
            ...prev.user,
            phone: result.user?.phone ?? prev.user.phone,
            displayName: result.user?.displayName ?? null,
            avatarUrl: result.user?.avatarUrl ?? null,
          },
          wallet: result.wallet
            ? {
                id: result.wallet.id,
                balance: normalizeBalance(result.wallet.balance),
              }
            : prev.wallet,
        };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, JSON.stringify(updated));
        }
        return updated;
      });
    } catch (error) {
      // Silent refresh failure; session remains usable
    } finally {
      profileRefreshRef.current = true;
    }
  }, []);

  const ensureSession = () => {
    if (session) {
      if (!profileRefreshRef.current) {
        refreshProfile().catch(() => undefined);
      }
      return Promise.resolve(session);
    }
    setAuthState((prev) => ({ ...prev, open: true, step: "phone", error: null, message: null }));
    return new Promise<SessionPayload>((resolve, reject) => {
      resolverRef.current = { resolve, reject };
    });
  };

  const handleCloseModal = () => {
    setAuthState(initialAuthState);
    if (resolverRef.current) {
      resolverRef.current.reject(new Error("Authentication cancelled"));
      resolverRef.current = null;
    }
  };

  const handleSendCode = async () => {
    const rawPhone = authState.phone.trim();
    const normalized = normalizePhoneInput(rawPhone);
    if (!normalized) {
      setAuthState((prev) => ({ ...prev, error: "Enter your phone number" }));
      return;
    }
    setAuthState((prev) => ({ ...prev, loading: true, error: null, message: null }));
    try {
      await requestLoginCode(normalized);
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        step: "code",
        message: "Code sent via SMS",
      }));
    } catch (error) {
      const message = error instanceof Error ? extractErrorMessage(error.message) : "Failed to send code";
      setAuthState((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const handleVerifyCode = async () => {
    const phone = normalizePhoneInput(authState.phone.trim());
    const code = authState.code.trim();
    if (!phone || !code) {
      setAuthState((prev) => ({ ...prev, error: "Enter your code" }));
      return;
    }
    setAuthState((prev) => ({ ...prev, loading: true, error: null, message: null }));
    try {
      const payload = await verifyLoginCode({ phone, code });
      const sessionPayload: SessionPayload = {
        token: payload.token,
        expiresAt: payload.expiresAt,
        user: payload.user,
        wallet: payload.wallet,
      };
      persistSession(sessionPayload);
      refreshProfile().catch(() => undefined);
      setAuthState(initialAuthState);
      if (resolverRef.current) {
        resolverRef.current.resolve(sessionPayload);
        resolverRef.current = null;
      }
    } catch (error) {
      const message = error instanceof Error ? extractErrorMessage(error.message) : "Verification failed";
      setAuthState((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const logout = () => {
    clearSession();
  };

  useEffect(() => {
    if (!session || loading) {
      return;
    }
    if (profileRefreshRef.current) {
      return;
    }
    refreshProfile().catch(() => undefined);
  }, [session, loading, refreshProfile]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const handleFocus = () => {
      refreshProfile().catch(() => undefined);
    };
    if (typeof window === "undefined") {
      return;
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [session, refreshProfile]);

  const contextValue = useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      ensureSession,
      logout,
      updateWalletBalance,
      updateProfile,
    }),
    [session, loading, ensureSession, logout, updateWalletBalance, updateProfile]
  );

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
      <AuthModal
        open={authState.open}
        step={authState.step}
        phone={authState.phone}
        code={authState.code}
        loading={authState.loading}
        message={authState.message}
        error={authState.error}
        onPhoneChange={(value) => setAuthState((prev) => ({ ...prev, phone: value }))}
        onCodeChange={(value) => setAuthState((prev) => ({ ...prev, code: value }))}
        onClose={handleCloseModal}
        onSendCode={handleSendCode}
        onVerifyCode={handleVerifyCode}
      />
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
