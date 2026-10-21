import { join } from "node:path";

export const DEFAULT_WORKSPACE_DIRECTORY = "无限画布工作区";

export function getDefaultWorkspacePath(documentsPath) {
  return join(documentsPath, DEFAULT_WORKSPACE_DIRECTORY);
}
