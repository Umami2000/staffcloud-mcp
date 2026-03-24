/**
 * Shared types for modular tool system.
 *
 * Each module exports a ToolModule that provides tool definitions and a handler.
 * The main server loads only the modules specified by STAFFCLOUD_MODULES env var.
 */

import type { StaffCloudClient } from "../staffcloud-client.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  client: StaffCloudClient;
  descriptionField: string;
  defaultPlannerId?: number;
  /** When false (default), sensitive PII fields are stripped from employee output. */
  piiAccess: boolean;
}

export interface ToolModule {
  tools: ToolDefinition[];
  handle: (
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<string | null>;
}
