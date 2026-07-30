import type { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { normalizePhoneInput } from "./stocker";

export type AuthenticatedLiveRipCustomer = {
  id: string;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type LiveRipCustomerClient = Prisma.TransactionClient | typeof prisma;

const customerSelect = {
  id: true,
  phone: true,
  displayName: true,
  avatarUrl: true,
  phoneVerifiedAt: true,
} satisfies Prisma.UserSelect;

export async function resolveLiveRipCustomerWithClient(
  client: LiveRipCustomerClient,
  authenticatedUser: AuthenticatedLiveRipCustomer
) {
  const phone = normalizePhoneInput(authenticatedUser.phone ?? "") || null;
  const existingByPhone = phone
    ? await client.user.findUnique({
        where: { phone },
        select: customerSelect,
      })
    : null;

  if (existingByPhone) {
    const displayName = existingByPhone.displayName ?? authenticatedUser.displayName;
    const avatarUrl = existingByPhone.avatarUrl ?? authenticatedUser.avatarUrl;
    const needsUpdate =
      existingByPhone.phoneVerifiedAt === null ||
      displayName !== existingByPhone.displayName ||
      avatarUrl !== existingByPhone.avatarUrl;

    return needsUpdate
      ? client.user.update({
          where: { id: existingByPhone.id },
          data: {
            phoneVerifiedAt: existingByPhone.phoneVerifiedAt ?? new Date(),
            displayName,
            avatarUrl,
          },
          select: customerSelect,
        })
      : existingByPhone;
  }

  const existingById = await client.user.findUnique({
    where: { id: authenticatedUser.id },
    select: customerSelect,
  });

  if (existingById) {
    return client.user.update({
      where: { id: existingById.id },
      data: {
        phone,
        phoneVerifiedAt: phone ? existingById.phoneVerifiedAt ?? new Date() : existingById.phoneVerifiedAt,
        displayName: existingById.displayName ?? authenticatedUser.displayName,
        avatarUrl: existingById.avatarUrl ?? authenticatedUser.avatarUrl,
      },
      select: customerSelect,
    });
  }

  return client.user.create({
    data: {
      id: authenticatedUser.id,
      phone,
      phoneVerifiedAt: phone ? new Date() : null,
      displayName: authenticatedUser.displayName,
      avatarUrl: authenticatedUser.avatarUrl,
    },
    select: customerSelect,
  });
}

export function resolveLiveRipCustomer(authenticatedUser: AuthenticatedLiveRipCustomer) {
  return resolveLiveRipCustomerWithClient(prisma, authenticatedUser);
}
