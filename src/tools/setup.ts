import type { ToolDefinition, ToolContext } from "./types.js";
import {
  validate,
  buildParams,
  formatResult,
  autoFormatPhones,
  zId,
  zFields,
  zData,
  zListParams,
} from "./shared.js";
import { z } from "zod";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  bulkCreateProjects,
  bulkCreateEvents,
  bulkCreateEventFunctions,
  bulkUpdateEventFunctions,
  bulkUpdateEvents,
} from "../smart-tools.js";

export const tools: ToolDefinition[] = [
  // ════════════════════════════════════════════════════════════════
  // EVENT FUNCTIONS (roles/positions within events)
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_event_functions",
    description:
      "List event functions (roles/positions within events). Event functions define what positions " +
      "are needed at an event (e.g. 'Promoter', 'Hostess'). Assignments link employees to event functions. " +
      "Hierarchy: Project → Event → Event Function → Assignment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: 'Example: "id,event_id,function_id,description,quantity,start,end".' },
        sort: { type: "string", description: "Sort fields." },
        filter: { type: "string", description: 'Filters. Example: "event_id=123".' },
      },
    },
  },
  {
    name: "get_event_function",
    description: "Get a single event function by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Event function ID." },
        fields: { type: "string", description: "Comma-separated fields." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_event_function",
    description:
      "Create an event function (position/role) within an event. Requires event_id and function_id. " +
      "Use list_functions to find valid function_id values. Set quantity for number of positions needed. " +
      'Example: {"event_id":1,"function_id":1,"quantity":3,"description":"Morning promoters","start":"2026-04-01 08:00:00","end":"2026-04-01 14:00:00"}.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Event function data with event_id, function_id, quantity, etc." },
      },
      required: ["data"],
    },
  },
  {
    name: "update_event_function",
    description: "Update an event function (change quantity, times, description, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Event function ID." },
        data: { type: "object", description: "Fields to update." },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_event_function",
    description:
      "⛔ DESTRUCTIVE — Delete an event function (position/role). This ALSO removes ALL assignments linked to this function — " +
      "assigned staff will lose their assignments. This action CANNOT be undone. ALWAYS confirm with the user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Event function ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // FUNCTIONS (templates/roles)
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_functions",
    description:
      "List function templates (role definitions like 'Promoter', 'Hostess', 'Security'). " +
      "These are the templates used when creating event functions. Use the function ID from here as function_id in create_event_function.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },
  {
    name: "create_function",
    description:
      "Create a new function template (role definition like 'Elektromonteur', 'Security', 'Driver'). " +
      "Functions are the role templates used when creating event functions. " +
      "Required fields: name. Optional: description, color.",
    inputSchema: {
      type: "object" as const,
      properties: {
        data: {
          type: "object",
          description: 'Function data. Example: {"name":"Elektromonteur","description":"Certified electrician for installation work"}.',
        },
      },
      required: ["data"],
    },
  },
  {
    name: "update_function",
    description:
      "Update an existing function template (role definition). Partial update — send only changed fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Function ID." },
        data: { type: "object", description: "Fields to update (e.g. name, description)." },
      },
      required: ["id", "data"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // LOCATIONS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_locations",
    description: "List all locations/venues where events can take place.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },
  {
    name: "create_location",
    description:
      "Create a new location via the collections API (POST /collections/7/values). " +
      "REQUIRED: name and country_id. " +
      "Use list_collection_values to find country IDs (collection for countries) and county/region IDs. " +
      "Fields: name, code, line_1, line_2, zip, city, country_id, county_id. " +
      'Example: {"name":"Main Arena","city":"Zürich","zip":"8001","country_id":<your_country_id>}.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: {
          type: "object",
          description: "Location fields: name, code, line_1, line_2, zip, city, country_id, county_id",
        },
      },
      required: ["data"],
    },
  },
  {
    name: "update_location",
    description:
      "Update a location via the collections API (PUT /collections/7/value/{id}). " +
      "REQUIRED: country_id must always be included. " +
      "Use list_collection_values to look up country and county/region IDs for your tenant. " +
      "Fields: name, code, line_1, line_2, zip, city, country_id, county_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Location ID" },
        data: {
          type: "object",
          description: "Location fields: name, code, line_1, line_2, zip, city, country_id, county_id",
        },
      },
      required: ["id", "data"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // CLIENTS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_clients",
    description:
      "List all clients (companies/organizations) in StaffCloud. " +
      "Clients are the companies that hire staff through the platform. " +
      "Use fields parameter to select specific columns. Supports filtering and sorting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: {
          type: "string",
          description: 'Comma-separated fields. Example: "id,company,city".',
        },
        sort: { type: "string", description: 'Sort fields. Example: "company".' },
        filter: { type: "string", description: "Additional filters." },
      },
    },
  },
  {
    name: "get_client",
    description: "Get a single client by ID with all or selected fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Client ID." },
        fields: { type: "string", description: "Comma-separated fields." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_client",
    description:
      "Create a new client (company). Required fields typically include company name. " +
      'Example data: {"company":"ACME Corp","address_first":"Bahnhofstrasse 1","zip":"8001","city":"Zürich","country":12}.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Client data with company name and address fields." },
      },
      required: ["data"],
    },
  },
  {
    name: "update_client",
    description: "Update an existing client. Partial update — send only changed fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Client ID." },
        data: { type: "object", description: "Fields to update." },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_client",
    description:
      "⛔ DESTRUCTIVE — Delete a client (company) by ID. This may affect linked projects, contacts, and events. " +
      "This action CANNOT be undone. ALWAYS confirm with the user before executing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Client ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // CONTACTS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_contacts",
    description:
      "List all contacts (people associated with clients). " +
      "Contacts are client-side representatives — use list_employees for staff. " +
      "Contact fields use dynamic_field_* naming. Use list_attributes to decode field labels.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: {
          type: "string",
          description: 'Comma-separated fields. Example: "id,client_id,dynamic_field_17,dynamic_field_18".',
        },
        sort: { type: "string", description: "Sort fields." },
        filter: { type: "string", description: "Additional filters." },
      },
    },
  },
  {
    name: "get_contact",
    description: "Get a single contact by ID. Contact fields use dynamic_field_* IDs — use get_field_definitions to decode labels.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Contact ID." },
        fields: { type: "string", description: "Comma-separated fields." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_contact",
    description:
      "Create a contact linked to a client. Requires client_id plus tenant-specific dynamic attrs as " +
      "'_dyn_attr_<id>' (discover required fields from validation error on first POST attempt). " +
      'Common: _dyn_attr_17=firstname, _dyn_attr_18=lastname, _dyn_attr_19=email, _dyn_attr_20=phone. ' +
      "Use get_field_definitions with resource=contact to decode field IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Contact data including client_id and dynamic fields." },
      },
      required: ["data"],
    },
  },
  {
    name: "update_contact",
    description: "Update an existing contact. Partial update — send only changed fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Contact ID." },
        data: { type: "object", description: "Fields to update." },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_contact",
    description:
      "⛔ DESTRUCTIVE — Delete a contact by ID. This action CANNOT be undone. ALWAYS confirm with the user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Contact ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // BULK IMPORT
  // ════════════════════════════════════════════════════════════════
  {
    name: "bulk_create_projects",
    description:
      "⚠️ BULK WRITE — Bulk create multiple StaffCloud projects from structured data (e.g. parsed from Excel). " +
      "ALWAYS use dry_run=true first to preview what will be created, and confirm results with the user before running without dry_run. " +
      "Part of the 3-step bulk import flow: 1) bulk_create_projects → 2) bulk_create_events → 3) bulk_create_event_functions. " +
      "Each project needs at minimum a planner_id (use default_planner_id to set for all). " +
      "Returns an id_mapping (name → ID) for chaining into bulk_create_events. " +
      "Continues on error — all results (success + failures) are reported.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projects: {
          type: "array",
          description:
            "Array of project objects to create. Each needs at least {name, planner_id}. " +
            "Additional fields: client_id, description, start_date, end_date.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Project name" },
              planner_id: { type: "number", description: "Planner ID (or use default_planner_id)" },
              client_id: { type: "number", description: "Client ID (or use default_client_id)" },
              description: { type: "string", description: "Project description" },
            },
          },
        },
        default_planner_id: {
          type: "number",
          description: "Default planner_id applied to all projects that don't specify one. Use list_planners to find.",
        },
        default_client_id: {
          type: "number",
          description: "Default client_id applied to all projects that don't specify one.",
        },
        dry_run: {
          type: "boolean",
          description: "Preview only — don't create anything. Shows what would be created.",
        },
      },
      required: ["projects"],
    },
  },
  {
    name: "bulk_create_events",
    description:
      "⚠️ BULK WRITE — Bulk create multiple events (shifts) with optional automatic break calculation and auto-creation of event functions. " +
      "ALWAYS use dry_run=true first to preview, and confirm with the user before creating. " +
      "IMPORTANT: Events without event functions are INVISIBLE in StaffCloud's staffing UI. " +
      "ALWAYS set default_function_id (use list_functions to find IDs) to auto-create event functions with each event. " +
      "Only omit default_function_id if you will IMMEDIATELY call bulk_create_event_functions afterwards. " +
      "When STAFFCLOUD_BREAK_RULES=swiss, applies ArG Art. 15 break rules: >5.5h → 15min, >7h → 30min, >9h → 60min. " +
      "Each event needs: project_id, name, date, start_time, and either end_time or duration_hours. " +
      "IMPORTANT: planner_id is REQUIRED by the API. Either set default_planner_id or include planner_id on each event. " +
      "If the user hasn't specified a planner, call list_planners first and ask them which planner to use. " +
      "Events are activated by default (status=Active). " +
      "For >100 events, call in batches of ~80-100 and show user progress between calls. " +
      "Use dry_run=true to preview with break calculations without creating anything.",
    inputSchema: {
      type: "object" as const,
      properties: {
        events: {
          type: "array",
          description:
            "Array of event objects. Each needs: project_id, planner_id, name, date (YYYY-MM-DD), start_time (HH:MM), " +
            "and either end_time (HH:MM) or duration_hours. planner_id can be set per-event or via default_planner_id.",
          items: {
            type: "object",
            properties: {
              project_id: { type: "number", description: "Project ID (from bulk_create_projects id_mapping)" },
              name: { type: "string", description: "Event/shift name" },
              date: { type: "string", description: 'Date YYYY-MM-DD, e.g. "2026-06-01"' },
              start_time: { type: "string", description: 'Start time HH:MM, e.g. "08:00"' },
              end_time: { type: "string", description: 'End time HH:MM. For overnight: "02:00" after "22:00"' },
              duration_hours: { type: "number", description: "Alternative to end_time: duration in hours" },
              location_id: { type: "number", description: "Location ID (or use default_location_id)" },
              planner_id: { type: "number", description: "Planner ID (or use default_planner_id). Required by API." },
              description: { type: "string", description: "Shift description" },
              break_start: { type: "string", description: "Override break start HH:MM" },
              break_end: { type: "string", description: "Override break end HH:MM" },
              skip_break: { type: "boolean", description: "Skip automatic break calculation" },
              activate: { type: "boolean", description: "Activate this event (overrides default_activate)" },
              function_id: { type: "number", description: "Function/role ID for this event (overrides default_function_id)" },
              quantity: { type: "number", description: "Number of positions for this event's function (overrides default_quantity)" },
            },
          },
        },
        default_location_id: {
          type: "number",
          description: "Default location_id for events that don't specify one. Use list_locations to find.",
        },
        default_planner_id: {
          type: "number",
          description: "Default planner_id for events that don't specify one. Required by API for event creation.",
        },
        default_activate: {
          type: "boolean",
          description: "Activate events after creation (default: true). Set false to keep as Draft.",
        },
        default_function_id: {
          type: "number",
          description:
            "RECOMMENDED — Function/role ID to auto-create an event function for each event. " +
            "Use list_functions to find IDs (e.g. 1=Host/ess, 3=Promoter). " +
            "When set, each event gets a fully usable event function — no separate bulk_create_event_functions call needed. " +
            "Events WITHOUT event functions are invisible in StaffCloud's staffing UI.",
        },
        default_quantity: {
          type: "number",
          description: "Default number of positions per event function (default: 1). Only used when default_function_id is set.",
        },
        dry_run: {
          type: "boolean",
          description: "Preview only — shows events with calculated breaks, no API calls.",
        },
      },
      required: ["events"],
    },
  },
  {
    name: "bulk_create_event_functions",
    description:
      "⚠️ BULK WRITE — Bulk create event functions (roles/positions within events), one by one. " +
      "ALWAYS use dry_run=true first to preview, and confirm with the user before creating. " +
      "Part of the 3-step bulk import flow: 1) bulk_create_projects → 2) bulk_create_events → 3) bulk_create_event_functions. " +
      "This is the slowest step (~1.5s per item). For large imports (>30 items), call in batches of 20-30 " +
      "and show user progress between calls. Each item needs: event_id, function_id, planner_id. " +
      "Use list_functions to find function_ids (e.g. 1=Host/ess, 3=Promoter). " +
      "Continues on error — all results reported. Use dry_run=true for preview with time estimate.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_functions: {
          type: "array",
          description:
            "Array of event function objects. Each needs: event_id, function_id, planner_id.",
          items: {
            type: "object",
            properties: {
              event_id: { type: "number", description: "Event ID (from bulk_create_events id_mapping)" },
              function_id: { type: "number", description: "Function/role ID (use list_functions to find)" },
              planner_id: { type: "number", description: "Planner ID (or use default_planner_id)" },
              quantity: { type: "number", description: "Number of positions needed (default: 1)" },
              start: { type: "string", description: "Override start time (YYYY-MM-DD HH:MM:SS)" },
              end: { type: "string", description: "Override end time (YYYY-MM-DD HH:MM:SS)" },
              break_start: { type: "string", description: "Override break start" },
              break_end: { type: "string", description: "Override break end" },
              description: { type: "string", description: "Position description" },
            },
          },
        },
        default_planner_id: {
          type: "number",
          description: "Default planner_id for items that don't specify one.",
        },
        default_function_id: {
          type: "number",
          description: "Default function_id for items that don't specify one.",
        },
        dry_run: {
          type: "boolean",
          description: "Preview only — shows items with time estimate, no API calls.",
        },
      },
      required: ["event_functions"],
    },
  },
  {
    name: "bulk_update_event_functions",
    description:
      "⚠️ BULK MODIFY — Bulk update multiple event functions (roles/positions within events), one by one. " +
      "ALWAYS use dry_run=true first to preview changes, and confirm with the user before executing. " +
      "Each item must include 'id' (the event function ID) plus any fields to update: " +
      "quantity, start, end, break_start, break_end, description, function_id, etc. " +
      "Continues on error — all results reported.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_functions: {
          type: "array",
          description:
            "Array of event function update objects. Each MUST have 'id' plus fields to change.",
          items: {
            type: "object",
            properties: {
              id: { type: "number", description: "Event function ID to update (required)" },
              quantity: { type: "number", description: "New number of positions" },
              start: { type: "string", description: "New start time (YYYY-MM-DD HH:MM:SS)" },
              end: { type: "string", description: "New end time (YYYY-MM-DD HH:MM:SS)" },
              break_start: { type: "string", description: "New break start" },
              break_end: { type: "string", description: "New break end" },
              description: { type: "string", description: "New description" },
            },
            required: ["id"],
          },
        },
        dry_run: {
          type: "boolean",
          description: "Preview only — shows items to update, no API calls.",
        },
      },
      required: ["event_functions"],
    },
  },
  {
    name: "bulk_update_events",
    description:
      "⚠️ BULK MODIFY — Bulk update multiple events in a single call. " +
      "ALWAYS use dry_run=true first to preview changes, and confirm with the user before executing. " +
      "Each item must include 'id' (event ID) plus any fields to update: " +
      "name, start, end, location_id, status, break_start, break_end, dynamic fields, etc. " +
      "Use status=5 to bulk-abort events. Continues on error — all results reported.",
    inputSchema: {
      type: "object" as const,
      properties: {
        events: {
          type: "array",
          description:
            "Array of event update objects. Each MUST have 'id' plus fields to change.",
          items: {
            type: "object",
            properties: {
              id: { type: "number", description: "Event ID to update (required)" },
              name: { type: "string", description: "New event name" },
              start: { type: "string", description: "New start (YYYY-MM-DD HH:MM:SS)" },
              end: { type: "string", description: "New end (YYYY-MM-DD HH:MM:SS)" },
              location_id: { type: "number", description: "New location ID" },
              status: { type: "number", description: "New status (1=Draft, 2=Active, 3=Archived, 5=Aborted)" },
              break_start: { type: "string", description: "New break start" },
              break_end: { type: "string", description: "New break end" },
            },
            required: ["id"],
          },
        },
        dry_run: {
          type: "boolean",
          description: "Preview only — shows items to update, no API calls.",
        },
      },
      required: ["events"],
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
  const { client, descriptionField, defaultPlannerId, phoneFormat, breakRules } = ctx;

  switch (name) {
    // ── Event Functions ──
    case "list_event_functions": {
      validate(zListParams, args, name);
      return formatResult(await client.listEventFunctions(buildParams(args)));
    }
    case "get_event_function": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getEventFunction(v.id, buildParams(v)));
    }
    case "create_event_function": {
      const v = validate(z.object({ data: zData }), args, name);
      if (defaultPlannerId && !v.data.planner_id) {
        v.data.planner_id = defaultPlannerId;
      }
      return formatResult(await client.createEventFunction(v.data));
    }
    case "update_event_function": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateEventFunction(v.id, v.data));
    }
    case "delete_event_function": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteEventFunction(v.id));
    }

    // ── Functions (templates) ──
    case "list_functions":
      return formatResult(await client.listFunctions(buildParams(args)));
    case "create_function": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createFunction(v.data));
    }
    case "update_function": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateFunction(v.id, v.data));
    }

    // ── Locations ──
    case "list_locations":
      return formatResult(await client.listLocations(buildParams(args)));
    case "create_location": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createCollectionValue(7, v.data));
    }
    case "update_location": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateCollectionValue(7, v.id, v.data));
    }

    // ── Clients ──
    case "list_clients": {
      validate(zListParams, args, name);
      return formatResult(await client.listClients(buildParams(args)));
    }
    case "get_client": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getClient(v.id, buildParams(v)));
    }
    case "create_client": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createClient(v.data));
    }
    case "update_client": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateClient(v.id, v.data));
    }
    case "delete_client": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteClient(v.id));
    }

    // ── Contacts ──
    case "list_contacts": {
      validate(zListParams, args, name);
      return formatResult(await client.listContacts(buildParams(args)));
    }
    case "get_contact": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getContact(v.id, buildParams(v)));
    }
    case "create_contact": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createContact(autoFormatPhones(v.data, phoneFormat)));
    }
    case "update_contact": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateContact(v.id, autoFormatPhones(v.data, phoneFormat)));
    }
    case "delete_contact": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteContact(v.id));
    }

    // ── Bulk Import ──
    case "bulk_create_projects": {
      const v = validate(
        z.object({
          projects: z.array(z.record(z.string(), z.unknown())),
          default_planner_id: z.number().int().positive().optional(),
          default_client_id: z.number().int().positive().optional(),
          dry_run: z.boolean().optional(),
        }),
        args,
        name
      );
      if (v.projects.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "projects array is empty");
      }
      if (defaultPlannerId && !v.default_planner_id) {
        v.default_planner_id = defaultPlannerId;
      }
      return formatResult(await bulkCreateProjects(client, v));
    }
    case "bulk_create_events": {
      const v = validate(
        z.object({
          events: z.array(
            z.object({
              project_id: zId,
              name: z.string(),
              date: z.string(),
              start_time: z.string(),
              end_time: z.string().optional(),
              duration_hours: z.number().positive().optional(),
              location_id: z.number().int().positive().optional(),
              planner_id: z.number().int().positive().optional(),
              description: z.string().optional(),
              break_start: z.string().optional(),
              break_end: z.string().optional(),
              skip_break: z.boolean().optional(),
              activate: z.boolean().optional(),
              function_id: z.number().int().positive().optional(),
              quantity: z.number().int().positive().optional(),
            }).passthrough()
          ),
          default_location_id: z.number().int().positive().optional(),
          default_planner_id: z.number().int().positive().optional(),
          default_activate: z.boolean().optional(),
          default_function_id: z.number().int().positive().optional(),
          default_quantity: z.number().int().positive().optional(),
          dry_run: z.boolean().optional(),
        }),
        args,
        name
      );
      if (v.events.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "events array is empty");
      }
      // Fall back to env default planner
      if (defaultPlannerId && !v.default_planner_id) {
        v.default_planner_id = defaultPlannerId;
      }
      // Validate each event has planner_id (from default or per-event)
      if (!v.default_planner_id) {
        for (let i = 0; i < v.events.length; i++) {
          if (!v.events[i]!.planner_id) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `planner_id is required by the API. Set default_planner_id or include planner_id on event at index ${i} ("${v.events[i]!.name}"). Use list_planners to find available planners and ask the user which one to use.`
            );
          }
        }
      }
      // Validate each event has end_time or duration_hours
      for (let i = 0; i < v.events.length; i++) {
        const e = v.events[i]!;
        if (!e.end_time && !e.duration_hours) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Event at index ${i} ("${e.name}") needs either 'end_time' or 'duration_hours'`
          );
        }
      }
      return formatResult(await bulkCreateEvents(client, {
        ...v,
        descriptionField,
        breakRules,
      }));
    }
    case "bulk_create_event_functions": {
      const v = validate(
        z.object({
          event_functions: z.array(
            z.object({
              event_id: zId,
              function_id: z.number().int().positive().optional(),
              planner_id: z.number().int().positive().optional(),
              quantity: z.number().int().positive().optional(),
              start: z.string().optional(),
              end: z.string().optional(),
              break_start: z.string().optional(),
              break_end: z.string().optional(),
              description: z.string().optional(),
            }).passthrough()
          ),
          default_planner_id: z.number().int().positive().optional(),
          default_function_id: z.number().int().positive().optional(),
          dry_run: z.boolean().optional(),
        }),
        args,
        name
      );
      if (v.event_functions.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "event_functions array is empty");
      }
      if (defaultPlannerId && !v.default_planner_id) {
        v.default_planner_id = defaultPlannerId;
      }
      return formatResult(await bulkCreateEventFunctions(client, v));
    }
    case "bulk_update_event_functions": {
      const v = validate(
        z.object({
          event_functions: z.array(
            z.object({
              id: zId,
            }).passthrough()
          ),
          dry_run: z.boolean().optional(),
        }),
        args,
        name
      );
      if (v.event_functions.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "event_functions array is empty");
      }
      return formatResult(await bulkUpdateEventFunctions(client, v));
    }
    case "bulk_update_events": {
      const v = validate(
        z.object({
          events: z.array(
            z.object({
              id: zId,
            }).passthrough()
          ),
          dry_run: z.boolean().optional(),
        }),
        args,
        name
      );
      if (v.events.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "events array is empty");
      }
      return formatResult(await bulkUpdateEvents(client, v));
    }

    default:
      return null;
  }
}
