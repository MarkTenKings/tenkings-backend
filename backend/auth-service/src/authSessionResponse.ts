export interface AuthSessionResponseSource {
  id: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  user: {
    id: string;
    phone: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface AuthSessionWallet {
  id: string;
  balance: number;
}

export function buildAuthSessionResponse(
  session: AuthSessionResponseSource,
  wallet: AuthSessionWallet | null,
) {
  return {
    session: {
      id: session.id,
      tokenHash: session.tokenHash,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      user: {
        id: session.user.id,
        phone: session.user.phone,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      },
    },
    wallet: wallet
      ? {
          id: wallet.id,
          balance: wallet.balance,
        }
      : null,
  };
}
