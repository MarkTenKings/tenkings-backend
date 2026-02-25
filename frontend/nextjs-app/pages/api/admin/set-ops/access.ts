import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { canPerformSetOpsRole } from "../../../../lib/server/setOps";
import { isSetOpsReplaceWizardEnabled } from "../../../../lib/server/setOpsReplace";

type ResponseBody =
  | {
      permissions: {
        reviewer: boolean;
        approver: boolean;
        delete: boolean;
        admin: boolean;
      };
      featureFlags: {
        replaceWizard: boolean;
      };
      user: {
        id: string;
        phone: string | null;
        displayName: string | null;
      };
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);

    return res.status(200).json({
      permissions: {
        reviewer: canPerformSetOpsRole(admin, "reviewer"),
        approver: canPerformSetOpsRole(admin, "approver"),
        delete: canPerformSetOpsRole(admin, "delete"),
        admin: canPerformSetOpsRole(admin, "admin"),
      },
      featureFlags: {
        replaceWizard: isSetOpsReplaceWizardEnabled(),
      },
      user: {
        id: admin.user.id,
        phone: admin.user.phone,
        displayName: admin.user.displayName,
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
