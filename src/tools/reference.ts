import type { ToolDefinition, ToolContext } from "./types.js";
import { validate, buildParams, formatResult, zId, zFields, zListParams } from "./shared.js";
import { z } from "zod";
import { getFieldDefinitions } from "../smart-tools.js";

export const tools: ToolDefinition[] = [
  // ── Settings & Config ──
  {
    name: "list_settings",
    description: "List StaffCloud tenant settings and configuration values.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },
  {
    name: "list_planners",
    description:
      "List all planners (admin/manager users). Planners are needed as planner_id when creating projects.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },
  {
    name: "list_languages",
    description: "List all available languages in the StaffCloud instance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },
  {
    name: "list_wage_profiles",
    description:
      "List wage profiles (salary/payment templates). Use this to find valid wage_profile_id " +
      "values when creating employees.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_wage_types",
    description:
      "List wage types (hourly, daily, flat rate, etc.). Shows the types of compensation available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },

  // ── Schema / Metadata ──
  {
    name: "list_attributes",
    description:
      "List all 155+ attribute/field definitions. Maps dynamic_field_* IDs to human-readable labels. " +
      "ESSENTIAL: call this first to understand what custom fields like dynamic_field_49 mean. " +
      "For a more user-friendly view, use get_field_definitions smart tool instead.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_forms",
    description:
      "List all form definitions. Forms define which fields appear in the UI for employees, clients, events, etc. " +
      "Key forms: 6=employee_manage, 7=employee_my_account, 8/9=search forms.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_automations",
    description: "List all configured automations/workflow rules in StaffCloud.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_collection_values",
    description:
      "List values from a StaffCloud collection (reference data). " +
      "Key collections: 5=Qualifications, 6=Functions, 7=Locations, 8=Countries, 9=Gender, " +
      "12=Wage profiles, 13=Civil Status, 19=Kanton, 25=Sprachregion. " +
      "Example: collection_id=19 to list all Swiss cantons with their IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_id: {
          type: "number",
          description: "Collection ID. Key IDs: 7=Locations, 36=Counties/Kantone.",
        },
        fields: {
          type: "string",
          description: "Comma-separated fields.",
        },
      },
      required: ["collection_id"],
    },
  },

  // ── Availability ──
  {
    name: "list_availability_requests",
    description:
      "List availability requests. No longer requires employee_id — returns all requests by default. Add ?loadPastRequests=true to include past/completed requests.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
        filter: { type: "string", description: "Additional filters." },
      },
    },
  },

  // ── Pay Runs & Pay Lines ──
  {
    name: "list_pay_runs",
    description: "List pay runs (payroll batches). Read-only.",
    inputSchema: { type: "object" as const, properties: { fields: { type: "string" }, filter: { type: "string" }, sort: { type: "string" } } },
  },
  {
    name: "get_pay_run",
    description: "Get a single pay run by ID.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number" }, fields: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_pay_lines",
    description: "List pay lines (individual payroll entries within pay runs). Read-only.",
    inputSchema: { type: "object" as const, properties: { fields: { type: "string" }, filter: { type: "string" }, sort: { type: "string" } } },
  },
  {
    name: "get_pay_line",
    description: "Get a single pay line by ID.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number" }, fields: { type: "string" } }, required: ["id"] },
  },

  // ── Time Slots ──
  {
    name: "list_time_slots",
    description: "List time slot definitions used for availability scheduling. Shows name, week_days, from/to times.",
    inputSchema: { type: "object" as const, properties: { fields: { type: "string" } } },
  },
  {
    name: "get_time_slot",
    description: "Get a single time slot by ID.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number" }, fields: { type: "string" } }, required: ["id"] },
  },

  // ── Smart: Field Definitions ──
  {
    name: "get_field_definitions",
    description:
      "SMART TOOL — Look up custom field definitions in ONE call. " +
      "Answers: 'What does dynamic_field_49 mean?', 'What custom fields exist for employees?'. " +
      "Maps dynamic_field_* IDs to human-readable labels. " +
      "More user-friendly than raw list_attributes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource: {
          type: "string",
          description: 'Filter by resource type: "employee", "client", "contact". Omit for all.',
        },
        field_id: {
          type: "string",
          description: 'Look up a specific field. Example: "dynamic_field_49" or just "49".',
        },
      },
    },
  },

  // ── Destructive ──
  {
    name: "delete_project",
    description:
      "⛔ DESTRUCTIVE — Delete a project by ID. This PERMANENTLY removes the project AND all associated events, " +
      "event functions, and assignments. All staff assignments under this project will be lost. " +
      "This action CANNOT be undone. ALWAYS confirm with the user before executing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Project ID to delete." },
      },
      required: ["id"],
    },
  },
];

const TOOL_NAMES = new Set(tools.map((t) => t.name));

export async function handle(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string | null> {
  if (!TOOL_NAMES.has(name)) return null;
  const { client } = ctx;

  switch (name) {
    // ── Settings & Config ──
    case "list_settings":
      return formatResult(await client.listSettings(buildParams(args)));
    case "list_planners":
      return formatResult(await client.listPlanners(buildParams(args)));
    case "list_languages":
      return formatResult(await client.listLanguages(buildParams(args)));
    case "list_wage_profiles":
      return formatResult(await client.listWageProfiles());
    case "list_wage_types":
      return formatResult(await client.listWageTypes(buildParams(args)));

    // ── Schema / Metadata ──
    case "list_attributes":
      return formatResult(await client.listAttributes());
    case "list_forms":
      return formatResult(await client.listForms());
    case "list_automations":
      return formatResult(await client.listAutomations());
    case "list_collection_values": {
      const v = validate(z.object({ collection_id: zId, fields: zFields }), args, name);
      return formatResult(await client.listCollectionValues(v.collection_id, buildParams(v)));
    }

    // ── Availability ──
    case "list_availability_requests":
      return formatResult(
        await client.listAvailabilityRequests(buildParams(args))
      );

    // ── Pay Runs & Pay Lines ──
    case "list_pay_runs": {
      validate(zListParams, args, name);
      return formatResult(await client.listPayRuns(buildParams(args)));
    }
    case "get_pay_run": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getPayRun(v.id, buildParams(v)));
    }
    case "list_pay_lines": {
      validate(zListParams, args, name);
      return formatResult(await client.listPayLines(buildParams(args)));
    }
    case "get_pay_line": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getPayLine(v.id, buildParams(v)));
    }

    // ── Time Slots ──
    case "list_time_slots": {
      validate(zListParams, args, name);
      return formatResult(await client.listTimeSlots(buildParams(args)));
    }
    case "get_time_slot": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getTimeSlot(v.id, buildParams(v)));
    }

    // ── Smart: Field Definitions ──
    case "get_field_definitions": {
      const v = validate(
        z.object({
          resource: z.string().optional(),
          field_id: z.string().optional(),
        }),
        args,
        name
      );
      return formatResult(await getFieldDefinitions(client, v));
    }

    // ── Destructive ──
    case "delete_project": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteProject(v.id));
    }
    default:
      return null;
  }
}
