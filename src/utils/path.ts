import * as path from "node:path";

/**
 * Resolve a config path against the workspace root unless it is already absolute.
 */
export function resolveWorkspacePath(workspacePath: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(workspacePath, filePath);
}
