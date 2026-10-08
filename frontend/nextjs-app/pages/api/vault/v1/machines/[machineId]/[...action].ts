import type { NextApiRequest, NextApiResponse } from "next";
import { withVaultJsonBody } from "../../../../../../lib/server/vaultV1/http";
import { handleVaultMachineAction } from "../../../../../../lib/server/vaultV1/machineActions";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleVaultMachineAction(req, res);
}

export const config = { api: { bodyParser: false } };
export default withVaultJsonBody(handler, 8 * 1024 * 1024);
