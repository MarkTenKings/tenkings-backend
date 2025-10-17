// Shared DTOs and interfaces for TenKings services.
export interface User {
  id: string;
  email: string;
}

export interface Item {
  id: string;
  name: string;
  set: string;
  number?: string;
  language?: string;
  foil?: boolean;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  amount: number;
  type: "credit" | "debit";
  createdAt: string;
  note?: string;
}

export interface Listing {
  id: string;
  itemId: string;
  sellerId: string;
  price: number;
  status: "ACTIVE" | "SOLD" | "REMOVED";
}

export interface PackDefinition {
  id: string;
  name: string;
  description?: string;
  price?: number;
  inventoryCount?: number;
  tiers: Array<{ tier: string; odds: number }>;
}

export {
  buildEbaySoldUrlFromText,
  buildEbaySoldUrlFromQuery,
  buildComparableEbayUrls,
} from "./ebay";
export type { EbayComparableUrls } from "./ebay";
export type { CardAttributes, AttributeExtractionOptions } from "./cardAttributes";
export { extractCardAttributes } from "./cardAttributes";
