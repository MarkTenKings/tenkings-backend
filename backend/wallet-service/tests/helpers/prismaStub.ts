import { TransactionSource, TransactionType } from "@tenkings/database";

type UserRecord = {
  id: string;
  email: string;
  displayName?: string | null;
  createdAt: Date;
};

type WalletRecord = {
  id: string;
  userId: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

type WalletTransactionRecord = {
  id: string;
  walletId: string;
  amount: number;
  type: TransactionType;
  source: TransactionSource;
  note?: string;
  referenceId?: string;
  createdAt: Date;
};

type WalletWhereUnique = {
  id?: string;
  userId?: string;
};

type TransactionQuery = {
  orderBy?: { createdAt: "asc" | "desc" };
  take?: number;
};

type WalletInclude = {
  user?: boolean;
  transactions?: TransactionQuery;
};

type WalletSelect = {
  transactions?: TransactionQuery | boolean;
};

type UpsertUserArgs = {
  where: { email: string };
  update: { displayName?: string };
  create: {
    email: string;
    displayName?: string;
    wallet?: { create?: unknown };
  };
  include?: { wallet?: boolean };
};

type WalletFindUniqueArgs = {
  where: WalletWhereUnique;
  include?: WalletInclude;
  select?: WalletSelect;
};

type WalletUpdateArgs = {
  where: WalletWhereUnique;
  data: {
    balance?: { increment?: number; decrement?: number };
  };
};

type WalletTransactionCreateArgs = {
  data: {
    walletId: string;
    amount: number;
    type: TransactionType;
    source: TransactionSource;
    note?: string;
    referenceId?: string;
  };
};

export class PrismaStub {
  private sequence = 0;
  private usersById = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, UserRecord>();
  private walletsById = new Map<string, WalletRecord>();
  private walletsByUserId = new Map<string, WalletRecord>();
  private transactions: WalletTransactionRecord[] = [];

  public readonly user = {
    upsert: async (args: UpsertUserArgs) => this.upsertUser(args),
  };

  public readonly wallet = {
    findUnique: async (args: WalletFindUniqueArgs) => this.walletFindUnique(args),
    update: async (args: WalletUpdateArgs) => this.walletUpdate(args),
  };

  public readonly walletTransaction = {
    create: async (args: WalletTransactionCreateArgs) => this.walletTransactionCreate(args),
  };

  public async $transaction<T>(cb: (tx: this) => Promise<T>): Promise<T> {
    return cb({
      wallet: this.wallet,
      walletTransaction: this.walletTransaction,
    } as unknown as this);
  }

  public getWalletByUserId(userId: string) {
    const wallet = this.walletsByUserId.get(userId);
    return wallet ? { ...wallet } : undefined;
  }

  public getTransactions(walletId: string) {
    return this.transactions
      .filter((transaction) => transaction.walletId === walletId)
      .map((transaction) => ({ ...transaction }));
  }

  private nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private upsertUser(args: UpsertUserArgs) {
    const existing = this.usersByEmail.get(args.where.email);
    if (existing) {
      if (Object.prototype.hasOwnProperty.call(args.update, "displayName")) {
        const nextName = args.update.displayName;
        if (typeof nextName !== "undefined") {
          existing.displayName = nextName;
        }
      }
      return this.attachWalletToUser(existing, args.include);
    }

    const id = this.nextId("user");
    const user: UserRecord = {
      id,
      email: args.create.email,
      displayName: args.create.displayName ?? null,
      createdAt: new Date(),
    };
    this.usersById.set(id, user);
    this.usersByEmail.set(args.create.email, user);

    const walletId = this.nextId("wallet");
    const wallet: WalletRecord = {
      id: walletId,
      userId: id,
      balance: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.walletsById.set(walletId, wallet);
    this.walletsByUserId.set(id, wallet);

    return this.attachWalletToUser(user, args.include);
  }

  private attachWalletToUser(user: UserRecord, include?: { wallet?: boolean }) {
    const base = { ...user } as Record<string, unknown>;
    if (include?.wallet) {
      const wallet = this.walletsByUserId.get(user.id);
      base.wallet = wallet ? { ...wallet } : null;
    }
    return base;
  }

  private walletFindUnique(args: WalletFindUniqueArgs) {
    const wallet = this.resolveWallet(args.where);
    if (!wallet) {
      return null;
    }

    if (args.select) {
      return this.selectWallet(wallet, args.select);
    }

    return this.includeWallet(wallet, args.include);
  }

  private walletUpdate(args: WalletUpdateArgs) {
    const wallet = this.resolveWallet(args.where);
    if (!wallet) {
      throw new Error("wallet missing");
    }

    const { increment, decrement } = args.data.balance ?? {};
    if (typeof increment === "number") {
      wallet.balance += increment;
    }
    if (typeof decrement === "number") {
      wallet.balance -= decrement;
    }
    wallet.updatedAt = new Date();

    this.walletsById.set(wallet.id, wallet);
    this.walletsByUserId.set(wallet.userId, wallet);

    return { ...wallet };
  }

  private walletTransactionCreate(args: WalletTransactionCreateArgs) {
    const transaction: WalletTransactionRecord = {
      id: this.nextId("txn"),
      walletId: args.data.walletId,
      amount: args.data.amount,
      type: args.data.type,
      source: args.data.source,
      note: args.data.note,
      referenceId: args.data.referenceId,
      createdAt: new Date(),
    };
    this.transactions.push(transaction);
    return { ...transaction };
  }

  private resolveWallet(where: WalletWhereUnique) {
    if (where.id) {
      return this.walletsById.get(where.id);
    }
    if (where.userId) {
      return this.walletsByUserId.get(where.userId);
    }
    return undefined;
  }

  private includeWallet(wallet: WalletRecord, include?: WalletInclude) {
    const result: Record<string, unknown> = { ...wallet };
    if (include?.user) {
      const user = this.usersById.get(wallet.userId);
      result.user = user ? { ...user } : null;
    }
    if (include?.transactions) {
      result.transactions = this.materializeTransactions(wallet.id, include.transactions);
    }
    return result;
  }

  private selectWallet(wallet: WalletRecord, select: WalletSelect) {
    const result: Record<string, unknown> = {};
    if (select.transactions) {
      const query = typeof select.transactions === "boolean" ? {} : select.transactions;
      result.transactions = this.materializeTransactions(wallet.id, query);
    }
    return result;
  }

  private materializeTransactions(walletId: string, query?: TransactionQuery) {
    const order = query?.orderBy?.createdAt ?? "desc";
    const take = query?.take;

    let transactions = this.transactions
      .filter((txn) => txn.walletId === walletId)
      .map((txn) => ({ ...txn }));

    transactions.sort((a, b) => {
      if (order === "asc") {
        return a.createdAt.getTime() - b.createdAt.getTime();
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    if (typeof take === "number") {
      transactions = transactions.slice(0, take);
    }

    return transactions;
  }
}
