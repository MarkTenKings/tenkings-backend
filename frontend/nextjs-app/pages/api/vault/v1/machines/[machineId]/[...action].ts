import type { NextApiRequest, NextApiResponse } from "next";
import { handleVaultMachineAction } from "../../../../../../lib/server/vaultV1/machineActions";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleVaultMachineAction(req, res);
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };
