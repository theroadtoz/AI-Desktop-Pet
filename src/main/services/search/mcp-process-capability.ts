import { BUNDLED_BAIDU_SEARCH_COMMAND } from "../../../shared/web-search";

export type McpProcessCapabilityConfig = {
  command: string;
  args: string[];
  toolName: string;
  timeoutMs: number;
  maxResults: number;
};

export type McpSpawnConfig = {
  command: string;
  args: string[];
  shell: false;
};

type McpProcessRuntime = {
  bundledExecutable: string;
  bundledServerPath: string;
};

export function resolveMcpProcessCapability(
  config: McpProcessCapabilityConfig,
  runtime: McpProcessRuntime
): McpSpawnConfig {
  if (config.command === BUNDLED_BAIDU_SEARCH_COMMAND && config.args.length === 0) {
    return {
      command: runtime.bundledExecutable,
      args: [runtime.bundledServerPath],
      shell: false
    };
  }

  throw createMcpProcessNotAllowedError();
}

export function createMcpProcessNotAllowedError(): Error {
  const error = new Error("mcp_process_not_allowed");
  error.name = "mcp_process_not_allowed";
  return error;
}
