const rawIds = process.env.NEXT_PUBLIC_ADMIN_USER_IDS ?? "";
const rawPhones = process.env.NEXT_PUBLIC_ADMIN_PHONES ?? "";

const normalizePhone = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "");
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

export const ADMIN_USER_IDS = rawIds
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

export const ADMIN_PHONES = rawPhones
  .split(",")
  .map((phone) => normalizePhone(phone.trim()))
  .filter(Boolean);

export const hasAdminAccess = (userId: string | null | undefined) => {
  if (!userId) {
    return false;
  }
  return ADMIN_USER_IDS.includes(userId);
};

export const hasAdminPhoneAccess = (phone: string | null | undefined) => {
  if (!phone) {
    return false;
  }
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return false;
  }
  return ADMIN_PHONES.includes(normalized);
};
