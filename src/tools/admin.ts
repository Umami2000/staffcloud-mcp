import type { ToolDefinition, ToolContext } from "./types.js";
import { validate, buildParams, formatResult, zId, zFields, zData, zListParams } from "./shared.js";
import { z } from "zod";

export const tools: ToolDefinition[] = [
  // ════════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_webhooks",
    description: "List all configured webhooks. Shows trigger events and target URLs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_webhook",
    description:
      "Create a webhook for event-driven notifications. " +
      "Triggers: employee.created, employee.updated, assignment.status_changed, etc. " +
      'Example: {"trigger":{"event":"employee.updated"},"webhook":{"url":"https://example.com/hook"}}.',
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "object", description: "Webhook config with trigger and webhook URL." },
      },
      required: ["data"],
    },
  },
  {
    name: "update_webhook",
    description:
      "Update a webhook. IMPORTANT: must include BOTH trigger and webhook fields in the data, not just the changed field. " +
      'Example: {"trigger":{"event":"employee.created"},"webhook":{"url":"https://new-url.com/hook"}}.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Webhook ID." },
        data: { type: "object", description: "Fields to update." },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "delete_webhook",
    description: "⚠️ MODIFIES CONFIG — Delete a webhook by ID. Stops all notifications to the configured URL. Confirm with the user.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Webhook ID to delete." },
      },
      required: ["id"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // MESSAGES
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_messages",
    description: "List messages/notifications sent through StaffCloud.",
    inputSchema: {
      type: "object",
      properties: {
        fields: { type: "string", description: "Comma-separated fields." },
        filter: { type: "string", description: "Additional filters." },
      },
    },
  },
  {
    name: "send_message",
    description:
      "⚠️ SENDS COMMUNICATION — Send a message to an employee or contact via inbox, email, or SMS. " +
      "This delivers a real notification to a real person. ALWAYS confirm the recipient, subject, and content with the user before sending. " +
      "Double-check the channels (inbox/email/sms) — SMS has cost implications. " +
      'Example: {"subject":"Shift Update","text":"<b>New time</b>: 09:00","to":{"userType":"employee","userId":123},"channels":["inbox","email"]}.',
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "object", description: "Message data with subject, text, to, and channels." },
      },
      required: ["data"],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // EXTERNAL STAFF REQUESTS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_external_staff_requests",
    description: "List external staff requests. These are requests sent to external staffing agencies for positions that can't be filled internally.",
    inputSchema: { type: "object", properties: { fields: { type: "string", description: "Comma-separated fields." }, filter: { type: "string", description: "Filters." }, sort: { type: "string", description: "Sort fields." } } },
  },
  {
    name: "get_external_staff_request",
    description: "Get a single external staff request by ID.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "External staff request ID." }, fields: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_external_staff_request",
    description: "Create an external staff request. Requires event_function_id. Optional: external_staff_provider_id, quantity, remarks.",
    inputSchema: { type: "object", properties: { data: { type: "object", description: "Request data with event_function_id." } }, required: ["data"] },
  },
  {
    name: "update_external_staff_request",
    description: "Update an external staff request.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "Request ID." }, data: { type: "object", description: "Fields to update." } }, required: ["id", "data"] },
  },
  {
    name: "delete_external_staff_request",
    description: "⛔ DESTRUCTIVE — Delete an external staff request. CANNOT be undone. Confirm with the user.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "Request ID." } }, required: ["id"] },
  },

  // ════════════════════════════════════════════════════════════════
  // EXTERNAL WORKERS
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_external_workers",
    description: "List external workers (non-employee staff from external agencies).",
    inputSchema: { type: "object", properties: { fields: { type: "string", description: "Comma-separated fields." }, filter: { type: "string" }, sort: { type: "string" } } },
  },
  {
    name: "get_external_worker",
    description: "Get a single external worker by ID.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "External worker ID." }, fields: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_external_worker",
    description: "Create an external worker. Required fields vary by tenant — typically firstname, lastname, gender, qualifications.",
    inputSchema: { type: "object", properties: { data: { type: "object", description: "Worker data." } }, required: ["data"] },
  },
  {
    name: "update_external_worker",
    description: "Update an external worker.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "Worker ID." }, data: { type: "object", description: "Fields to update." } }, required: ["id", "data"] },
  },

  // ════════════════════════════════════════════════════════════════
  // FILES
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_files",
    description: "List uploaded files. Returns file metadata (id, path, name, mime, visibility, created_at). Note: file upload requires binary POST which is not supported via MCP — use this for listing/reading metadata only.",
    inputSchema: { type: "object", properties: { fields: { type: "string" }, filter: { type: "string" }, sort: { type: "string" } } },
  },
  {
    name: "get_file",
    description: "Get file metadata by ID.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "File ID." }, fields: { type: "string" } }, required: ["id"] },
  },
  {
    name: "delete_file",
    description: "⛔ DESTRUCTIVE — Delete a file by ID. This permanently removes the file. CANNOT be undone. Confirm with the user.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "File ID." } }, required: ["id"] },
  },

  // ════════════════════════════════════════════════════════════════
  // EMPLOYEE PICTURES
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_employee_pictures",
    description: "List employee profile pictures. Returns employee_id, file_id, order, is_profile_picture.",
    inputSchema: { type: "object", properties: { fields: { type: "string" }, filter: { type: "string" } } },
  },
  {
    name: "get_employee_picture",
    description: "Get employee picture metadata by ID.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "Picture ID." }, fields: { type: "string" } }, required: ["id"] },
  },
  {
    name: "delete_employee_picture",
    description: "⛔ DESTRUCTIVE — Delete an employee picture by ID. This permanently removes the picture. CANNOT be undone. Confirm with the user.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "Picture ID." } }, required: ["id"] },
  },

  // ════════════════════════════════════════════════════════════════
  // SPECIAL DATES
  // ════════════════════════════════════════════════════════════════
  {
    name: "list_special_dates",
    description: "List special dates (holidays, public dates). These are tenant-wide dates that affect scheduling.",
    inputSchema: { type: "object", properties: { fields: { type: "string" }, filter: { type: "string" }, sort: { type: "string" } } },
  },
  {
    name: "get_special_date",
    description: "Get a special date by ID.",
    inputSchema: { type: "object", properties: { id: { type: "number" }, fields: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_special_date",
    description: "Create a special date (holiday). Requires name and date.",
    inputSchema: { type: "object", properties: { data: { type: "object", description: "Special date data: name, date (YYYY-MM-DD)." } }, required: ["data"] },
  },
  {
    name: "update_special_date",
    description: "Update a special date.",
    inputSchema: { type: "object", properties: { id: { type: "number" }, data: { type: "object" } }, required: ["id", "data"] },
  },
  {
    name: "delete_special_date",
    description: "⛔ DESTRUCTIVE — Delete a special date. CANNOT be undone. Confirm with the user.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
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
    // ── Webhooks ──
    case "list_webhooks":
      return formatResult(await client.listWebhooks());
    case "create_webhook": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createWebhook(v.data));
    }
    case "update_webhook": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateWebhook(v.id, v.data));
    }
    case "delete_webhook": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteWebhook(v.id));
    }

    // ── Messages ──
    case "list_messages": {
      validate(zListParams, args, name);
      return formatResult(await client.listMessages(buildParams(args)));
    }
    case "send_message": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.sendMessage(v.data));
    }

    // ── External Staff Requests ──
    case "list_external_staff_requests": {
      validate(zListParams, args, name);
      return formatResult(await client.listExternalStaffRequests(buildParams(args)));
    }
    case "get_external_staff_request": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getExternalStaffRequest(v.id, buildParams(v)));
    }
    case "create_external_staff_request": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createExternalStaffRequest(v.data));
    }
    case "update_external_staff_request": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateExternalStaffRequest(v.id, v.data));
    }
    case "delete_external_staff_request": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteExternalStaffRequest(v.id));
    }

    // ── External Workers ──
    case "list_external_workers": {
      validate(zListParams, args, name);
      return formatResult(await client.listExternalWorkers(buildParams(args)));
    }
    case "get_external_worker": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getExternalWorker(v.id, buildParams(v)));
    }
    case "create_external_worker": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createExternalWorker(v.data));
    }
    case "update_external_worker": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateExternalWorker(v.id, v.data));
    }

    // ── Files ──
    case "list_files": {
      validate(zListParams, args, name);
      return formatResult(await client.listFiles(buildParams(args)));
    }
    case "get_file": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getFile(v.id, buildParams(v)));
    }
    case "delete_file": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteFile(v.id));
    }

    // ── Employee Pictures ──
    case "list_employee_pictures": {
      validate(zListParams, args, name);
      return formatResult(await client.listEmployeePictures(buildParams(args)));
    }
    case "get_employee_picture": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getEmployeePicture(v.id, buildParams(v)));
    }
    case "delete_employee_picture": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteEmployeePicture(v.id));
    }

    // ── Special Dates ──
    case "list_special_dates": {
      validate(zListParams, args, name);
      return formatResult(await client.listSpecialDates(buildParams(args)));
    }
    case "get_special_date": {
      const v = validate(z.object({ id: zId, fields: zFields }), args, name);
      return formatResult(await client.getSpecialDate(v.id, buildParams(v)));
    }
    case "create_special_date": {
      const v = validate(z.object({ data: zData }), args, name);
      return formatResult(await client.createSpecialDate(v.data));
    }
    case "update_special_date": {
      const v = validate(z.object({ id: zId, data: zData }), args, name);
      return formatResult(await client.updateSpecialDate(v.id, v.data));
    }
    case "delete_special_date": {
      const v = validate(z.object({ id: zId }), args, name);
      return formatResult(await client.deleteSpecialDate(v.id));
    }

    default:
      return null;
  }
}
