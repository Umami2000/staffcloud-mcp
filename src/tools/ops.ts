/**
 * Operations module — post-event operations and tracking tools (25 tools).
 *
 * Covers assignment sub-resources, checkins, work times, busy dates,
 * employee availability, ratings, and work hours summary.
 */

import type { ToolDefinition, ToolContext } from "./types.js";
import { validate, buildParams, formatResult, zId, zFields, zData, zListParams } from "./shared.js";
import { z } from "zod";
import { getWorkHoursSummary } from "../smart-tools.js";

export const tools: ToolDefinition[] = [
  // ════════════════════════════════════════════════════════════════
  // ASSIGNMENT SUB-RESOURCES
  // ════════════════════════════════════════════════════════════════
  {
    name: "get_assignment_wages",
    description: "Get wages for an assignment. Shows wage calculations: base_value, factor, payable_amount, wage_type details.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_paysheets",
    description: "Get paysheets for an assignment. Shows payment summary with all wage line items and approval status.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_work_times",
    description: "Get recorded work times for an assignment. Shows actual hours logged.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_configurations",
    description: "Get configurations for an assignment. Shows which features are enabled: livestamps, checkins, work_time_proposals, wage_proposals, reporting_forms, etc.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_work_time_proposals",
    description: "Get work time proposals for an assignment. Employee-submitted time corrections.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_wage_proposals",
    description: "Get wage proposals for an assignment. Employee-submitted expense/wage claims.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_livestamps",
    description: "Get livestamps for an assignment. Real-time check-in/out tracking entries.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_reporting_forms",
    description: "Get reporting forms for an assignment. Post-event reports submitted by employees.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Assignment ID." } }, required: ["id"] },
  },
  {
    name: "get_assignment_teamsheet",
    description:
      "Get the teamsheet for an assignment — a formatted view of the team assigned to the same event. " +
      "Useful for seeing who else is working the same shift.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Assignment ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_assignment_open_actions",
    description:
      "Get open/pending actions for an assignment. Shows tasks that need attention " +
      "(e.g. confirmation pending, documents missing).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Assignment ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_assignment_status_map",
    description:
      "Get the allowed status transitions for an assignment. Shows which status changes are valid from the current state. " +
      "Use this before update_assignment_status to verify the transition is allowed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Assignment ID." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // CHECK-INS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_checkins",
    description:
      "List check-in/check-out timestamps for employees. Shows when staff arrived and left. " +
      "NOTE: Vorab-Check-Ins (pre-check-ins) are NOT available via the API — only actual on-site check-ins are returned.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
        filter: { type: "string", description: 'Filters. Example: "employee_id=123".' },
      },
    },
  },
  {
    name: "create_checkin",
    description:
      "Create a check-in record for an employee. Used to log arrival/departure times.",
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Check-in data with employee_id, timestamp, etc." },
      },
      required: ["data"],
    },
  },
  {
    name: "delete_checkin",
    description: "⛔ DESTRUCTIVE — Delete a check-in record by ID. Removes proof of employee attendance. CANNOT be undone. Confirm with the user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Check-in ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // WORK TIMES
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_work_times",
    description:
      "List work time records (actual hours worked). For aggregated summaries, " +
      "use get_work_hours_summary smart tool instead. Filter by employee_id, event_id, or date range.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: 'Example: "id,employee_id,event_id,start,end".' },
        filter: { type: "string", description: "Additional filters." },
      },
    },
  },

  // ════════════════════════════════════════════════════════════════
  // BUSY DATES (Vacation/Leave/Unavailability)
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_busy_dates",
    description:
      "List busy dates (vacation, leave, unavailability periods). " +
      "Use this to check when employees are unavailable, or use find_available_staff for an availability check. " +
      "Filter by employee_id, date range, or type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: 'Example: "id,employee_id,start,end,type".' },
        filter: { type: "string", description: 'Filters. Example: "employee_id=123".' },
      },
    },
  },
  {
    name: "create_busy_date",
    description:
      "Create a busy date (unavailability period) for an employee. " +
      'Example: {"employee_id":123,"start":"2026-04-01","end":"2026-04-05","type":"vacation"}.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: {
          type: "object",
          description: "Busy date data with employee_id, start, end, and type.",
        },
      },
      required: ["data"],
    },
  },
  {
    name: "update_busy_date",
    description:
      "Update an existing busy date. NOTE: May not be supported on all instances (returns 500 on some). " +
      "Test with a simple field change first before relying on this endpoint.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Busy date ID." },
        data: { type: "object", description: "Fields to update." },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_busy_date",
    description:
      "⚠️ MODIFIES AVAILABILITY — Delete a busy date (vacation/leave) by ID. This makes the employee appear available again " +
      "for the deleted period. Confirm with the user — they may have approved this leave already.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Busy date ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // EMPLOYEE AVAILABILITY
  // ════════════════════════════════════════════════════════════════
  {
    name: "get_employee_availabilities",
    description: "Get availabilities for an employee. Shows their availability responses to availability requests.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Employee ID." } }, required: ["id"] },
  },
  {
    name: "get_employee_availability_requests",
    description: "Get availability requests sent to an employee. Shows request name, date range, completion status.",
    inputSchema: { type: "object" as const, properties: { id: { type: "number", description: "Employee ID." } }, required: ["id"] },
  },

  // ════════════════════════════════════════════════════════════════
  // SMART: WORK HOURS SUMMARY
  // ════════════════════════════════════════════════════════════════
  {
    name: "get_work_hours_summary",
    description:
      "SMART TOOL — Aggregate work hours for a date range in ONE call. " +
      "Answers: 'How many hours did the team work last month?', 'Hours per employee this week'. " +
      "Groups by employee, event, or day. Calculates totals and sorts by hours descending.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date_start: {
          type: "string",
          description: 'Start date. Format: "YYYY-MM-DD".',
        },
        date_end: {
          type: "string",
          description: 'End date. Format: "YYYY-MM-DD".',
        },
        employee_id: {
          type: "number",
          description: "Optional: filter to a specific employee.",
        },
        event_id: {
          type: "number",
          description: "Optional: filter to a specific event.",
        },
        group_by: {
          type: "string",
          description: 'Grouping: "employee" (default), "event", or "day".',
          enum: ["employee", "event", "day"],
        },
      },
      required: ["date_start", "date_end"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // RATINGS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_ratings",
    description: "List employee ratings/reviews. Shows performance evaluations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
        filter: { type: "string", description: 'Filters. Example: "employee_id=123".' },
      },
    },
  },
  {
    name: "create_rating",
    description:
      "Create a rating/review for an employee. Requires employee_id and criteria. " +
      "NOTE: Only planner-level API users can create ratings (external_users get 'not_allowed'). " +
      "Use list_rating_criteria to discover available criteria. " +
      'Example: {"employee_id":1,"criteria":{"Pünktlichkeit":"8","Sorgfältigkeit":"7"}}. Criteria keys can be names (text) or IDs.',
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "object", description: "Rating data." },
      },
      required: ["data"],
    },
  },
  {
    name: "list_rating_criteria",
    description:
      "List all rating criteria (e.g. Pünktlichkeit, Sorgfältigkeit). Use these criteria names or IDs when creating ratings.",
    inputSchema: {
      type: "object" as const,
      properties: {},
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
    // ── Assignment Sub-Resources ──
    case "get_assignment_wages": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentWages(v.id));
    }
    case "get_assignment_paysheets": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentPaysheets(v.id));
    }
    case "get_assignment_work_times": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentWorkTimes(v.id));
    }
    case "get_assignment_configurations": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentConfigurations(v.id));
    }
    case "get_assignment_work_time_proposals": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentWorkTimeProposals(v.id));
    }
    case "get_assignment_wage_proposals": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentWageProposals(v.id));
    }
    case "get_assignment_livestamps": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentLivestamps(v.id));
    }
    case "get_assignment_reporting_forms": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentReportingForms(v.id));
    }
    case "get_assignment_teamsheet": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentTeamsheet(v.id));
    }
    case "get_assignment_open_actions": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentOpenActions(v.id));
    }
    case "get_assignment_status_map": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getAssignmentStatusMap(v.id));
    }

    // ── Check-ins ──
    case "list_checkins": {
      validate(zListParams, args, name);
      return formatResult(await client.listCheckins(buildParams(args)));
    }
    case "create_checkin": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createCheckin(v.data));
    }
    case "delete_checkin": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteCheckin(v.id));
    }

    // ── Work Times ──
    case "list_work_times": {
      validate(zListParams, args, name);
      return formatResult(await client.listWorkTimes(buildParams(args)));
    }

    // ── Busy Dates ──
    case "list_busy_dates": {
      validate(zListParams, args, name);
      return formatResult(await client.listBusyDates(buildParams(args)));
    }
    case "create_busy_date": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createBusyDate(v.data));
    }
    case "update_busy_date": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateBusyDate(v.id, v.data));
    }
    case "delete_busy_date": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteBusyDate(v.id));
    }

    // ── Employee Availability ──
    case "get_employee_availabilities": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getEmployeeAvailabilities(v.id));
    }
    case "get_employee_availability_requests": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.getEmployeeAvailabilityRequests(v.id));
    }

    // ── Smart: Work Hours Summary ──
    case "get_work_hours_summary": {
      const v = validate(
        z.object({
          date_start: z.string(),
          date_end: z.string(),
          employee_id: z.number().int().positive().optional(),
          event_id: z.number().int().positive().optional(),
          group_by: z.enum(["employee", "event", "day"]).optional(),
        }),
        args,
        name
      );
      return formatResult(await getWorkHoursSummary(client, v));
    }

    // ── Ratings ──
    case "list_ratings": {
      validate(zListParams, args, name);
      return formatResult(await client.listRatings(buildParams(args)));
    }
    case "create_rating": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createRating(v.data));
    }
    case "list_rating_criteria": {
      return formatResult(await client.listRatingCriteria());
    }

    default:
      return null;
  }
}
