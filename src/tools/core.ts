import type { ToolDefinition, ToolContext } from "./types.js";
import { validate, buildParams, formatResult, autoFormatPhones, filterEmployeeFields, resolveQualifications, zId, zFields, zSort, zFilter, zData, zListParams } from "./shared.js";
import { z } from "zod";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  getStaffSchedule,
  findAvailableStaff,
  getEmployeeProfile,
  createShift,
  resolveFieldValue,
  formatSwissPhone,
  getStaffingGaps,
  findReplacement,
  updateProjectLocation,
  getPlannedHours,
} from "../smart-tools.js";

export const tools: ToolDefinition[] = [
  // ════════════════════════════════════════════════════════════════
  // EMPLOYEES
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_employees",
    description:
      "List employees from StaffCloud with optional filtering, field selection, and sorting. " +
      "Use this to find employees by status, location, update date, or any field. " +
      "Filter operators: =~ (case-insensitive like), = (equals), =- (not equals), =< (less than), " +
      "=> (greater than), =null, =-null, comma-separated for OR. " +
      "Employee status values: 0=Nicht abgeschlossen, 1=Bewerber, 2=Vorläufiger Kandidat, " +
      "3=Kandidat, 4=Aktiv, 5=Inaktiv, 6=Gelöscht. " +
      "Example: status=4 for active, fields=id,firstname,lastname,city, sort=-updated_at. " +
      "Tip: always use 'fields' to reduce payload — full employee records have 136 fields (~8MB for all). " +
      "Supports embed=employeeAvailability to include availability data inline.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description:
            'Filter by status. Examples: "4" (active only), "4,5" (active+inactive), "=>3" (candidate and above).',
        },
        updated_since: {
          type: "string",
          description:
            'Only employees updated after this datetime. Format: "YYYY-MM-DD HH:MM:SS" (CET/CEST). Great for incremental sync.',
        },
        fields: {
          type: "string",
          description:
            'Comma-separated field names. Example: "id,firstname,lastname,status,city,qualifications,updated_at". Dramatically reduces response size.',
        },
        sort: {
          type: "string",
          description:
            'Sort with +/- prefix. Examples: "-updated_at" (newest first), "lastname,firstname" (alphabetical).',
        },
        filter: {
          type: "string",
          description:
            'Additional filters as "field=operator value" joined by &. Examples: "city=~zürich", "mobile=-null&gender=Weiblich".',
        },
        limit: {
          type: "number",
          description: "Max results to return (client-side limit, applied after fetch).",
        },
      },
    },
  },
  {
    name: "get_employee",
    description:
      "Get a single employee by ID. Returns all 136 fields unless 'fields' is specified. " +
      "Use this to view complete employee details including dynamic custom fields (dynamic_field_*). " +
      "Tip: use get_employee_profile smart tool instead for a human-readable view with labeled custom fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Employee ID (integer)." },
        fields: {
          type: "string",
          description: 'Comma-separated fields. Example: "id,firstname,lastname,email,qualifications".',
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_employee",
    description:
      "Create a new employee in StaffCloud. Required fields vary by tenant — always include: " +
      "firstname, lastname, email, mobile, birthday (YYYY-MM-DD), gender (collection value ID, e.g. 260=Female, 261=Male), " +
      "wage_profile_id (use list_wage_profiles). Some tenants require additional '_dyn_attr_<id>' fields — " +
      "POST with minimal data first, the validation error will list required fields. " +
      "FIELD TYPE FORMATS: Dropdown fields (gender, country, canton, language): use integer collection value ID. " +
      "Multi-select (qualifications): use array of IDs, e.g. [1,2,3]. " +
      "Phone: E.164 format (+41 79 123 45 67). Date: YYYY-MM-DD.",
    inputSchema: {
      type: "object" as const,
      properties: {
        data: {
          type: "object",
          description:
            'Employee data. Example: {"firstname":"Max","lastname":"Muster","email":"max@test.com","mobile":"+41791234567","birthday":"1995-01-15","gender":261,"wage_profile_id":1,"qualifications":[1,2]}.',
        },
      },
      required: ["data"],
    },
  },
  {
    name: "update_employee",
    description:
      "⚠️ MODIFIES DATA — Update an existing employee. Confirm with the user before changing critical fields " +
      "(status, qualifications, wage_profile_id). Send only the fields you want to change (partial update via PUT). " +
      "FIELD TYPE FORMATS — CRITICAL: " +
      "Text/email/phone/URL: plain string. " +
      "Date: \"YYYY-MM-DD\". " +
      "Boolean/checkbox: true or 1. " +
      "Dropdown (single-select, e.g. gender, country, canton, communication_language, dynamic_field_45/marital, dynamic_field_47/work_permit, dynamic_field_65/team): " +
      "MUST use integer collection value ID, NOT the display name. E.g. gender=261 for Male, NOT \"Male\". " +
      "Use list_collection_values to look up IDs. Key collections: 9=Gender (260=Female,261=Male), 8=Countries (223=Switzerland), " +
      "11=Language (2=Deutsch,1=English,3=Français), 19=Canton (335=GR,351=ZH,331=BE), 13=Marital (264=Single,265=Married). " +
      "Multi-select (qualifications, languages): use array of integer IDs, e.g. qualifications=[1,2,3,4,5] or {\"1\":true,\"2\":true}. " +
      "To clear a dropdown: set to 0. To clear a multi-select: set to [].",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Employee ID to update." },
        data: {
          type: "object",
          description:
            'Fields to update. Examples: {"city":"Zürich"}, {"gender":261}, {"qualifications":[1,2,3]}, {"dynamic_field_48":[314,286]}.',
        },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_employee",
    description:
      "⛔ DESTRUCTIVE — Permanently delete an employee by ID. This action CANNOT be undone and removes ALL associated data " +
      "(assignments, work times, ratings, files). ALWAYS confirm with the user before executing. " +
      "SAFER ALTERNATIVE: Use set_employee_state with state=5 (Inaktiv) to deactivate, or state=6 (Gelöscht) for soft-delete.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Employee ID to delete." },
      },
      required: ["id"],
    },
  },
  {
    name: "set_employee_state",
    description:
      "⚠️ STATE CHANGE — Change an employee's lifecycle status. Confirm with the user before changing state. " +
      "States: 1=Bewerber (applicant), 2=Vorläufiger Kandidat (preliminary candidate), " +
      "3=Kandidat (candidate), 4=Aktiv (active), 5=Inaktiv (inactive), 6=Gelöscht (deleted/soft-delete). " +
      "Setting state=5 or state=6 will remove the employee from active scheduling. " +
      "Example: set state=4 to activate a candidate, state=5 to deactivate. " +
      "This is the SAFER alternative to delete_employee.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Employee ID." },
        state: { type: "number", description: "New state (1-6). See description for values." },
      },
      required: ["id", "state"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // PROJECTS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_projects",
    description:
      "List all projects. Projects group events (shifts) under a client and planner. " +
      "Use this to see all active work, then drill into events for scheduling details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: 'Comma-separated fields. Example: "id,name,client_id,planner_id".' },
        sort: { type: "string", description: "Sort fields." },
        filter: { type: "string", description: "Additional filters." },
      },
    },
  },
  {
    name: "get_project",
    description: "Get a single project by ID with all details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Project ID." },
        fields: { type: "string", description: "Comma-separated fields." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_project",
    description:
      "Create a new project. Requires planner_id (use list_planners) and typically client_id and name. " +
      'Example: {"planner_id":1,"client_id":1,"name":"Summer Festival 2026"}.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Project data with planner_id, client_id, name." },
      },
      required: ["data"],
    },
  },
  {
    name: "update_project",
    description:
      "⚠️ MODIFIES DATA — Update an existing project. Partial update — send only changed fields. " +
      "Changing client_id or planner_id affects all events under this project. Confirm with the user first. " +
      "IMPORTANT: Projects do NOT have a location_id — location is set on events, not projects. " +
      "To change the location for all events in a project, use update_project_location instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Project ID." },
        data: { type: "object", description: "Fields to update." },
      },
      required: ["id", "data"],
    },
  },

  {
    name: "list_planners",
    description:
      "List all planners (admin/manager users). Planners are needed as planner_id when creating projects, events, and shifts. " +
      "If you don't know which planner to use, call this first and ask the user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
      },
    },
  },

  // ════════════════════════════════════════════════════════════════
  // EVENTS (Shifts/Gigs)
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_events",
    description:
      "List all events (shifts/gigs within projects). Events represent actual work shifts with start/end times. " +
      "Use this to find shifts on a date, or use get_staff_schedule smart tool for a complete schedule view. " +
      'Filter by date: filter="start=>2026-04-01&end=<2026-04-02" (use start+end, NOT start twice). ' +
      "Event status: 1=Draft, 2=Active, 3=Archived, 5=Aborted. " +
      "IMPORTANT: Always filter by status=2 for active events — without this filter you get drafts and archived events too.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: 'Comma-separated fields. Example: "id,name,project_id,start,end".' },
        sort: { type: "string", description: 'Sort fields. Example: "start" for chronological.' },
        filter: { type: "string", description: 'Filters. Example: "project_id=123".' },
      },
    },
  },
  {
    name: "get_event",
    description: "Get a single event (shift) by ID with all details including location and timing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Event ID." },
        fields: { type: "string", description: "Comma-separated fields." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_event",
    description:
      "Create a new event (shift) within a project. Requires project_id, planner_id, location_id, name, start, and end times. " +
      'Example: {"project_id":1,"planner_id":1,"location_id":1,"name":"Morning Shift","start":"2026-04-01 08:00:00","end":"2026-04-01 18:00:00"}.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Event data with project_id, name, start, end." },
      },
      required: ["data"],
    },
  },
  {
    name: "update_event",
    description:
      "⚠️ MODIFIES DATA — Update an existing event (shift). Changing start/end times affects all assigned staff. " +
      "Confirm with the user before changing times on events that already have assignments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Event ID." },
        data: { type: "object", description: "Fields to update (e.g. start, end, name)." },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_event",
    description:
      "⛔ DESTRUCTIVE — Delete an event (shift) by ID. This PERMANENTLY removes the event AND all associated " +
      "event functions and assignments. Staff who were assigned will lose their assignment records. " +
      "This action CANNOT be undone. ALWAYS confirm with the user before executing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Event ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // ASSIGNMENTS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_assignments",
    description:
      "List assignments (employee-to-event links) with optional filters. " +
      "An assignment connects an employee to an event with a status. " +
      "Status values: 1=invited, 2=ignored, 3=applied, 4=applied_maybe, " +
      "5=assigned_provisional, 6=assigned, 7=confirmed, 8=denied. " +
      "For a complete schedule view, use get_staff_schedule instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: 'Example: "id,employee_id,event_id,status".' },
        sort: { type: "string", description: "Sort fields." },
        status: { type: "string", description: 'Filter by status. Example: "6,7" for assigned+confirmed.' },
        filter: { type: "string", description: 'Filters. Example: "event_id=123" or "employee_id=456".' },
      },
    },
  },
  {
    name: "get_assignment",
    description: "Get a single assignment by ID, showing the employee-event link and current status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Assignment ID." },
        fields: { type: "string", description: "Comma-separated fields." },
      },
      required: ["id"],
    },
  },
  {
    name: "update_assignment_status",
    description:
      "⚠️ STATUS CHANGE — Change the status of a single assignment. Confirm with the user before executing, " +
      "especially for status=8 (denied) which removes staff from a shift. " +
      "Use get_assignment_status_map first to check valid transitions. " +
      "Status values: 1=invited, 2=ignored, 3=applied, 5=assigned_provisional, 6=assigned, 7=confirmed, 8=denied.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Assignment ID." },
        status: { type: "number", description: "New status value (1-8)." },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "bulk_update_assignment_status",
    description:
      "⛔ EXTREMELY DANGEROUS — Change status for ALL assignments globally. There is NO scope filter — " +
      "this affects EVERY assignment in the ENTIRE StaffCloud instance. This can disrupt all ongoing scheduling. " +
      "You MUST pass confirm=\"all\" to execute. ALWAYS ask the user for explicit confirmation and explain the impact. " +
      "For changing a single assignment's status, use update_assignment_status instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "number", description: "New status value (1-8) to apply to ALL assignments." },
        remarks: { type: "string", description: "Optional remarks/reason for the status change." },
        confirm: { type: "string", description: 'Must be exactly "all" to confirm you want to affect ALL assignments.' },
      },
      required: ["status", "confirm"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // SMART COMPOSITE TOOLS
  // ════════════════════════════════════════════════════════════════
  {
    name: "get_staff_schedule",
    description:
      "SMART TOOL — Get a complete staff schedule in ONE call with all details resolved. " +
      "Answers: 'Who works tomorrow?', 'Show me the team for Event X', 'What are Reon's shifts?'. " +
      "Resolves project names, role/function names, and break times automatically. " +
      "Use employee_id for employee-centric view, date for daily view, or event_id for event team view.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: 'Date to get schedule for. Format: "YYYY-MM-DD". Example: "2026-04-01".',
        },
        event_id: {
          type: "number",
          description: "Specific event ID to get the team for.",
        },
        employee_id: {
          type: "number",
          description: "Employee ID to get all shifts for. Returns employee-centric view with dates, projects, roles, and breaks.",
        },
        status: {
          type: "string",
          description:
            'Assignment status filter. Default: "5,6,7" (assigned+confirmed). Use "1,2,3,4,5,6,7,8" for all.',
        },
      },
    },
  },
  {
    name: "find_available_staff",
    description:
      "SMART TOOL — Find employees available for a date range in ONE call. " +
      "Answers: 'Who is free next Friday?', 'Find available promoters in Zürich'. " +
      "Checks active employees against busy-dates and existing assignments, " +
      "returning three lists: available, busy (on leave), and already_assigned.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date_start: {
          type: "string",
          description: 'Start of date range. Format: "YYYY-MM-DD".',
        },
        date_end: {
          type: "string",
          description: 'End of date range. Format: "YYYY-MM-DD". Same as date_start for a single day.',
        },
        qualification: {
          type: "string",
          description: 'Filter by qualification name (partial match). Example: "Promotion", "Hosting".',
        },
        city: {
          type: "string",
          description: 'Filter by city (case-insensitive). Example: "Zürich", "Basel".',
        },
      },
      required: ["date_start", "date_end"],
    },
  },
  {
    name: "get_employee_profile",
    description:
      "SMART TOOL — Get a human-readable employee profile in ONE call. " +
      "Answers: 'Tell me about employee X', 'What qualifications does Maria have?'. " +
      "Resolves dynamic_field_* IDs to labels (e.g. dynamic_field_49 → 'Kanton'), " +
      "calculates age, and formats the profile. Search by ID or name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "number",
          description: "Employee ID for direct lookup.",
        },
        name: {
          type: "string",
          description: 'Search by name (first or last). Example: "Maria", "Müller".',
        },
      },
    },
  },
  {
    name: "create_shift",
    description:
      "SMART TOOL — Create a shift (event) with automatic Swiss labor law break calculation. " +
      "Answers: 'Create a shift tomorrow at 07:00 for 9 hours', 'Add an evening shift next Friday'. " +
      "Automatically applies Swiss Arbeitsgesetz (ArG Art. 15) break rules: " +
      ">5.5h → 15min, >7h → 30min, >9h → 60min break. Break is centered at the shift midpoint. " +
      "Duration = total time at workplace (break inclusive): 9h shift = 8h work + 1h break. " +
      "Creates the event, activates it (status=Active), and optionally creates an event function (role). " +
      "User can override breaks with break_start/break_end or skip them with skip_break=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "number",
          description: "Project ID this shift belongs to. Use list_projects to find.",
        },
        name: {
          type: "string",
          description: 'Shift name. Example: "Morning Shift", "Promotion Zürich HB".',
        },
        date: {
          type: "string",
          description: 'Shift date. Format: "YYYY-MM-DD". Example: "2026-04-01".',
        },
        start_time: {
          type: "string",
          description: 'Start time in 24h format "HH:MM". Example: "07:00", "14:30".',
        },
        duration_hours: {
          type: "number",
          description:
            "Shift duration in hours (total time at workplace, break inclusive). Example: 9 for a 9-hour shift. Use this OR end_time.",
        },
        end_time: {
          type: "string",
          description: 'End time in 24h format "HH:MM". Alternative to duration_hours. For overnight: "02:00" after "22:00" is next day.',
        },
        location_id: {
          type: "number",
          description: "Location ID. Use list_locations to find.",
        },
        planner_id: {
          type: "number",
          description: "Planner ID (required). Use list_planners to find.",
        },
        break_start: {
          type: "string",
          description: 'Override break start time "HH:MM". Overrides automatic Swiss law calculation.',
        },
        break_end: {
          type: "string",
          description: 'Override break end time "HH:MM". Must be used with break_start.',
        },
        skip_break: {
          type: "boolean",
          description: "Set true to force no break even if Swiss law would require one.",
        },
        function_id: {
          type: "number",
          description: "Function/role ID to create within the event. Use list_functions to find (e.g. 1=Host/ess, 3=Promoter).",
        },
        quantity: {
          type: "number",
          description: "Number of positions needed for the function (default: 1).",
        },
        description: {
          type: "string",
          description: "Shift description text.",
        },
        activate: {
          type: "boolean",
          description: "Activate the event after creation (default: true). Set false to keep as Draft.",
        },
      },
      required: ["project_id", "name", "date", "start_time", "location_id", "planner_id"],
    },
  },
  {
    name: "get_staffing_gaps",
    description:
      "SMART TOOL — Find understaffed events in ONE call. " +
      "Answers: 'Which shifts need more people?', 'Show me staffing gaps this week'. " +
      "Compares required positions (event function quantity) against actual assignments (status 5/6/7). " +
      "Returns events with unfilled positions, fill percentages, and totals. " +
      "Sorted by event start (soonest first), then by gap size.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: 'Single date to check. Format: "YYYY-MM-DD". Use this OR date_start+date_end.',
        },
        date_start: {
          type: "string",
          description: 'Start of date range. Format: "YYYY-MM-DD".',
        },
        date_end: {
          type: "string",
          description: 'End of date range. Format: "YYYY-MM-DD".',
        },
      },
    },
  },
  {
    name: "find_replacement",
    description:
      "SMART TOOL — Emergency tool for no-shows. Find replacement candidates for an event in ONE call. " +
      "Answers: 'Who can step in for Event X?', 'Find a replacement for tomorrow's shift'. " +
      "Checks active employees against busy dates and existing assignments for the event date, " +
      "ranks by qualification match (100pts), rating (0-10pts), and same city (5pts). " +
      "Returns top 20 candidates with mobile + email for quick outreach.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "number",
          description: "Event ID to find replacements for (required).",
        },
        function_id: {
          type: "number",
          description: "Optional function/role ID to filter candidates by qualification.",
        },
        city: {
          type: "string",
          description: 'Optional city preference. Candidates in this city get +5 points. Example: "Zürich".',
        },
        qualification: {
          type: "string",
          description: 'Optional qualification filter (partial match). Example: "Promotion", "Hosting".',
        },
      },
      required: ["event_id"],
    },
  },

  {
    name: "update_project_location",
    description:
      "SMART TOOL — Update the location for all active events in one or more projects in a single call. " +
      "Projects do NOT have a location_id — this tool updates the location_id on every active event " +
      "(and optionally event functions) belonging to the specified projects. " +
      "Use this when someone says 'change the location of project X to Y'. " +
      "Example: project_ids=[1196,1197], location_id=33 → updates all active events in both projects.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_ids: {
          type: "array",
          items: { type: "number" },
          description: "Array of project IDs whose events should be updated.",
        },
        location_id: {
          type: "number",
          description: "The new location ID to set on all events.",
        },
        include_event_functions: {
          type: "boolean",
          description: "Also update location_id on event functions (default: false).",
        },
      },
      required: ["project_ids", "location_id"],
    },
  },
  {
    name: "get_planned_hours",
    description:
      "SMART TOOL — Calculate planned person-hours from scheduled events in ONE call. " +
      "Answers: 'How many hours are planned for Q1?', 'What's our 2026 capacity?', " +
      "'How many person-hours does this project need?'. " +
      "Computes event-hours (raw shift duration) AND person-hours (duration × staffing quantity from event functions). " +
      "Groups by project, month, or day. " +
      "NOTE: This is FORWARD-LOOKING (planned/forecast). For actual logged hours, use get_work_hours_summary (ops module).",
    inputSchema: {
      type: "object" as const,
      properties: {
        date_start: {
          type: "string",
          description: 'Start of date range. Format: "YYYY-MM-DD".',
        },
        date_end: {
          type: "string",
          description: 'End of date range. Format: "YYYY-MM-DD".',
        },
        project_id: {
          type: "number",
          description: "Optional: limit to a single project.",
        },
        group_by: {
          type: "string",
          enum: ["project", "month", "day"],
          description: 'How to group results: "project" (default), "month", or "day".',
        },
        include_drafts: {
          type: "boolean",
          description: "Include draft events (status=1) in addition to active events. Default: false.",
        },
      },
      required: ["date_start", "date_end"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════
  {
    name: "resolve_field_value",
    description:
      "SMART TOOL — Resolve a text label to the collection value ID needed for select/multi-select dynamic fields. " +
      "When you read an employee, dynamic_field_44 returns 'Switzerland' (text label). " +
      "But when you WRITE it, you must send the numeric ID (223). " +
      "This tool looks up the attribute's collection and finds the matching ID. " +
      "Example: field='dynamic_field_44', value='Switzerland' → write_value=223. " +
      "For text fields (not select), tells you no resolution is needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          description: 'The dynamic field name (e.g. "dynamic_field_44") or attribute ID (e.g. "44").',
        },
        value: {
          type: "string",
          description: 'The text label to resolve to a collection value ID. Case-insensitive matching.',
        },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "format_phone",
    description:
      "UTILITY — Format a phone number to Swiss E.164 format (+41 XX XXX XX XX). " +
      "Handles common inputs: '079 123 45 67' → '+41 79 123 45 67', '0041791234567' → '+41 79 123 45 67'. " +
      "Use this before creating contacts or employees to ensure the phone number is accepted by the API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        phone: {
          type: "string",
          description: 'Phone number in any format. Examples: "079 123 45 67", "+41791234567", "0041 79 123 4567".',
        },
      },
      required: ["phone"],
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

  const { client, descriptionField, defaultPlannerId, piiAccess } = ctx;

  let result: string;

  switch (name) {
    // ── Employees ──
    case "list_employees": {
      const v = validate(
        z.object({
          status: z.string().optional(),
          updated_since: z.string().optional(),
          fields: zFields,
          sort: zSort,
          filter: zFilter,
          limit: z.number().int().positive().optional(),
        }).passthrough(),
        args,
        name
      );
      // API-level PII filtering: restrict fields before the request
      v.fields = filterEmployeeFields(v.fields, piiAccess);
      const params = buildParams(v);
      const data = await client.listEmployees(params);
      result = formatResult(data, v.limit);
      return result;
    }
    case "get_employee": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      // API-level PII filtering: restrict fields before the request
      v.fields = filterEmployeeFields(v.fields, piiAccess);
      result = formatResult(await client.getEmployee(v.id, buildParams(v)));
      return result;
    }
    case "create_employee": {
      const v = validate(z.object({ data: zData }), args, name);
      const empData = await resolveQualifications(autoFormatPhones(v.data), client);
      result = formatResult(await client.createEmployee(empData));
      return result;
    }
    case "update_employee": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      const empData = await resolveQualifications(autoFormatPhones(v.data), client);
      result = formatResult(await client.updateEmployee(v.id, empData));
      return result;
    }
    case "delete_employee": {
      const v = validate(z.object({ id: zId }), args, name);
      result = formatResult(await client.deleteEmployee(v.id));
      return result;
    }
    case "set_employee_state": {
      const v = validate(
        z.object({ id: zId, state: z.number().int().min(1).max(6) }),
        args,
        name
      );
      result = formatResult(await client.setEmployeeState(v.id, v.state));
      return result;
    }

    // ── Projects ──
    case "list_projects": {
      validate(zListParams, args, name);
      result = formatResult(await client.listProjects(buildParams(args)));
      return result;
    }
    case "get_project": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      result = formatResult(await client.getProject(v.id, buildParams(v)));
      return result;
    }
    case "list_planners": {
      validate(zListParams, args, name);
      result = formatResult(await client.listPlanners(buildParams(args)));
      return result;
    }
    case "create_project": {
      const v = validate(z.object({ data: zData }), args, name);
      if (defaultPlannerId && !v.data.planner_id) {
        v.data.planner_id = defaultPlannerId;
      }
      try {
        result = formatResult(await client.createProject(v.data));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Validation") && msg.includes("dyn_attr")) {
          throw new Error(
            msg +
            "\n\nHINT: This tenant requires custom dynamic fields on projects. " +
            "Use get_field_definitions with resource='project' to discover required fields, " +
            "or check an existing project's fields with get_project. " +
            "Include them as 'dynamic_field_XX': value."
          );
        }
        throw error;
      }
      return result;
    }
    case "update_project": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      result = formatResult(await client.updateProject(v.id, v.data));
      return result;
    }

    // ── Events ──
    case "list_events": {
      validate(zListParams, args, name);
      result = formatResult(await client.listEvents(buildParams(args)));
      return result;
    }
    case "get_event": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      result = formatResult(await client.getEvent(v.id, buildParams(v)));
      return result;
    }
    case "create_event": {
      const v = validate(z.object({ data: zData }), args, name);
      if (defaultPlannerId && !v.data.planner_id) {
        v.data.planner_id = defaultPlannerId;
      }
      result = formatResult(await client.createEvent(v.data));
      return result;
    }
    case "update_event": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      result = formatResult(await client.updateEvent(v.id, v.data));
      return result;
    }
    case "delete_event": {
      const v = validate(z.object({ id: zId }), args, name);
      result = formatResult(await client.deleteEvent(v.id));
      return result;
    }

    // ── Assignments ──
    case "list_assignments": {
      validate(zListParams.extend({ status: z.string().optional() }), args, name);
      result = formatResult(await client.listAssignments(buildParams(args)));
      return result;
    }
    case "get_assignment": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      result = formatResult(await client.getAssignment(v.id, buildParams(v)));
      return result;
    }
    case "update_assignment_status": {
      const v = validate(
        z.object({ id: zId, status: z.number().int().min(1).max(8) }),
        args,
        name
      );
      result = formatResult(await client.updateAssignmentStatus(v.id, v.status));
      return result;
    }
    case "bulk_update_assignment_status": {
      const v = validate(
        z.object({
          status: z.number().int().min(1).max(8),
          remarks: z.string().optional(),
          confirm: z.literal("all"),
        }),
        args,
        name
      );
      result = formatResult(
        await client.bulkUpdateAssignmentStatus(v.status, v.remarks)
      );
      return result;
    }

    // ════════════════════════════════════════════════════════════
    // SMART COMPOSITE TOOLS
    // ════════════════════════════════════════════════════════════
    case "get_staff_schedule": {
      const v = validate(
        z.object({
          date: z.string().optional(),
          event_id: z.number().int().positive().optional(),
          employee_id: z.number().int().positive().optional(),
          status: z.string().optional(),
        }),
        args,
        name
      );
      if (!v.date && !v.event_id && !v.employee_id) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Either 'date', 'event_id', or 'employee_id' must be provided"
        );
      }
      result = formatResult(await getStaffSchedule(client, v, piiAccess));
      return result;
    }
    case "find_available_staff": {
      const v = validate(
        z.object({
          date_start: z.string(),
          date_end: z.string(),
          qualification: z.string().optional(),
          city: z.string().optional(),
        }),
        args,
        name
      );
      result = formatResult(await findAvailableStaff(client, v, piiAccess));
      return result;
    }
    case "get_employee_profile": {
      const v = validate(
        z.object({
          id: z.coerce.number().int().positive().optional(),
          name: z.string().optional(),
        }),
        args,
        name
      );
      if (!v.id && !v.name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Either 'id' or 'name' must be provided"
        );
      }
      result = formatResult(await getEmployeeProfile(client, v, piiAccess));
      return result;
    }
    case "create_shift": {
      const v = validate(
        z.object({
          project_id: zId,
          name: z.string(),
          date: z.string(),
          start_time: z.string(),
          duration_hours: z.number().positive().optional(),
          end_time: z.string().optional(),
          location_id: zId,
          planner_id: z.coerce.number().int().positive().optional(),
          break_start: z.string().optional(),
          break_end: z.string().optional(),
          skip_break: z.boolean().optional(),
          function_id: z.number().int().positive().optional(),
          quantity: z.number().int().positive().optional(),
          description: z.string().optional(),
          activate: z.boolean().optional(),
        }),
        args,
        name
      );
      if (!v.duration_hours && !v.end_time) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Either 'duration_hours' or 'end_time' must be provided"
        );
      }
      const shiftPlannerId = v.planner_id || defaultPlannerId;
      if (!shiftPlannerId) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "planner_id is required. Set STAFFCLOUD_DEFAULT_PLANNER_ID or provide planner_id per request."
        );
      }
      result = formatResult(await createShift(client, {
        ...v,
        planner_id: shiftPlannerId,
        descriptionField,
      }));
      return result;
    }
    case "get_staffing_gaps": {
      const v = validate(
        z.object({
          date: z.string().optional(),
          date_start: z.string().optional(),
          date_end: z.string().optional(),
        }),
        args,
        name
      );
      if (!v.date && !(v.date_start && v.date_end)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Either 'date' or both 'date_start' and 'date_end' must be provided"
        );
      }
      result = formatResult(await getStaffingGaps(client, v));
      return result;
    }
    case "find_replacement": {
      const v = validate(
        z.object({
          event_id: zId,
          function_id: z.number().int().positive().optional(),
          city: z.string().optional(),
          qualification: z.string().optional(),
        }),
        args,
        name
      );
      result = formatResult(await findReplacement(client, v, piiAccess));
      return result;
    }

    case "update_project_location": {
      const v = validate(
        z.object({
          project_ids: z.array(z.number().int().positive()),
          location_id: z.number().int().positive(),
          include_event_functions: z.boolean().optional(),
        }),
        args,
        name
      );
      result = formatResult(await updateProjectLocation(client, v));
      return result;
    }
    case "get_planned_hours": {
      const v = validate(
        z.object({
          date_start: z.string(),
          date_end: z.string(),
          project_id: z.number().int().positive().optional(),
          group_by: z.enum(["project", "month", "day"]).optional(),
          include_drafts: z.boolean().optional(),
        }),
        args,
        name
      );
      result = formatResult(await getPlannedHours(client, v));
      return result;
    }

    // ── Utilities ──
    case "resolve_field_value": {
      const v = validate(
        z.object({
          field: z.string(),
          value: z.string(),
        }),
        args,
        name
      );
      result = formatResult(await resolveFieldValue(client, v));
      return result;
    }
    case "format_phone": {
      const v = validate(
        z.object({ phone: z.string() }),
        args,
        name
      );
      const formatted = formatSwissPhone(v.phone);
      result = formatResult({
        input: v.phone,
        formatted,
        is_swiss: formatted.startsWith("+41 "),
      });
      return result;
    }

    default:
      return null;
  }
}
