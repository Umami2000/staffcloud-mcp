#!/usr/bin/env node

/**
 * Interactive setup for staffcloud-mcp
 *
 * Prompts for API URL and Bearer token, validates the connection,
 * and writes the MCP configuration to the appropriate settings file.
 *
 * Usage:
 *   npx staffcloud-mcp --setup
 *   node dist/setup.js
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Helpers ────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Read a secret from stdin without echoing characters.
 * Shows `*` for each character typed. Supports backspace and pasted input.
 */
function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    let input = "";

    const onData = (ch: string) => {
      // Handle each character (or batch of chars for paste)
      for (const c of ch) {
        const code = c.charCodeAt(0);
        if (c === "\r" || c === "\n") {
          // Enter — done
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(input);
          return;
        } else if (code === 3) {
          // Ctrl+C — exit gracefully
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw ?? false);
          process.stdout.write("\n");
          process.exit(130);
        } else if (code === 127 || code === 8) {
          // Backspace / Delete
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (code >= 32) {
          // Printable character
          input += c;
          process.stdout.write("*");
        }
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * Restrict file permissions to owner-only (0600).
 * Silently ignored on Windows where chmod is a no-op.
 */
function restrictPermissions(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod may not be supported (e.g. Windows) — continue silently
  }
}

function printBanner() {
  console.log("");
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │        staffcloud-mcp — Setup Wizard      │");
  console.log("  │                                            │");
  console.log("  │   119 tools for the StaffCloud API         │");
  console.log("  │   by Reon Schröder — aetlo.ch              │");
  console.log("  └──────────────────────────────────────────┘");
  console.log("");
}

function printStep(n: number, label: string) {
  console.log(`\n  Step ${n}: ${label}`);
  console.log("  " + "─".repeat(40));
}

// ─── Validation ─────────────────────────────────────────────────

async function validateConnection(
  apiUrl: string,
  apiKey: string
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const url = `${apiUrl.replace(/\/$/, "")}/settings`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return { ok: true };
    }

    const body = await response.text().catch(() => "");
    let detail = `HTTP ${response.status}: ${response.statusText}`;

    if (response.status === 401 || response.status === 403) {
      detail += "\n  The API key was rejected. Check that it's a valid Bearer token.";
      if (apiKey.startsWith("Bearer ")) {
        detail +=
          "\n  NOTE: Your key starts with 'Bearer ' — remove that prefix.";
        detail +=
          "\n  The server adds 'Bearer ' automatically; just paste the token itself.";
      }
    } else if (response.status === 400) {
      if (body.includes("Invalid security token")) {
        detail += "\n  The token structure is invalid.";
        if (apiKey.startsWith("Bearer ")) {
          detail +=
            "\n  NOTE: Your key starts with 'Bearer ' — remove that prefix.";
        } else if (apiKey.length < 20) {
          detail += "\n  The token looks too short. StaffCloud uses JWT tokens (long strings starting with 'eyJ...').";
        }
      }
    } else if (response.status === 404) {
      detail += "\n  API URL may be wrong. Expected format: https://yourcompany.staff.cloud/api/v1";
    }

    return { ok: false, error: detail, detail: body };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: "Connection timed out after 15 seconds. Check the API URL.",
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      return {
        ok: false,
        error: `DNS lookup failed — "${apiUrl}" doesn't resolve. Check the URL.`,
      };
    }
    return { ok: false, error: `Connection failed: ${msg}` };
  }
}

// ─── Smoke Test ─────────────────────────────────────────────────

async function runSmokeTest(
  apiUrl: string,
  apiKey: string
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  const base = apiUrl.replace(/\/$/, "");

  try {
    // Try listing projects (limited to 1) as a quick functional check
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${base}/projects?fields=id&limit=1`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as unknown[];
      return {
        ok: true,
        detail: `found ${data.length > 0 ? "projects" : "no projects yet"} — API is working`,
      };
    }

    return {
      ok: false,
      error: `API returned HTTP ${response.status} on projects endpoint`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Smoke test failed: ${msg}` };
  }
}

// ─── Config Reading & Detection ─────────────────────────────────

interface McpConfig {
  mcpServers: Record<
    string,
    { command: string; args: string[]; env: Record<string, string> }
  >;
}

interface ExistingConfig {
  source: "mcp-json" | "claude";
  path: string;
  apiUrl: string;
  apiKey: string;
}

function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.local.json");
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function maskKey(key: string): string {
  if (key.length <= 16) return key.slice(0, 4) + "..." + key.slice(-4);
  return key.slice(0, 8) + "..." + key.slice(-8);
}

function findExistingConfigs(): ExistingConfig[] {
  const configs: ExistingConfig[] = [];

  // Check project-level .mcp.json
  const mcpPath = path.join(process.cwd(), ".mcp.json");
  const mcpConfig = readJsonFile(mcpPath) as unknown as McpConfig;
  if (mcpConfig.mcpServers?.staffcloud?.env) {
    const env = mcpConfig.mcpServers.staffcloud.env;
    if (env.STAFFCLOUD_API_URL && env.STAFFCLOUD_API_KEY) {
      configs.push({
        source: "mcp-json",
        path: mcpPath,
        apiUrl: env.STAFFCLOUD_API_URL,
        apiKey: env.STAFFCLOUD_API_KEY,
      });
    }
  }

  // Check global Claude settings
  const claudePath = getClaudeSettingsPath();
  const claudeConfig = readJsonFile(claudePath) as unknown as McpConfig;
  if (claudeConfig.mcpServers?.staffcloud?.env) {
    const env = claudeConfig.mcpServers.staffcloud.env;
    if (env.STAFFCLOUD_API_URL && env.STAFFCLOUD_API_KEY) {
      configs.push({
        source: "claude",
        path: claudePath,
        apiUrl: env.STAFFCLOUD_API_URL,
        apiKey: env.STAFFCLOUD_API_KEY,
      });
    }
  }

  return configs;
}

function writeConfig(
  apiUrl: string,
  apiKey: string,
  target: "claude" | "mcp-json" | "env",
  projectDir?: string,
  defaultPlannerId?: string,
  modules?: string,
): string {
  const env: Record<string, string> = {
    STAFFCLOUD_API_URL: apiUrl,
    STAFFCLOUD_API_KEY: apiKey,
  };
  if (defaultPlannerId) {
    env.STAFFCLOUD_DEFAULT_PLANNER_ID = defaultPlannerId;
  }
  if (modules && modules !== "core") {
    env.STAFFCLOUD_MODULES = modules;
  }
  const serverConfig = {
    command: "npx",
    args: ["staffcloud-mcp"],
    env,
  };

  if (target === "claude") {
    const settingsPath = getClaudeSettingsPath();
    const settings = readJsonFile(settingsPath) as unknown as McpConfig;
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers["staffcloud"] = serverConfig;

    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    restrictPermissions(settingsPath);
    return settingsPath;
  }

  if (target === "mcp-json") {
    const mcpPath = path.join(projectDir || process.cwd(), ".mcp.json");
    const config = readJsonFile(mcpPath) as unknown as McpConfig;
    config.mcpServers = config.mcpServers || {};
    config.mcpServers["staffcloud"] = serverConfig;
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
    restrictPermissions(mcpPath);
    return mcpPath;
  }

  // env file
  const envPath = path.join(projectDir || process.cwd(), ".env");
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
    // Remove existing staffcloud vars
    content = content
      .split("\n")
      .filter(
        (l) =>
          !l.startsWith("STAFFCLOUD_API_URL=") &&
          !l.startsWith("STAFFCLOUD_API_KEY=") &&
          !l.startsWith("STAFFCLOUD_DEFAULT_PLANNER_ID=") &&
          !l.startsWith("STAFFCLOUD_MODULES=")
      )
      .join("\n");
    if (!content.endsWith("\n")) content += "\n";
  }
  content += `STAFFCLOUD_API_URL="${apiUrl}"\n`;
  content += `STAFFCLOUD_API_KEY="${apiKey}"\n`;
  if (defaultPlannerId) {
    content += `STAFFCLOUD_DEFAULT_PLANNER_ID="${defaultPlannerId}"\n`;
  }
  if (modules && modules !== "core") {
    content += `STAFFCLOUD_MODULES="${modules}"\n`;
  }
  fs.writeFileSync(envPath, content);
  restrictPermissions(envPath);
  return envPath;
}

// ─── Reauthenticate ─────────────────────────────────────────────

async function reauthenticate(
  rl: readline.Interface,
  existing: ExistingConfig
): Promise<void> {
  const sourceLabel =
    existing.source === "mcp-json"
      ? `.mcp.json (project-level)`
      : `~/.claude/settings.local.json (global)`;

  console.log(`  Existing config found in: ${sourceLabel}`);
  console.log(`  API URL:  ${existing.apiUrl}`);
  console.log(`  API Key:  ${maskKey(existing.apiKey)}\n`);

  // Ask for new key
  console.log("  Paste your new API key (JWT token).");
  console.log("  IMPORTANT: Just the token — no 'Bearer ' prefix.");
  console.log("  (Input is masked for security)\n");

  let apiKey = "";
  while (!apiKey) {
    const input = (await askSecret("  New API Key: ")).trim();
    if (!input) {
      console.log("  API key is required.\n");
      continue;
    }
    let key = input;
    if (key.toLowerCase().startsWith("bearer ")) {
      key = key.slice(7).trim();
      console.log("  Stripped 'Bearer ' prefix (it's added automatically).");
    }
    if (key.length < 20) {
      console.log(
        "  Warning: Token looks too short. StaffCloud JWT tokens are typically 100+ characters."
      );
      const proceed = (await ask(rl, "  Use this key anyway? (y/N): "))
        .trim()
        .toLowerCase();
      if (proceed !== "y") continue;
    }
    apiKey = key;
  }

  // Optionally update the URL too
  const changeUrl = (
    await ask(rl, `\n  Change API URL too? Current: ${existing.apiUrl} (y/N): `)
  )
    .trim()
    .toLowerCase();

  let apiUrl = existing.apiUrl;
  if (changeUrl === "y") {
    const input = (await ask(rl, "  New API URL: ")).trim();
    if (input) {
      let url = input.replace(/\/$/, "");
      if (!url.startsWith("http")) url = "https://" + url;
      if (
        !url.includes("/api/v1") &&
        (url.endsWith(".staff.cloud") || url.match(/\.staff\.cloud$/))
      ) {
        url += "/api/v1";
        console.log(`  Auto-appended /api/v1 → ${url}`);
      }
      apiUrl = url;
    }
  }

  // Validate
  console.log(`\n  Validating connection to ${apiUrl} ...\n`);
  const validation = await validateConnection(apiUrl, apiKey);

  if (!validation.ok) {
    console.log(`  ✗ Connection failed!\n`);
    console.log(`  ${validation.error}\n`);
    const save = (await ask(rl, "  Save anyway? (y/N): "))
      .trim()
      .toLowerCase();
    if (save !== "y") {
      console.log("\n  Reauthentication cancelled.\n");
      return;
    }
  } else {
    console.log("  ✓ Connection successful!\n");
  }

  // Save back to the same location
  const savedPath = writeConfig(apiUrl, apiKey, existing.source);
  console.log(`  ✓ Credentials updated in: ${savedPath}\n`);
  console.log("  Next: run /mcp in Claude Code to reconnect with the new key.\n");
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Check for existing configuration
    const existingConfigs = findExistingConfigs();

    if (existingConfigs.length > 0) {
      console.log("  Existing StaffCloud configuration detected.\n");
      console.log("  1) Reauthenticate  (update API key for existing config)");
      console.log("  2) Full setup      (configure from scratch)\n");

      let mode = "";
      while (!["1", "2"].includes(mode)) {
        mode = (await ask(rl, "  Choice (1-2): ")).trim();
      }

      if (mode === "1") {
        if (existingConfigs.length === 1) {
          await reauthenticate(rl, existingConfigs[0]);
        } else {
          // Multiple configs found — let user pick which one
          console.log("\n  Multiple configs found:\n");
          existingConfigs.forEach((c, i) => {
            const label =
              c.source === "mcp-json" ? ".mcp.json (project)" : "settings.local.json (global)";
            console.log(`  ${i + 1}) ${label} — ${c.apiUrl}`);
          });
          console.log("");

          let pick = "";
          const valid = existingConfigs.map((_, i) => String(i + 1));
          while (!valid.includes(pick)) {
            pick = (await ask(rl, `  Which config? (1-${existingConfigs.length}): `)).trim();
          }
          await reauthenticate(rl, existingConfigs[parseInt(pick) - 1]);
        }
        console.log("  Done!\n");
        return;
      }

      console.log("");
    }

    // ── Step 1: API URL ──
    printStep(1, "StaffCloud API URL");
    console.log("  Your StaffCloud instance URL with /api/v1 suffix.");
    console.log("  Example: https://yourcompany.staff.cloud/api/v1\n");

    let apiUrl = "";
    while (!apiUrl) {
      const input = (await ask(rl, "  API URL: ")).trim();
      if (!input) {
        console.log("  URL is required.\n");
        continue;
      }
      // Auto-fix common mistakes
      let url = input.replace(/\/$/, "");
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }
      if (!url.includes("/api/v1")) {
        if (url.endsWith(".staff.cloud") || url.match(/\.staff\.cloud$/)) {
          url += "/api/v1";
          console.log(`  Auto-appended /api/v1 → ${url}`);
        } else {
          console.log(
            `  Warning: URL doesn't contain /api/v1. Expected format: https://yourcompany.staff.cloud/api/v1`
          );
          const proceed = (await ask(rl, "  Use this URL anyway? (y/N): "))
            .trim()
            .toLowerCase();
          if (proceed !== "y") continue;
        }
      }
      apiUrl = url;
    }

    // ── Step 2: API Key ──
    printStep(2, "Bearer Token (API Key)");
    console.log("  Your StaffCloud API key (JWT token).");
    console.log("  Find it in: StaffCloud → Settings → API → Security Token");
    console.log("  It's a long string starting with 'eyJ...'");
    console.log("");
    console.log("  IMPORTANT: Paste just the token — do NOT include 'Bearer ' prefix.");
    console.log("  (Input is masked for security)\n");

    let apiKey = "";
    while (!apiKey) {
      const input = (await askSecret("  API Key: ")).trim();
      if (!input) {
        console.log("  API key is required.\n");
        continue;
      }
      // Strip "Bearer " prefix if user pasted it
      let key = input;
      if (key.toLowerCase().startsWith("bearer ")) {
        key = key.slice(7).trim();
        console.log("  Stripped 'Bearer ' prefix (it's added automatically).");
      }
      if (key.length < 20) {
        console.log(
          "  Warning: Token looks too short. StaffCloud JWT tokens are typically 100+ characters."
        );
        const proceed = (await ask(rl, "  Use this key anyway? (y/N): "))
          .trim()
          .toLowerCase();
        if (proceed !== "y") continue;
      }
      apiKey = key;
    }

    // ── Step 3: Validate ──
    printStep(3, "Validating connection");
    console.log(`  Testing: ${apiUrl} ...\n`);

    const validation = await validateConnection(apiUrl, apiKey);

    if (!validation.ok) {
      console.log(`  ✗ Connection failed!\n`);
      console.log(`  ${validation.error}\n`);

      const retry = (await ask(rl, "  Save config anyway? (y/N): "))
        .trim()
        .toLowerCase();
      if (retry !== "y") {
        console.log("\n  Setup cancelled. Fix the issue and try again.\n");
        rl.close();
        process.exit(1);
      }
    } else {
      console.log("  ✓ Connection successful!\n");
    }

    // ── Step 4: Default Planner ──
    printStep(4, "Default Planner");
    console.log("  Fetching planners from your StaffCloud instance...\n");

    let defaultPlannerId = "";
    try {
      const plannerRes = await fetch(`${apiUrl.replace(/\/$/, "")}/planners?fields=id,firstname,lastname`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (plannerRes.ok) {
        const planners = (await plannerRes.json()) as { id: number; firstname: string; lastname: string }[];
        if (planners.length === 0) {
          console.log("  No planners found. You can set one later via STAFFCLOUD_DEFAULT_PLANNER_ID.\n");
        } else if (planners.length === 1) {
          defaultPlannerId = String(planners[0].id);
          console.log(`  Only one planner found: ${planners[0].firstname} ${planners[0].lastname} (ID: ${planners[0].id})`);
          console.log(`  Auto-selected as default planner.\n`);
        } else {
          console.log("  Available planners:\n");
          planners.forEach((p, i) => {
            console.log(`    ${i + 1}) ${p.firstname} ${p.lastname}  (ID: ${p.id})`);
          });
          console.log("");
          console.log("  The default planner is used when creating projects, events, and shifts.");
          console.log("  You can always override it per-request.\n");

          let pick = "";
          const valid = planners.map((_, i) => String(i + 1));
          while (!valid.includes(pick)) {
            pick = (await ask(rl, `  Select default planner (1-${planners.length}): `)).trim();
          }
          const selected = planners[parseInt(pick) - 1];
          defaultPlannerId = String(selected.id);
          console.log(`\n  ✓ Default planner: ${selected.firstname} ${selected.lastname} (ID: ${selected.id})\n`);
        }
      } else {
        console.log("  Could not fetch planners. You can set one later via STAFFCLOUD_DEFAULT_PLANNER_ID.\n");
      }
    } catch {
      console.log("  Could not fetch planners. You can set one later via STAFFCLOUD_DEFAULT_PLANNER_ID.\n");
    }

    // ── Step 5: Module Selection ──
    printStep(5, "Tool Modules");
    console.log("  staffcloud-mcp organizes tools into modules. Choose which to enable.\n");
    console.log("  Available modules:\n");
    console.log("    core      — 27 tools: employees, projects, events, assignments, scheduling");
    console.log("    setup     — 22 tools: clients, contacts, event functions, locations, bulk import");
    console.log("    ops       — 26 tools: assignment details, checkins, busy dates, ratings, work hours");
    console.log("    admin     — 26 tools: webhooks, messages, external staff, files, special dates");
    console.log("    reference — 18 tools: settings, planners, languages, wage profiles, metadata");
    console.log("");
    console.log("  1) core only       (27 tools — good starting point)");
    console.log("  2) core + setup    (49 tools — most common for daily use)");
    console.log("  3) all modules     (119 tools — everything)");
    console.log("  4) custom          (pick individual modules)\n");

    let moduleChoice = "";
    while (!["1", "2", "3", "4"].includes(moduleChoice)) {
      moduleChoice = (await ask(rl, "  Choice (1-4): ")).trim();
    }

    let selectedModules = "core";
    if (moduleChoice === "2") {
      selectedModules = "core,setup";
    } else if (moduleChoice === "3") {
      selectedModules = "all";
    } else if (moduleChoice === "4") {
      const allModules = ["core", "setup", "ops", "admin", "reference"];
      const picked: string[] = [];
      console.log("");
      for (const mod of allModules) {
        const yn = (await ask(rl, `  Enable ${mod}? (y/N): `)).trim().toLowerCase();
        if (yn === "y") picked.push(mod);
      }
      selectedModules = picked.length > 0 ? picked.join(",") : "core";
      if (picked.length === 0) {
        console.log("  No modules selected — defaulting to 'core'.");
      }
    }
    console.log(`\n  ✓ Modules: ${selectedModules}\n`);

    // ── Step 6: Save config ──
    printStep(6, "Save configuration");
    console.log("  Note: Sensitive employee data (email, phone, address, birthday) is always");
    console.log("  protected. The AI only sees planning-safe fields.\n");
    console.log("  Where should the MCP config be saved?\n");
    console.log("  1) ~/.claude/settings.local.json  (global — all Claude Code projects)");
    console.log("  2) .mcp.json                      (project-level — this directory only)");
    console.log("  3) .env file                      (for manual/custom setups)");
    console.log("  4) Print config only              (copy-paste yourself)\n");

    let choice = "";
    while (!["1", "2", "3", "4"].includes(choice)) {
      choice = (await ask(rl, "  Choice (1-4): ")).trim();
    }

    if (choice === "4") {
      console.log("\n  Add this to your MCP settings:\n");
      const printEnv: Record<string, string> = {
        STAFFCLOUD_API_URL: apiUrl,
        STAFFCLOUD_API_KEY: apiKey,
      };
      if (defaultPlannerId) {
        printEnv.STAFFCLOUD_DEFAULT_PLANNER_ID = defaultPlannerId;
      }
      if (selectedModules !== "core") {
        printEnv.STAFFCLOUD_MODULES = selectedModules;
      }
      console.log(
        JSON.stringify(
          {
            mcpServers: {
              staffcloud: {
                command: "npx",
                args: ["staffcloud-mcp"],
                env: printEnv,
              },
            },
          },
          null,
          2
        )
      );
      console.log("");
    } else {
      const targetMap = {
        "1": "claude" as const,
        "2": "mcp-json" as const,
        "3": "env" as const,
      };
      const savedPath = writeConfig(
        apiUrl, apiKey, targetMap[choice as "1" | "2" | "3"],
        undefined, defaultPlannerId, selectedModules
      );
      console.log(`\n  ✓ Config saved to: ${savedPath}`);
      console.log(`  ✓ File permissions restricted to owner-only (0600)\n`);
    }

    // ── Smoke test ──
    console.log("  Running smoke test...\n");
    const smokeResult = await runSmokeTest(apiUrl, apiKey);
    if (smokeResult.ok) {
      console.log(`  ✓ Smoke test passed!`);
      console.log(`    API responded successfully — ${smokeResult.detail}\n`);
    } else {
      console.log(`  ⚠ Smoke test warning: ${smokeResult.error}`);
      console.log("    The config was saved, but verify the connection manually.\n");
    }

    if (choice !== "4") {
      console.log("  Next steps:");
      console.log("  1. Restart Claude Code (or run /mcp to reconnect)");
      console.log('  2. Try: "List all projects" to verify it works\n');
    }

    console.log("  Setup complete!");
    console.log("  staffcloud-mcp by Reon Schröder — https://aetlo.ch\n");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});
