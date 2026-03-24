#!/usr/bin/env node

/**
 * StaffCloud MCP Server
 * by Reon Schröder — https://aetlo.ch
 *
 * Modular MCP server for the StaffCloud REST API.
 * Tools are organized into modules loaded via STAFFCLOUD_MODULES env var.
 *
 * Modules:
 *   core      — 27 tools: employees, projects, events, assignments, smart scheduling (DEFAULT)
 *   setup     — 22 tools: clients, contacts, event functions, locations, bulk import
 *   ops       — 26 tools: assignment details, checkins, busy dates, ratings, work hours
 *   admin     — 26 tools: webhooks, messages, external staff, files, special dates
 *   reference — 18 tools: settings, planners, languages, wage profiles, pay runs, metadata
 *
 * Environment variables:
 *   STAFFCLOUD_API_URL              - Base URL (e.g. https://yourcompany.staff.cloud/api/v1)
 *   STAFFCLOUD_API_KEY              - Bearer JWT token
 *   STAFFCLOUD_MODULES              - Comma-separated modules to load (default: "core")
 *                                     Use "all" to load everything (119 tools)
 *   STAFFCLOUD_DEFAULT_PLANNER_ID   - Default planner ID for create operations
 *   STAFFCLOUD_DESCRIPTION_FIELD    - Dynamic field for event descriptions (default: dynamic_field_51)
 */

// ─── Handle --setup flag ─────────────────────────────────────
// Must run before env var checks — setup doesn't need API credentials.

if (process.argv.includes("--setup")) {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const setupPath = fileURLToPath(new URL("./setup.js", import.meta.url));
  try {
    execFileSync(process.execPath, [setupPath], { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
  process.exit(0);
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { StaffCloudClient } from "./staffcloud-client.js";
import type { ToolModule, ToolContext } from "./tools/types.js";

// Module imports
import * as coreModule from "./tools/core.js";
import * as setupModule from "./tools/setup.js";
import * as opsModule from "./tools/ops.js";
import * as adminModule from "./tools/admin.js";
import * as referenceModule from "./tools/reference.js";

// ─── Config ───────────────────────────────────────────────────

const API_URL = process.env["STAFFCLOUD_API_URL"];
const API_KEY = process.env["STAFFCLOUD_API_KEY"];

if (!API_URL || !API_KEY) {
  console.error(
    "[staffcloud-mcp] STAFFCLOUD_API_URL and STAFFCLOUD_API_KEY must be set"
  );
  process.exit(1);
}

const DESCRIPTION_FIELD =
  process.env["STAFFCLOUD_DESCRIPTION_FIELD"] || "dynamic_field_51";
const DEFAULT_PLANNER_ID = process.env["STAFFCLOUD_DEFAULT_PLANNER_ID"]
  ? parseInt(process.env["STAFFCLOUD_DEFAULT_PLANNER_ID"], 10)
  : undefined;
const client = new StaffCloudClient({ baseUrl: API_URL, apiKey: API_KEY });

// ─── Module Registry ──────────────────────────────────────────

const MODULE_REGISTRY: Record<string, ToolModule> = {
  core: coreModule,
  setup: setupModule,
  ops: opsModule,
  admin: adminModule,
  reference: referenceModule,
};

const AVAILABLE_MODULES = Object.keys(MODULE_REGISTRY).join(", ");

// Parse STAFFCLOUD_MODULES env var
const moduleSpec = process.env["STAFFCLOUD_MODULES"] || "core";
const requestedModules =
  moduleSpec === "all"
    ? Object.keys(MODULE_REGISTRY)
    : moduleSpec.split(",").map((m) => m.trim().toLowerCase());

// Validate module names
for (const m of requestedModules) {
  if (!MODULE_REGISTRY[m]) {
    console.error(
      `[staffcloud-mcp] Unknown module: "${m}". Available: ${AVAILABLE_MODULES}`
    );
    process.exit(1);
  }
}

// Load selected modules
const activeModules = requestedModules.map((m) => MODULE_REGISTRY[m]!);

// Deduplicate tools (e.g. list_planners appears in both core and reference)
const allTools = activeModules.flatMap((m) => m.tools);
const seenTools = new Set<string>();
const TOOLS = allTools.filter((t) => {
  if (seenTools.has(t.name)) return false;
  seenTools.add(t.name);
  return true;
});

// Build O(1) tool→module dispatch map
const TOOL_DISPATCH = new Map<string, ToolModule>();
for (const mod of activeModules) {
  for (const tool of mod.tools) {
    TOOL_DISPATCH.set(tool.name, mod);
  }
}

// Context for handlers
const ctx: ToolContext = {
  client,
  descriptionField: DESCRIPTION_FIELD,
  defaultPlannerId: DEFAULT_PLANNER_ID,
  piiAccess: false, // PII protection is always on — sensitive employee data is never exposed
};

// ─── Rate Limit Warning ───────────────────────────────────────

function rateLimitWarning(): string {
  const info = client.rateLimitInfo;
  if (info.remaining !== null && info.remaining < 1000) {
    return `\n⚠️ Rate limit: ${info.remaining}/${info.limit} requests remaining (resets in ${Math.round((info.reset ?? 0) / 60)}min)`;
  }
  return "";
}

// ─── Tool Dispatch ────────────────────────────────────────────

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const mod = TOOL_DISPATCH.get(name);
  if (!mod) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  const result = await mod.handle(name, args, ctx);
  if (result === null) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  return result + rateLimitWarning();
}

// ─── Server Setup ──────────────────────────────────────────────

const server = new Server(
  { name: "staffcloud-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleToolCall(
      name,
      (args ?? {}) as Record<string, unknown>
    );
    return {
      content: [{ type: "text" as const, text: result }],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[staffcloud-mcp] Server started | ${API_URL} | modules: [${requestedModules.join(", ")}] | ${TOOLS.length} tools`
  );
}

main().catch((error) => {
  console.error("[staffcloud-mcp] Fatal:", error);
  process.exit(1);
});
