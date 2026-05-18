import { router } from "~/server/api/trpc";

import { addMcpServer } from "./addMcpServer";
import { deleteMcpServer } from "./deleteMcpServer";
import { getMcpServerTools } from "./getMcpServerTools";
import { listMcpServers } from "./listMcpServers";
import { setMcpServerAllowedTools } from "./setMcpServerAllowedTools";
import { testMcpConnection } from "./testMcpConnection";
import { updateMcpServer } from "./updateMcpServer";

export const mcpRouter = router({
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  testMcpConnection,
  getMcpServerTools,
  setMcpServerAllowedTools,
});
