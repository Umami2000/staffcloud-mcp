/**
 * Smart Tools — High-level composite tools for staffing operations
 *
 * These tools answer real business questions in a single call by
 * orchestrating multiple API endpoints and returning pre-processed results.
 */

import type { StaffCloudClient, QueryParams } from "./staffcloud-client.js";

// ─── Constants ──────────────────────────────────────────────────

const ASSIGNMENT_STATUS_LABELS: Record<number, string> = {
  1: "invited",
  2: "ignored",
  3: "applied",
  4: "applied_maybe",
  5: "assigned_provisional",
  6: "assigned",
  7: "confirmed",
  8: "denied",
};

const EMPLOYEE_STATUS_LABELS: Record<number, string> = {
  0: "incomplete",
  1: "applicant",
  2: "preliminary_candidate",
  3: "candidate",
  4: "active",
  5: "inactive",
  6: "deleted",
};

// ─── Helpers ────────────────────────────────────────────────────

/** Format a Date to YYYY-MM-DD using local time (avoids toISOString UTC mismatch) */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0]!;
}

function parseHours(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.round(((e - s) / 3_600_000) * 100) / 100;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ─── Phone Number Formatting ────────────────────────────────────

/**
 * Format a phone number to Swiss E.164 format (+41 XX XXX XX XX).
 * Handles common Swiss input formats:
 *   079 123 45 67  → +41 79 123 45 67
 *   0791234567     → +41 79 123 45 67
 *   +41791234567   → +41 79 123 45 67
 *   0041791234567  → +41 79 123 45 67
 *   41 79 123 4567 → +41 79 123 45 67
 * Non-Swiss numbers are returned as-is with minimal cleanup.
 */
export function formatSwissPhone(input: string): string {
  // Strip all whitespace, dashes, dots, parens
  let digits = input.replace(/[\s\-\.\(\)\/]/g, "");

  // Remove leading + for processing
  const hadPlus = digits.startsWith("+");
  if (hadPlus) digits = digits.substring(1);

  // Handle 0041 prefix
  if (digits.startsWith("0041")) {
    digits = "41" + digits.substring(4);
  }

  // Handle local 0-prefix (Swiss domestic format: 07X, 06X, 04X, 03X, 02X)
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "41" + digits.substring(1);
  }

  // If it's an 11-digit Swiss number starting with 41
  if (digits.startsWith("41") && digits.length === 11) {
    const area = digits.substring(2, 4);
    const p1 = digits.substring(4, 7);
    const p2 = digits.substring(7, 9);
    const p3 = digits.substring(9, 11);
    return `+41 ${area} ${p1} ${p2} ${p3}`;
  }

  // Not a recognized Swiss format — return with + prefix, cleaned up
  return hadPlus ? `+${digits}` : digits.length > 7 ? `+${digits}` : input;
}

// ─── Tool 1: get_staff_schedule ─────────────────────────────────

export interface StaffScheduleArgs {
  date?: string;
  event_id?: number;
  employee_id?: number;
  status?: string;
}

/**
 * "Who works tomorrow?" / "Show me the team for Event X" / "What are Reon's shifts?"
 *
 * Fetches events → assignments → employee details → project names → roles → breaks
 * and merges them into a single, fully resolved schedule view.
 */
export async function getStaffSchedule(
  client: StaffCloudClient,
  args: StaffScheduleArgs,
  piiAccess = false
): Promise<unknown> {
  // 1. Get events — either by date, event_id, or via employee assignments
  let events: AnyRecord[];
  let assignments: AnyRecord[];

  if (args.employee_id) {
    // Employee-centric: get their assignments first, then fetch events
    const assignmentParams: QueryParams = {
      employee_id: String(args.employee_id),
      fields: "id,employee_id,event_id,event_function_id,status",
      status: args.status || "5,6,7",
    };
    assignments = (await client.listAssignments(assignmentParams)) as AnyRecord[];

    if (assignments.length === 0) {
      return { employee_id: args.employee_id, assignment_count: 0, shifts: [] };
    }

    // Fetch all referenced events
    const eventIds = [...new Set(assignments.map((a) => a.event_id as number))];
    events = (await client.listEvents({
      id: eventIds.join(","),
      fields: "id,name,project_id,start,end,location_id",
      sort: "start",
    })) as AnyRecord[];
  } else if (args.event_id) {
    const event = await client.getEvent(args.event_id);
    events = [event];
    // Fetch assignments for this event
    const assignmentParams: QueryParams = {
      event_id: String(args.event_id),
      fields: "id,employee_id,event_id,event_function_id,status",
      status: args.status || "5,6,7",
    };
    assignments = (await client.listAssignments(assignmentParams)) as AnyRecord[];
  } else if (args.date) {
    const nextDay = getNextDay(args.date);
    events = (await client.listEvents({
      start: `>=${args.date} 00:00:00`,
      end: `<${nextDay} 23:59:59`,
      status: "2",
      fields: "id,name,project_id,start,end,location_id",
      sort: "start",
    })) as AnyRecord[];

    if (events.length === 0) {
      return { date: args.date, event_count: 0, total_staff: 0, events: [] };
    }

    const eventIds = events.map((e) => e.id);
    const assignmentParams: QueryParams = {
      event_id: eventIds.join(","),
      fields: "id,employee_id,event_id,event_function_id,status",
      status: args.status || "5,6,7",
    };
    assignments = (await client.listAssignments(assignmentParams)) as AnyRecord[];
  } else {
    throw new Error("Either 'date', 'event_id', or 'employee_id' must be provided");
  }

  // 2-5. Resolve projects, event functions, and employees in parallel
  const projectIds = [...new Set(events.map((e) => e.project_id as number).filter(Boolean))];
  const eventFunctionIds = [...new Set(
    assignments.map((a) => a.event_function_id as number).filter(Boolean)
  )];
  const employeeIds = [...new Set(assignments.map((a) => a.employee_id as number))];
  const empFields = piiAccess
    ? "id,firstname,lastname,mobile,email"
    : "id,firstname,lastname";

  const [projectsRaw, efsRaw, employeesRaw] = await Promise.all([
    projectIds.length > 0
      ? client.listProjects({ id: projectIds.join(","), fields: "id,name" })
      : Promise.resolve([]),
    eventFunctionIds.length > 0
      ? client.listEventFunctions({
          id: eventFunctionIds.join(","),
          fields: "id,function_id,break_start,break_end,start,end,shift_name",
        })
      : Promise.resolve([]),
    employeeIds.length > 0
      ? client.listEmployees({ id: employeeIds.join(","), fields: empFields })
      : Promise.resolve([]),
  ]);

  const projectMap: Record<number, string> = {};
  for (const p of projectsRaw as AnyRecord[]) {
    projectMap[p.id as number] = p.name as string;
  }

  const efMap: Record<number, AnyRecord> = {};
  for (const ef of efsRaw as AnyRecord[]) {
    efMap[ef.id as number] = ef;
  }

  const employeeMap: Record<number, AnyRecord> = {};
  for (const emp of employeesRaw as AnyRecord[]) {
    employeeMap[emp.id as number] = emp;
  }

  // Resolve function (role) names — depends on efMap, so runs after
  const functionIds = [...new Set(
    Object.values(efMap).map((ef) => ef.function_id as number).filter(Boolean)
  )];
  const functionMap: Record<number, string> = {};
  if (functionIds.length > 0) {
    const functions = (await client.listFunctions({
      id: functionIds.join(","),
      fields: "id,name",
    })) as AnyRecord[];
    for (const f of functions) {
      functionMap[f.id as number] = f.name as string;
    }
  }

  // Build event map for quick lookup
  const eventMap: Record<number, AnyRecord> = {};
  for (const e of events) {
    eventMap[e.id as number] = e;
  }

  // ─── Employee-centric output ───────────────────────────────────
  if (args.employee_id) {
    const emp = employeeMap[args.employee_id];
    const shifts = assignments
      .map((a) => {
        const event = eventMap[a.event_id as number];
        if (!event) return null;
        const ef = efMap[a.event_function_id as number];
        const role = ef ? (functionMap[ef.function_id as number] || ef.shift_name || null) : null;
        const hours = parseHours(
          ef?.start || event.start,
          ef?.end || event.end
        );
        return {
          assignment_id: a.id,
          date: (event.start as string)?.split(" ")[0],
          event_id: event.id,
          event_name: event.name || null,
          project: projectMap[event.project_id as number] || null,
          start: ef?.start || event.start,
          end: ef?.end || event.end,
          hours,
          break_start: ef?.break_start || null,
          break_end: ef?.break_end || null,
          role,
          status: a.status,
          status_label: ASSIGNMENT_STATUS_LABELS[a.status as number] || `status_${a.status}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a!.start as string).localeCompare(b!.start as string));

    return {
      employee_id: args.employee_id,
      employee_name: emp ? `${emp.firstname} ${emp.lastname}` : `Employee #${args.employee_id}`,
      assignment_count: shifts.length,
      shifts,
    };
  }

  // ─── Event/date-centric output ─────────────────────────────────
  // Pre-group assignments by event_id for O(1) lookup
  const assignmentsByEvent = new Map<number, AnyRecord[]>();
  for (const a of assignments) {
    const eid = a.event_id as number;
    let arr = assignmentsByEvent.get(eid);
    if (!arr) { arr = []; assignmentsByEvent.set(eid, arr); }
    arr.push(a);
  }

  const schedule = events.map((event) => {
    const eventAssignments = assignmentsByEvent.get(event.id as number) ?? [];
    return {
      id: event.id,
      name: event.name,
      project: projectMap[event.project_id as number] || null,
      project_id: event.project_id,
      start: event.start,
      end: event.end,
      staff: eventAssignments.map((a) => {
        const emp = employeeMap[a.employee_id as number];
        const ef = efMap[a.event_function_id as number];
        const role = ef ? (functionMap[ef.function_id as number] || ef.shift_name || null) : null;
        const entry: AnyRecord = {
          assignment_id: a.id,
          employee_id: a.employee_id,
          name: emp
            ? `${emp.firstname} ${emp.lastname}`
            : `Employee #${a.employee_id}`,
          role,
          break_start: ef?.break_start || null,
          break_end: ef?.break_end || null,
          status: a.status,
          status_label:
            ASSIGNMENT_STATUS_LABELS[a.status as number] ||
            `status_${a.status}`,
        };
        if (piiAccess) {
          entry.mobile = emp?.mobile;
          entry.email = emp?.email;
        }
        return entry;
      }),
      headcount: eventAssignments.length,
    };
  });

  return {
    date: args.date,
    event_count: schedule.length,
    total_staff: schedule.reduce((sum, e) => sum + e.headcount, 0),
    events: schedule,
  };
}

// ─── Tool 2: find_available_staff ───────────────────────────────

export interface FindAvailableStaffArgs {
  date_start: string;
  date_end: string;
  qualification?: string;
  city?: string;
}

/**
 * "Who is available next Friday?" / "Find available promoters in Zürich"
 *
 * Checks active employees against busy-dates and existing assignments
 * for the given date range.
 */
export async function findAvailableStaff(
  client: StaffCloudClient,
  args: FindAvailableStaffArgs,
  piiAccess = false
): Promise<unknown> {
  // 1-3. Fetch employees, busy dates, and events in parallel
  const empParams: QueryParams = {
    status: "4",
    fields: piiAccess
      ? "id,firstname,lastname,city,qualifications,mobile,email"
      : "id,firstname,lastname,city,qualifications",
  };
  if (args.city) {
    empParams.city = `~${args.city}`;
  }

  const [employees, busyDates, events] = await Promise.all([
    client.listEmployees(empParams) as Promise<AnyRecord[]>,
    client.listBusyDates({
      start: `<=${args.date_end} 23:59:59`,
      end: `>=${args.date_start} 00:00:00`,
      fields: "id,employee_id,start,end,type",
    }) as Promise<AnyRecord[]>,
    client.listEvents({
      start: `>=${args.date_start} 00:00:00`,
      end: `<=${args.date_end} 23:59:59`,
      status: "2",
      fields: "id",
    }) as Promise<AnyRecord[]>,
  ]);

  // Filter by qualification if specified
  let filtered = employees;
  if (args.qualification) {
    const qual = args.qualification.toLowerCase();
    filtered = employees.filter((e) => {
      const quals = e.qualifications;
      if (!quals || typeof quals !== "object") return false;
      return Object.keys(quals).some((k) => k.toLowerCase().includes(qual));
    });
  }

  const employeeIds = new Set(filtered.map((e) => e.id as number));

  const busyEmployeeIds = new Set(
    busyDates
      .filter((b) => employeeIds.has(b.employee_id as number))
      .map((b) => b.employee_id as number)
  );

  // 4. Fetch assignments (depends on events from step 3)
  const assignedEmployeeIds = new Set<number>();
  if (events.length > 0) {
    const eventIds = events.map((e) => e.id).join(",");
    const assignments = (await client.listAssignments({
      event_id: eventIds,
      status: "5,6,7",
      fields: "id,employee_id",
    })) as AnyRecord[];
    for (const a of assignments) {
      if (employeeIds.has(a.employee_id as number)) {
        assignedEmployeeIds.add(a.employee_id as number);
      }
    }
  }

  // 4. Categorize
  const available: AnyRecord[] = [];
  const busy: AnyRecord[] = [];
  const alreadyAssigned: AnyRecord[] = [];

  for (const emp of filtered) {
    const id = emp.id as number;
    const summary: AnyRecord = {
      id: emp.id,
      name: `${emp.firstname} ${emp.lastname}`,
      city: emp.city,
      qualifications: emp.qualifications
        ? Object.keys(emp.qualifications).join(", ")
        : "",
    };
    if (piiAccess) {
      summary.mobile = emp.mobile;
    }

    if (assignedEmployeeIds.has(id)) {
      alreadyAssigned.push(summary);
    } else if (busyEmployeeIds.has(id)) {
      busy.push(summary);
    } else {
      available.push(summary);
    }
  }

  return {
    date_start: args.date_start,
    date_end: args.date_end,
    filters: {
      qualification: args.qualification || null,
      city: args.city || null,
    },
    available_count: available.length,
    busy_count: busy.length,
    assigned_count: alreadyAssigned.length,
    available,
    busy,
    already_assigned: alreadyAssigned,
  };
}

// ─── Tool 3: get_employee_profile ───────────────────────────────

export interface EmployeeProfileArgs {
  id?: number;
  name?: string;
}

/**
 * "Tell me about employee X" / "What qualifications does Maria have?"
 *
 * Returns a human-readable profile with dynamic_field IDs resolved
 * to their labels.
 */
export async function getEmployeeProfile(
  client: StaffCloudClient,
  args: EmployeeProfileArgs,
  piiAccess = false
): Promise<unknown> {
  // 1. Find the employee
  let employee: AnyRecord;

  if (args.id) {
    employee = (await client.getEmployee(args.id)) as AnyRecord;
  } else if (args.name) {
    // Search by name (firstname or lastname)
    const results = (await client.listEmployees({
      firstname: `~${args.name}`,
      status: "0,1,2,3,4,5",
    })) as AnyRecord[];

    let matches = results;
    if (matches.length === 0) {
      // Try lastname
      const byLast = (await client.listEmployees({
        lastname: `~${args.name}`,
        status: "0,1,2,3,4,5",
      })) as AnyRecord[];
      matches = byLast;
    }

    if (matches.length === 0) {
      return { error: `No employee found matching "${args.name}"` };
    }
    if (matches.length > 10) {
      return {
        error: `Too many matches (${matches.length}). Please be more specific.`,
        sample: matches.slice(0, 5).map((e) => ({
          id: e.id,
          name: `${e.firstname} ${e.lastname}`,
        })),
      };
    }
    if (matches.length > 1) {
      return {
        multiple_matches: matches.map((e) => ({
          id: e.id,
          name: `${e.firstname} ${e.lastname}`,
          status: e.status,
          city: e.city,
        })),
        hint: "Use the employee ID to get a specific profile.",
      };
    }
    employee = matches[0]!;
  } else {
    throw new Error("Either 'id' or 'name' must be provided");
  }

  // 2. Fetch attribute definitions to resolve dynamic_field labels (cached)
  const attributes = (await client.listAttributesCached()) as AnyRecord[];
  const fieldLabelMap: Record<string, string> = {};
  for (const attr of attributes) {
    if (attr.column_name) {
      fieldLabelMap[attr.column_name as string] = attr.label as string;
    }
  }

  // 3. Build human-readable profile
  const dynamicFields: Record<string, unknown> = {};
  const coreFields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(employee)) {
    if (value === null || value === "" || value === undefined) continue;

    if (key.startsWith("dynamic_field_")) {
      const label = fieldLabelMap[key] || key;
      dynamicFields[label] = value;
    } else {
      coreFields[key] = value;
    }
  }

  // Build profile — planning-safe fields always included
  const profile: AnyRecord = {
    id: employee.id,
    name: `${employee.firstname} ${employee.lastname}`,
    status: employee.status,
    status_label:
      EMPLOYEE_STATUS_LABELS[employee.status as number] ||
      `status_${employee.status}`,
    city: employee.city,
    communication_language: employee.communication_language,
    qualifications: employee.qualifications,
    wage_profile_id: employee.wage_profile_id,
    created_at: employee.created_at,
    updated_at: employee.updated_at,
    custom_fields: dynamicFields,
  };

  // PII fields — only included when piiAccess is enabled
  if (piiAccess) {
    // Calculate age if birthday available
    let age: number | null = null;
    if (employee.birthday) {
      const birth = new Date(employee.birthday as string);
      const now = new Date();
      age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
        age--;
      }
    }

    profile.age = age;
    profile.birthday = employee.birthday;
    profile.email = employee.email;
    profile.mobile = employee.mobile;
    profile.address = [employee.address_first, employee.zip, employee.city, employee.country]
      .filter(Boolean)
      .join(", ");
    profile.gender = employee.gender;
    profile.last_active_at = employee.last_active_at;
  }

  return profile;
}

// ─── Tool 4: get_work_hours_summary ─────────────────────────────

export interface WorkHoursSummaryArgs {
  date_start: string;
  date_end: string;
  employee_id?: number;
  event_id?: number;
  group_by?: "employee" | "event" | "day";
}

/**
 * "How many hours did the team work last month?"
 *
 * Fetches work-time records and aggregates by employee, event, or day.
 */
export async function getWorkHoursSummary(
  client: StaffCloudClient,
  args: WorkHoursSummaryArgs
): Promise<unknown> {
  const params: QueryParams = {
    start: `>=${args.date_start} 00:00:00`,
    end: `<=${args.date_end} 23:59:59`,
  };
  if (args.employee_id) {
    params.employee_id = String(args.employee_id);
  }
  if (args.event_id) {
    params.event_id = String(args.event_id);
  }

  const workTimes = (await client.listWorkTimes(params)) as AnyRecord[];

  // Calculate hours for each record
  const records = workTimes.map((wt) => ({
    ...(wt as AnyRecord),
    hours: parseHours(wt.start as string, wt.end as string),
  })) as (AnyRecord & { hours: number })[];

  const totalHours = records.reduce((sum, r) => sum + r.hours, 0);
  const groupBy = args.group_by || "employee";

  if (groupBy === "employee") {
    const byEmployee: Record<number, { hours: number; shifts: number; name?: string }> = {};
    for (const r of records) {
      const eid = r.employee_id as number;
      if (!byEmployee[eid]) byEmployee[eid] = { hours: 0, shifts: 0 };
      byEmployee[eid]!.hours += r.hours;
      byEmployee[eid]!.shifts++;
    }

    // Fetch employee names
    const empIds = Object.keys(byEmployee);
    if (empIds.length > 0) {
      const employees = (await client.listEmployees({
        id: empIds.join(","),
        fields: "id,firstname,lastname",
      })) as AnyRecord[];
      for (const emp of employees) {
        if (byEmployee[emp.id as number]) {
          byEmployee[emp.id as number]!.name = `${emp.firstname} ${emp.lastname}`;
        }
      }
    }

    return {
      date_start: args.date_start,
      date_end: args.date_end,
      total_hours: Math.round(totalHours * 100) / 100,
      total_shifts: records.length,
      group_by: "employee",
      employees: Object.entries(byEmployee)
        .map(([id, data]) => ({
          employee_id: parseInt(id, 10),
          name: data.name || `Employee #${id}`,
          hours: Math.round(data.hours * 100) / 100,
          shifts: data.shifts,
        }))
        .sort((a, b) => b.hours - a.hours),
    };
  }

  if (groupBy === "event") {
    const byEvent: Record<number, { hours: number; shifts: number }> = {};
    for (const r of records) {
      const eid = r.event_id as number;
      if (!byEvent[eid]) byEvent[eid] = { hours: 0, shifts: 0 };
      byEvent[eid]!.hours += r.hours;
      byEvent[eid]!.shifts++;
    }

    return {
      date_start: args.date_start,
      date_end: args.date_end,
      total_hours: Math.round(totalHours * 100) / 100,
      total_shifts: records.length,
      group_by: "event",
      events: Object.entries(byEvent)
        .map(([id, data]) => ({
          event_id: parseInt(id, 10),
          hours: Math.round(data.hours * 100) / 100,
          shifts: data.shifts,
        }))
        .sort((a, b) => b.hours - a.hours),
    };
  }

  // group_by === "day"
  const byDay: Record<string, { hours: number; shifts: number }> = {};
  for (const r of records) {
    const day = (r.start as string).split(" ")[0]!;
    if (!byDay[day]) byDay[day] = { hours: 0, shifts: 0 };
    byDay[day]!.hours += r.hours;
    byDay[day]!.shifts++;
  }

  return {
    date_start: args.date_start,
    date_end: args.date_end,
    total_hours: Math.round(totalHours * 100) / 100,
    total_shifts: records.length,
    group_by: "day",
    days: Object.entries(byDay)
      .map(([date, data]) => ({
        date,
        hours: Math.round(data.hours * 100) / 100,
        shifts: data.shifts,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ─── Tool 5: get_field_definitions ──────────────────────────────

export interface FieldDefinitionsArgs {
  resource?: string;
  field_id?: string;
}

/**
 * "What custom fields exist?" / "What does dynamic_field_49 mean?"
 *
 * Fetches attribute definitions and returns a lookup table mapping
 * dynamic_field IDs to human-readable labels.
 */
export async function getFieldDefinitions(
  client: StaffCloudClient,
  args: FieldDefinitionsArgs
): Promise<unknown> {
  const attributes = (await client.listAttributesCached()) as AnyRecord[];

  // If looking up a specific field
  if (args.field_id) {
    const match = attributes.find(
      (a) =>
        a.column_name === args.field_id ||
        String(a.id) === args.field_id
    );
    if (match) {
      return {
        field_id: match.column_name || `dynamic_field_${match.id}`,
        label: match.label,
        type: match.type,
        form_id: match.form_id,
        required: match.required,
        options: match.options,
        raw: match,
      };
    }
    return { error: `Field "${args.field_id}" not found` };
  }

  // Group by form/resource type
  const grouped: Record<string, Record<string, string>> = {};

  for (const attr of attributes) {
    const formId = String(attr.form_id || "other");
    if (!grouped[formId]) grouped[formId] = {};
    const key = (attr.column_name as string) || `id_${attr.id}`;
    grouped[formId]![key] = attr.label as string;
  }

  // If resource filter, try to match form IDs
  // Common form IDs: 6=employee_manage, 7=employee_my_account
  if (args.resource) {
    const resourceLower = args.resource.toLowerCase();
    const filtered: Record<string, string> = {};

    for (const attr of attributes) {
      const label = (attr.label as string || "").toLowerCase();
      const column = (attr.column_name as string || "").toLowerCase();

      // Include if resource matches form context or label contains resource term
      if (
        column.includes(resourceLower) ||
        label.includes(resourceLower) ||
        // Employee forms: 6, 7, 8, 9
        (resourceLower === "employee" &&
          [6, 7, 8, 9].includes(attr.form_id as number)) ||
        // Client forms
        (resourceLower === "client" &&
          [10, 11].includes(attr.form_id as number))
      ) {
        const key = (attr.column_name as string) || `id_${attr.id}`;
        filtered[key] = attr.label as string;
      }
    }

    return {
      resource: args.resource,
      field_count: Object.keys(filtered).length,
      fields: filtered,
    };
  }

  return {
    total_attributes: attributes.length,
    by_form: Object.fromEntries(
      Object.entries(grouped).map(([formId, fields]) => [
        `form_${formId}`,
        { field_count: Object.keys(fields).length, fields },
      ])
    ),
  };
}

// ─── Tool 6: create_shift ───────────────────────────────────────

export interface CreateShiftArgs {
  project_id: number;
  name: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM (24h)
  duration_hours?: number; // alternative to end_time
  end_time?: string; // HH:MM (24h), alternative to duration_hours
  location_id: number;
  planner_id: number;
  break_start?: string; // HH:MM override
  break_end?: string; // HH:MM override
  skip_break?: boolean; // force no break even if law requires it
  function_id?: number; // if set, creates event function too
  quantity?: number; // positions needed (default 1)
  description?: string; // event description
  activate?: boolean; // activate event after creation (default true)
  descriptionField?: string; // field name for description (tenant-specific)
  breakRules?: "swiss" | "none"; // break rule set: "swiss" = ArG Art. 15, "none" = no auto-breaks
}

/**
 * Swiss Arbeitsgesetz (ArG Art. 15 Abs. 1) break calculation.
 *
 * Mandatory break durations based on working time:
 *   > 5.5 hours → 15 minutes
 *   > 7 hours   → 30 minutes
 *   > 9 hours   → 60 minutes
 *
 * Break is placed at the midpoint of the shift (centered).
 */
export function calculateSwissBreak(
  date: string,
  startTime: string,
  endTime: string
): { break_start: string; break_end: string; break_minutes: number; law_reference: string } | null {
  const start = new Date(`${date}T${startTime}:00`);
  let end = new Date(`${date}T${endTime}:00`);

  // Handle overnight shifts
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 3_600_000);
  }

  const totalHours = (end.getTime() - start.getTime()) / 3_600_000;

  let breakMinutes: number;
  let lawRef: string;

  if (totalHours > 9) {
    breakMinutes = 60;
    lawRef = "ArG Art. 15 Abs. 1: >9h Arbeitszeit → 1h Pause";
  } else if (totalHours > 7) {
    breakMinutes = 30;
    lawRef = "ArG Art. 15 Abs. 1: >7h Arbeitszeit → 30min Pause";
  } else if (totalHours > 5.5) {
    breakMinutes = 15;
    lawRef = "ArG Art. 15 Abs. 1: >5.5h Arbeitszeit → 15min Pause";
  } else {
    return null; // No break required
  }

  // Center break at shift midpoint
  const midpoint = start.getTime() + (end.getTime() - start.getTime()) / 2;
  const breakStart = new Date(midpoint - (breakMinutes / 2) * 60_000);
  const breakEnd = new Date(breakStart.getTime() + breakMinutes * 60_000);

  const fmt = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mo}-${dd} ${hh}:${mm}:00`;
  };

  return {
    break_start: fmt(breakStart),
    break_end: fmt(breakEnd),
    break_minutes: breakMinutes,
    law_reference: lawRef,
  };
}

/**
 * "Create a shift tomorrow at 07:00 for 9 hours"
 *
 * Creates an event with automatic Swiss labor law break calculation.
 * Optionally creates an event function (role/position) within the event.
 * Activates the event by default (status=2).
 *
 * Duration = total time at workplace (break inclusive).
 * So 9h shift = 8h work + 1h break (ArG >9h → 60min).
 */
export async function createShift(
  client: StaffCloudClient,
  args: CreateShiftArgs
): Promise<unknown> {
  // 1. Calculate end time
  let endTime: string;
  let endDate: string;

  if (args.end_time) {
    endTime = args.end_time;
    endDate = args.date;
    // Handle overnight
    if (args.end_time <= args.start_time) {
      const d = new Date(args.date + "T00:00:00");
      d.setDate(d.getDate() + 1);
      endDate = fmtDate(d);
    }
  } else if (args.duration_hours) {
    const start = new Date(`${args.date}T${args.start_time}:00`);
    const end = new Date(start.getTime() + args.duration_hours * 3_600_000);
    endDate = fmtDate(end);
    const hh = String(end.getHours()).padStart(2, "0");
    const mm = String(end.getMinutes()).padStart(2, "0");
    endTime = `${hh}:${mm}`;
  } else {
    throw new Error("Either 'duration_hours' or 'end_time' must be provided");
  }

  const startFull = `${args.date} ${args.start_time}:00`;
  const endFull = `${endDate} ${endTime}:00`;

  // 2. Calculate breaks (Swiss Arbeitsgesetz)
  let breakInfo: {
    break_start: string;
    break_end: string;
    break_minutes: number;
    law_reference: string;
  } | null = null;
  let breakApplied = false;

  if (args.break_start && args.break_end) {
    // User-provided break override
    breakInfo = {
      break_start: `${args.date} ${args.break_start}:00`,
      break_end: `${args.date} ${args.break_end}:00`,
      break_minutes: Math.round(
        (new Date(`${args.date}T${args.break_end}:00`).getTime() -
          new Date(`${args.date}T${args.break_start}:00`).getTime()) /
          60_000
      ),
      law_reference: "User override",
    };
    breakApplied = true;
  } else if (!args.skip_break && args.breakRules === "swiss") {
    // Auto-calculate per Swiss law (only when breakRules is "swiss")
    breakInfo = calculateSwissBreak(args.date, args.start_time, endTime);
    if (breakInfo) {
      breakApplied = true;
    }
  }

  // 3. Create the event
  const eventData: Record<string, unknown> = {
    project_id: args.project_id,
    planner_id: args.planner_id,
    location_id: args.location_id,
    name: args.name,
    start: startFull,
    end: endFull,
  };

  if (breakApplied && breakInfo) {
    eventData.break_start = breakInfo.break_start;
    eventData.break_end = breakInfo.break_end;
  }

  if (args.description && args.descriptionField) {
    eventData[args.descriptionField] = args.description;
  }

  const event = (await client.createEvent(eventData)) as AnyRecord;

  // 4. Activate the event (default: true)
  if (args.activate !== false) {
    await client.updateEvent(event.id as number, { status: 2 });
    event.status = 2;
  }

  // 5. Optionally create event function
  let eventFunction: AnyRecord | null = null;
  if (args.function_id) {
    eventFunction = (await client.createEventFunction({
      event_id: event.id,
      function_id: args.function_id,
      planner_id: args.planner_id,
      quantity: args.quantity || 1,
      start: startFull,
      end: endFull,
      ...(breakApplied && breakInfo
        ? {
            break_start: breakInfo.break_start,
            break_end: breakInfo.break_end,
          }
        : {}),
    })) as AnyRecord;
  }

  // 6. Calculate actual working time
  const totalHours = args.duration_hours ||
    (new Date(endFull).getTime() - new Date(startFull).getTime()) / 3_600_000;
  const breakHours = breakApplied && breakInfo ? breakInfo.break_minutes / 60 : 0;
  const workingHours = Math.round((totalHours - breakHours) * 100) / 100;

  return {
    event: {
      id: event.id,
      name: event.name,
      project_id: event.project_id,
      start: startFull,
      end: endFull,
      status: event.status,
      status_label: event.status === 2 ? "Active" : "Draft",
    },
    timing: {
      total_hours: totalHours,
      working_hours: workingHours,
      break_hours: breakHours,
    },
    break: breakApplied && breakInfo
      ? {
          start: breakInfo.break_start,
          end: breakInfo.break_end,
          minutes: breakInfo.break_minutes,
          law: breakInfo.law_reference,
        }
      : {
          applied: false,
          reason: args.skip_break
            ? "Skipped by user (skip_break=true)"
            : "No break required (shift ≤ 5.5h)",
        },
    event_function: eventFunction
      ? {
          id: eventFunction.id,
          function_id: eventFunction.function_id,
          quantity: eventFunction.quantity,
        }
      : null,
  };
}

// ─── Tool 7: resolve_field_value ────────────────────────────────

export interface ResolveFieldValueArgs {
  field: string; // e.g. "dynamic_field_44" or attribute ID
  value: string; // text label to resolve, e.g. "Switzerland"
}

/**
 * "I want to set dynamic_field_44 to Switzerland — what ID do I use?"
 *
 * Select/multi-select dynamic fields store collection value IDs, not text.
 * GET returns text labels, but PUT/POST needs the numeric ID.
 * This tool resolves text → ID by looking up the attribute's collection.
 *
 * Type mapping:
 *   type_id=13 → select (single value, needs collection value ID)
 *   type_id=14 → multi-select (array of IDs)
 *   type_id=15 → multi-select variant
 *   type_id=4  → text (no resolution needed)
 */
export async function resolveFieldValue(
  client: StaffCloudClient,
  args: ResolveFieldValueArgs
): Promise<unknown> {
  // 1. Find the attribute definition (cached)
  const attributes = (await client.listAttributesCached()) as AnyRecord[];

  // Match by column_name (dynamic_field_X) or attribute ID
  const fieldId = args.field.replace("dynamic_field_", "");
  const attr = attributes.find(
    (a) =>
      String(a.id) === fieldId ||
      a.column_name === args.field
  );

  if (!attr) {
    return { error: `Attribute "${args.field}" not found` };
  }

  const collectionId = attr.collection_id as number;
  const typeId = attr.type_id as number;

  // Text fields don't need resolution
  if (!collectionId || ![13, 14, 15].includes(typeId)) {
    return {
      field: args.field,
      attribute_id: attr.id,
      type: typeId === 4 ? "text" : `type_${typeId}`,
      message: "This field accepts text values directly, no ID resolution needed.",
      write_value: args.value,
    };
  }

  // 2. Fetch collection values
  const values = await client.listCollectionValues(collectionId);
  const valuesMap: Record<string, string> = {};

  // Collections return either {id: label} dict or [{id, name}] array
  if (Array.isArray(values)) {
    for (const v of values as AnyRecord[]) {
      valuesMap[String(v.id)] = v.name || v.label || String(v.id);
    }
  } else if (typeof values === "object" && values !== null) {
    for (const [id, label] of Object.entries(values as Record<string, string>)) {
      valuesMap[id] = label;
    }
  }

  // 3. Find matching value (case-insensitive)
  const searchLower = args.value.toLowerCase();
  const matches: Array<{ id: string; label: string; exact: boolean }> = [];

  for (const [id, label] of Object.entries(valuesMap)) {
    const labelLower = label.toLowerCase();
    if (labelLower === searchLower) {
      matches.push({ id, label, exact: true });
    } else if (labelLower.includes(searchLower) || searchLower.includes(labelLower)) {
      matches.push({ id, label, exact: false });
    }
  }

  if (matches.length === 0) {
    return {
      field: args.field,
      attribute_id: attr.id,
      collection_id: collectionId,
      error: `No match for "${args.value}" in collection ${collectionId}`,
      available_values: valuesMap,
    };
  }

  // Prefer exact match
  const best = matches.find((m) => m.exact) || matches[0]!;
  const writeValue = typeId === 14 || typeId === 15
    ? [parseInt(best.id, 10)] // multi-select: array of IDs
    : parseInt(best.id, 10);  // select: single ID

  return {
    field: args.field,
    attribute_id: attr.id,
    collection_id: collectionId,
    type: typeId === 13 ? "select" : "multi_select",
    resolved: {
      input: args.value,
      id: parseInt(best.id, 10),
      label: best.label,
      exact_match: best.exact,
    },
    write_value: writeValue,
    hint: `Use ${JSON.stringify(writeValue)} as the value when calling update_employee or create_employee for field "${args.field}"`,
    all_matches: matches.length > 1 ? matches : undefined,
  };
}

// ─── Tool 8: bulk_create_projects ────────────────────────────────

export interface BulkCreateProjectsArgs {
  projects: Array<Record<string, unknown>>;
  default_planner_id?: number;
  default_client_id?: number;
  dry_run?: boolean;
}

/**
 * "Import 15 projects from this Excel list"
 *
 * Creates multiple projects in sequence. Each project needs at minimum a
 * planner_id (can be set via default_planner_id for all). Returns a
 * mapping of project name → created ID for chaining into event creation.
 *
 * Continues on error — failed items are reported, not blocking.
 */
export async function bulkCreateProjects(
  client: StaffCloudClient,
  args: BulkCreateProjectsArgs
): Promise<unknown> {
  const results: Array<{
    index: number;
    status: "created" | "error";
    id?: number;
    name: string;
    error?: string;
  }> = [];

  // Apply defaults
  const projects = args.projects.map((p) => {
    const merged: Record<string, unknown> = { ...p };
    if (merged.planner_id == null && args.default_planner_id) {
      merged.planner_id = args.default_planner_id;
    }
    if (merged.client_id == null && args.default_client_id) {
      merged.client_id = args.default_client_id;
    }
    return merged;
  });

  if (args.dry_run) {
    return {
      dry_run: true,
      total: projects.length,
      preview: projects.map((p, i) => ({
        index: i,
        name: p.name,
        planner_id: p.planner_id,
        client_id: p.client_id,
      })),
    };
  }

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]!;
    const projectName = (project.name as string) || `Project ${i}`;
    try {
      const created = (await client.createProject(project)) as AnyRecord;
      results.push({
        index: i,
        status: "created",
        id: created.id as number,
        name: projectName,
      });
    } catch (error) {
      results.push({
        index: i,
        status: "error",
        name: projectName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const created = results.filter((r) => r.status === "created");
  const errors = results.filter((r) => r.status === "error");

  return {
    summary: {
      total: projects.length,
      created: created.length,
      errors: errors.length,
    },
    projects: results,
    // Convenience: name → id mapping for chaining into bulk_create_events
    id_mapping: Object.fromEntries(created.map((r) => [r.name, r.id])),
  };
}

// ─── Tool 9: bulk_create_events ──────────────────────────────────

export interface BulkCreateEventsArgs {
  events: Array<{
    project_id: number;
    name: string;
    date: string;
    start_time: string;
    end_time?: string;
    duration_hours?: number;
    location_id?: number;
    planner_id?: number;
    description?: string;
    break_start?: string;
    break_end?: string;
    skip_break?: boolean;
    activate?: boolean;
    function_id?: number;
    quantity?: number;
    [key: string]: unknown;
  }>;
  default_location_id?: number;
  default_planner_id?: number;
  default_activate?: boolean;
  default_function_id?: number;
  default_quantity?: number;
  descriptionField?: string;
  breakRules?: "swiss" | "none";
  dry_run?: boolean;
}

/**
 * "Create 80 events from this shift plan"
 *
 * Creates multiple events with automatic Swiss labor law break calculation.
 * Events are created sequentially (each takes ~2 API calls: create + activate).
 *
 * For large imports (>100 events), call this tool in batches of ~80-100
 * and provide user updates between calls.
 *
 * Returns an id_mapping of event name → created ID for chaining into
 * event function creation.
 */
export async function bulkCreateEvents(
  client: StaffCloudClient,
  args: BulkCreateEventsArgs
): Promise<unknown> {
  const defaultActivate = args.default_activate !== false;

  if (args.dry_run) {
    const preview = args.events.map((e, i) => {
      let endTime = e.end_time;

      if (!endTime && e.duration_hours) {
        const start = new Date(`${e.date}T${e.start_time}:00`);
        const end = new Date(start.getTime() + e.duration_hours * 3_600_000);
        endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
      }

      const breakCalc =
        !e.skip_break && args.breakRules === "swiss" && endTime
          ? calculateSwissBreak(e.date, e.start_time, endTime)
          : null;

      return {
        index: i,
        project_id: e.project_id,
        name: e.name,
        date: e.date,
        start: e.start_time,
        end: endTime || "?",
        break: breakCalc
          ? `${breakCalc.break_minutes}min (${breakCalc.law_reference})`
          : "none",
        location_id: e.location_id || args.default_location_id,
      };
    });

    return {
      dry_run: true,
      total: args.events.length,
      estimated_api_calls: args.events.length * 2,
      preview,
    };
  }

  const results: Array<{
    index: number;
    status: "created" | "error";
    id?: number;
    name: string;
    project_id: number;
    break_applied?: string;
    event_function_id?: number;
    event_function_error?: string;
    error?: string;
  }> = [];

  const startTime = Date.now();

  for (let i = 0; i < args.events.length; i++) {
    const e = args.events[i]!;
    try {
      // Calculate end time
      let endTime: string;
      let endDate: string;

      if (e.end_time) {
        endTime = e.end_time;
        endDate = e.date;
        if (e.end_time <= e.start_time) {
          const d = new Date(e.date + "T00:00:00");
          d.setDate(d.getDate() + 1);
          endDate = fmtDate(d);
        }
      } else if (e.duration_hours) {
        const start = new Date(`${e.date}T${e.start_time}:00`);
        const end = new Date(start.getTime() + e.duration_hours * 3_600_000);
        endDate = fmtDate(end);
        endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
      } else {
        throw new Error("Either 'end_time' or 'duration_hours' required");
      }

      const startFull = `${e.date} ${e.start_time}:00`;
      const endFull = `${endDate} ${endTime}:00`;

      // Calculate breaks (Swiss Arbeitsgesetz)
      let breakInfo: ReturnType<typeof calculateSwissBreak> = null;

      if (e.break_start && e.break_end) {
        breakInfo = {
          break_start: `${e.date} ${e.break_start}:00`,
          break_end: `${e.date} ${e.break_end}:00`,
          break_minutes: Math.round(
            (new Date(`${e.date}T${e.break_end}:00`).getTime() -
              new Date(`${e.date}T${e.break_start}:00`).getTime()) /
              60_000
          ),
          law_reference: "User override",
        };
      } else if (!e.skip_break && args.breakRules === "swiss") {
        breakInfo = calculateSwissBreak(e.date, e.start_time, endTime);
      }

      const eventData: Record<string, unknown> = {
        project_id: e.project_id,
        name: e.name,
        start: startFull,
        end: endFull,
      };

      const locationId = e.location_id || args.default_location_id;
      if (locationId) {
        eventData.location_id = locationId;
      }

      const plannerId = e.planner_id || args.default_planner_id;
      if (plannerId) {
        eventData.planner_id = plannerId;
      }

      if (breakInfo) {
        eventData.break_start = breakInfo.break_start;
        eventData.break_end = breakInfo.break_end;
      }

      if (e.description && args.descriptionField) {
        eventData[args.descriptionField] = e.description;
      }

      const created = (await client.createEvent(eventData)) as AnyRecord;

      // Activate if needed
      const activate = e.activate !== undefined ? e.activate : defaultActivate;
      if (activate) {
        await client.updateEvent(created.id as number, { status: 2 });
      }

      // Auto-create event function if function_id is provided
      const functionId = e.function_id ?? args.default_function_id;
      const quantity = e.quantity ?? args.default_quantity ?? 1;
      let eventFunctionId: number | undefined;

      if (functionId) {
        try {
          const efData: Record<string, unknown> = {
            event_id: created.id,
            function_id: functionId,
            planner_id: e.planner_id || args.default_planner_id,
            quantity,
            start: startFull,
            end: endFull,
          };
          if (breakInfo) {
            efData.break_start = breakInfo.break_start;
            efData.break_end = breakInfo.break_end;
          }
          const ef = (await client.createEventFunction(efData)) as AnyRecord;
          eventFunctionId = ef.id as number;
        } catch (efError) {
          // Event was created but function failed — report partial success
          results.push({
            index: i,
            status: "created",
            id: created.id as number,
            name: e.name,
            project_id: e.project_id,
            break_applied: breakInfo
              ? `${breakInfo.break_minutes}min`
              : undefined,
            event_function_error: efError instanceof Error ? efError.message : String(efError),
          });
          continue;
        }
      }

      results.push({
        index: i,
        status: "created",
        id: created.id as number,
        name: e.name,
        project_id: e.project_id,
        break_applied: breakInfo
          ? `${breakInfo.break_minutes}min`
          : undefined,
        event_function_id: eventFunctionId,
      });
    } catch (error) {
      results.push({
        index: i,
        status: "error",
        name: e.name,
        project_id: e.project_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  const created = results.filter((r) => r.status === "created");
  const errors = results.filter((r) => r.status === "error");
  const withFunctions = created.filter((r) => r.event_function_id);

  return {
    summary: {
      total: args.events.length,
      created: created.length,
      event_functions_created: withFunctions.length,
      errors: errors.length,
      elapsed_seconds: elapsedSeconds,
    },
    events: results,
    // Convenience: name → id mapping for chaining into bulk_create_event_functions
    id_mapping: Object.fromEntries(created.map((r) => [r.name, r.id])),
  };
}

// ─── Tool 10: bulk_create_event_functions ────────────────────────

export interface BulkCreateEventFunctionsArgs {
  event_functions: Array<{
    event_id: number;
    function_id?: number;
    planner_id?: number;
    quantity?: number;
    start?: string;
    end?: string;
    break_start?: string;
    break_end?: string;
    description?: string;
    [key: string]: unknown;
  }>;
  default_planner_id?: number;
  default_function_id?: number;
  dry_run?: boolean;
}

/**
 * "Now add the roles/positions to all those events"
 *
 * Creates event functions (roles/positions within events) one by one.
 * This is the slowest step — each call takes ~1-2 seconds.
 *
 * For large imports, call in batches of 20-30 and show the user progress
 * between batches. Estimated time: ~1.5s per item.
 *
 * Continues on error — reports all successes and failures.
 */
export async function bulkCreateEventFunctions(
  client: StaffCloudClient,
  args: BulkCreateEventFunctionsArgs
): Promise<unknown> {
  // Apply defaults
  const items = args.event_functions.map((ef) => ({
    ...ef,
    planner_id: ef.planner_id ?? args.default_planner_id,
    function_id: ef.function_id ?? args.default_function_id,
  }));

  if (args.dry_run) {
    return {
      dry_run: true,
      total: items.length,
      estimated_seconds: Math.round(items.length * 1.5),
      hint:
        items.length > 30
          ? `Consider calling in batches of 20-30 for progress updates (${Math.ceil(items.length / 25)} batches)`
          : "Small batch — can create all at once",
      preview: items.map((ef, i) => ({
        index: i,
        event_id: ef.event_id,
        function_id: ef.function_id,
        quantity: ef.quantity || 1,
        planner_id: ef.planner_id,
      })),
    };
  }

  const results: Array<{
    index: number;
    status: "created" | "error";
    id?: number;
    event_id: number;
    function_id: number;
    quantity?: number;
    error?: string;
  }> = [];

  const startTime = Date.now();

  for (let i = 0; i < items.length; i++) {
    const ef = items[i]!;
    try {
      const data: Record<string, unknown> = {
        event_id: ef.event_id,
        function_id: ef.function_id,
        planner_id: ef.planner_id,
        quantity: ef.quantity || 1,
      };

      if (ef.start) data.start = ef.start;
      if (ef.end) data.end = ef.end;
      if (ef.break_start) data.break_start = ef.break_start;
      if (ef.break_end) data.break_end = ef.break_end;
      if (ef.description) data.description = ef.description;

      const created = (await client.createEventFunction(data)) as AnyRecord;

      results.push({
        index: i,
        status: "created",
        id: created.id as number,
        event_id: ef.event_id as number,
        function_id: ef.function_id as number,
        quantity: (ef.quantity as number) || 1,
      });
    } catch (error) {
      results.push({
        index: i,
        status: "error",
        event_id: ef.event_id as number,
        function_id: ef.function_id as number,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  const created = results.filter((r) => r.status === "created");
  const errors = results.filter((r) => r.status === "error");

  return {
    summary: {
      total: items.length,
      created: created.length,
      errors: errors.length,
      elapsed_seconds: elapsedSeconds,
      avg_seconds_per_item:
        items.length > 0
          ? Math.round((elapsedSeconds / items.length) * 10) / 10
          : 0,
    },
    event_functions: results,
  };
}

// ─── Tool: bulk_update_event_functions ────────────────────────────

export interface BulkUpdateEventFunctionsArgs {
  event_functions: Array<{
    id: number;
    [key: string]: unknown;
  }>;
  dry_run?: boolean;
}

/**
 * Bulk update multiple event functions one by one.
 * Each item must include `id` plus any fields to update.
 * Continues on error — reports all successes and failures.
 */
export async function bulkUpdateEventFunctions(
  client: StaffCloudClient,
  args: BulkUpdateEventFunctionsArgs
): Promise<unknown> {
  if (args.dry_run) {
    return {
      dry_run: true,
      total: args.event_functions.length,
      preview: args.event_functions.map((ef, i) => ({
        index: i,
        id: ef.id,
        fields_to_update: Object.keys(ef).filter((k) => k !== "id"),
      })),
    };
  }

  const results: AnyRecord[] = [];
  const startTime = Date.now();

  for (let i = 0; i < args.event_functions.length; i++) {
    const ef = args.event_functions[i]!;
    const { id, ...data } = ef;
    try {
      await client.updateEventFunction(id, data as Record<string, unknown>);
      results.push({ index: i, status: "updated", id });
    } catch (error) {
      results.push({
        index: i,
        status: "error",
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  return {
    summary: {
      total: args.event_functions.length,
      updated: results.filter((r) => r.status === "updated").length,
      errors: results.filter((r) => r.status === "error").length,
      elapsed_seconds: elapsedSeconds,
    },
    event_functions: results,
  };
}

// ─── Tool: bulk_update_events ────────────────────────────────────

export interface BulkUpdateEventsArgs {
  events: Array<{
    id: number;
    [key: string]: unknown;
  }>;
  dry_run?: boolean;
}

/**
 * Bulk update multiple events one by one.
 * Each item must include `id` plus any fields to update.
 * Continues on error — reports all successes and failures.
 */
export async function bulkUpdateEvents(
  client: StaffCloudClient,
  args: BulkUpdateEventsArgs
): Promise<unknown> {
  if (args.dry_run) {
    return {
      dry_run: true,
      total: args.events.length,
      preview: args.events.map((e, i) => ({
        index: i,
        id: e.id,
        fields_to_update: Object.keys(e).filter((k) => k !== "id"),
      })),
    };
  }

  const results: AnyRecord[] = [];
  const startTime = Date.now();

  for (let i = 0; i < args.events.length; i++) {
    const e = args.events[i]!;
    const { id, ...data } = e;
    try {
      await client.updateEvent(id, data as Record<string, unknown>);
      results.push({ index: i, status: "updated", id });
    } catch (error) {
      results.push({
        index: i,
        status: "error",
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  return {
    summary: {
      total: args.events.length,
      updated: results.filter((r) => r.status === "updated").length,
      errors: results.filter((r) => r.status === "error").length,
      elapsed_seconds: elapsedSeconds,
    },
    events: results,
  };
}

// ─── Tool 11: get_staffing_gaps ──────────────────────────────────

export interface StaffingGapsArgs {
  date?: string;
  date_start?: string;
  date_end?: string;
}

/**
 * "Which events are understaffed?" / "Show me staffing gaps this week"
 *
 * Compares required positions (event function quantity) against actual
 * assignments (status 5/6/7) and returns events with unfilled positions.
 */
export async function getStaffingGaps(
  client: StaffCloudClient,
  args: StaffingGapsArgs
): Promise<unknown> {
  // Determine date range
  let dateStart: string;
  let dateEnd: string;

  if (args.date) {
    dateStart = args.date;
    dateEnd = args.date;
  } else if (args.date_start && args.date_end) {
    dateStart = args.date_start;
    dateEnd = args.date_end;
  } else {
    throw new Error("Either 'date' or both 'date_start' and 'date_end' must be provided");
  }

  const nextDay = getNextDay(dateEnd);

  // 1. Get active events in the date range
  const events = (await client.listEvents({
    start: `>=${dateStart} 00:00:00`,
    end: `<${nextDay} 00:00:00`,
    status: "2",
    fields: "id,name,project_id,start,end,location_id",
    sort: "start",
  })) as AnyRecord[];

  if (events.length === 0) {
    return {
      date_start: dateStart,
      date_end: dateEnd,
      event_count: 0,
      gaps: [],
      summary: { total_required: 0, total_assigned: 0, total_gap: 0 },
    };
  }

  const eventIds = events.map((e) => e.id).join(",");

  // 2+3. Fetch event functions and assignments in parallel
  const [eventFunctions, assignments] = await Promise.all([
    client.listEventFunctions({
      event_id: eventIds,
      fields: "id,event_id,function_id,quantity",
    }) as Promise<AnyRecord[]>,
    client.listAssignments({
      event_id: eventIds,
      status: "5,6,7",
      fields: "id,event_id,event_function_id",
    }) as Promise<AnyRecord[]>,
  ]);

  // Count assignments per event function
  const assignmentCounts: Record<number, number> = {};
  for (const a of assignments) {
    const efId = a.event_function_id as number;
    assignmentCounts[efId] = (assignmentCounts[efId] || 0) + 1;
  }

  // Also count by event_id for event-level summary
  const assignmentsByEvent: Record<number, number> = {};
  for (const a of assignments) {
    const eid = a.event_id as number;
    assignmentsByEvent[eid] = (assignmentsByEvent[eid] || 0) + 1;
  }

  // Build gaps by event
  const eventMap = new Map(events.map((e) => [e.id as number, e]));
  const gapsByEvent: Record<number, {
    event: AnyRecord;
    functions: Array<{
      event_function_id: number;
      function_id: number;
      required: number;
      assigned: number;
      gap: number;
    }>;
    total_required: number;
    total_assigned: number;
    total_gap: number;
  }> = {};

  for (const ef of eventFunctions) {
    const eventId = ef.event_id as number;
    const efId = ef.id as number;
    const required = (ef.quantity as number) || 0;
    const assigned = assignmentCounts[efId] || 0;
    const gap = required - assigned;

    if (gap <= 0) continue; // Fully staffed

    if (!gapsByEvent[eventId]) {
      gapsByEvent[eventId] = {
        event: eventMap.get(eventId) || { id: eventId },
        functions: [],
        total_required: 0,
        total_assigned: 0,
        total_gap: 0,
      };
    }

    gapsByEvent[eventId]!.functions.push({
      event_function_id: efId,
      function_id: ef.function_id as number,
      required,
      assigned,
      gap,
    });
    gapsByEvent[eventId]!.total_required += required;
    gapsByEvent[eventId]!.total_assigned += assigned;
    gapsByEvent[eventId]!.total_gap += gap;
  }

  // Sort by event start (soonest first), then by gap size
  const gaps = Object.values(gapsByEvent)
    .map((g) => ({
      event_id: g.event.id,
      event_name: g.event.name,
      project_id: g.event.project_id,
      start: g.event.start,
      end: g.event.end,
      location_id: g.event.location_id,
      fill_percentage: g.total_required > 0
        ? Math.round((g.total_assigned / g.total_required) * 100)
        : 100,
      total_required: g.total_required,
      total_assigned: g.total_assigned,
      total_gap: g.total_gap,
      functions: g.functions,
    }))
    .sort((a, b) => {
      const dateCompare = String(a.start).localeCompare(String(b.start));
      if (dateCompare !== 0) return dateCompare;
      return b.total_gap - a.total_gap;
    });

  const totalRequired = gaps.reduce((sum, g) => sum + g.total_required, 0);
  const totalAssigned = gaps.reduce((sum, g) => sum + g.total_assigned, 0);

  return {
    date_start: dateStart,
    date_end: dateEnd,
    event_count: events.length,
    events_with_gaps: gaps.length,
    gaps,
    summary: {
      total_required: totalRequired,
      total_assigned: totalAssigned,
      total_gap: totalRequired - totalAssigned,
      fill_percentage: totalRequired > 0
        ? Math.round((totalAssigned / totalRequired) * 100)
        : 100,
    },
  };
}

// ─── Tool 12: find_replacement ───────────────────────────────────

export interface FindReplacementArgs {
  event_id: number;
  function_id?: number;
  city?: string;
  qualification?: string;
}

/**
 * Swiss PLZ-based proximity scoring.
 * PLZ structure encodes geography:
 *   Same PLZ         → same town           → +15
 *   Same first 2 digits → neighboring area  → +10
 *   Same first digit    → same region       → +5
 */
function plzProximityScore(plzA?: string, plzB?: string): number {
  if (!plzA || !plzB) return 0;
  const a = plzA.trim();
  const b = plzB.trim();
  if (a.length < 4 || b.length < 4) return 0;
  if (a === b) return 15;
  if (a.slice(0, 2) === b.slice(0, 2)) return 10;
  if (a[0] === b[0]) return 5;
  return 0;
}

/**
 * "Who can step in for Event X?" / "Find a replacement for tomorrow's shift"
 *
 * Emergency tool for no-shows. Finds available employees, ranks them by:
 *   1. Qualification match against event roles (+100 exact, +50 partial)
 *   2. PLZ proximity to event location (+15/+10/+5)
 *   3. Employee ratings (+0-10)
 *
 * Excludes employees already assigned to the target event or busy that day.
 */
export async function findReplacement(
  client: StaffCloudClient,
  args: FindReplacementArgs,
  piiAccess = false
): Promise<unknown> {
  // 1. Get event details
  const event = (await client.getEvent(args.event_id)) as AnyRecord;
  const eventDate = (event.start as string).split(" ")[0]!;
  const nextDay = getNextDay(eventDate);

  // 2. Parallel fetch: employees, busy dates, same-day events,
  //    event functions (for role matching), event location (for PLZ)
  const locationId = event.location_id as number | undefined;
  const [employees, busyDates, sameDayEvents, eventFunctions, locationResult] =
    await Promise.all([
      client.listEmployees({
        status: "4",
        fields: piiAccess
          ? "id,firstname,lastname,city,zip,qualifications,mobile,email"
          : "id,firstname,lastname,city,zip,qualifications",
      }) as Promise<AnyRecord[]>,
      client.listBusyDates({
        start: `<=${eventDate} 23:59:59`,
        end: `>=${eventDate} 00:00:00`,
        fields: "id,employee_id",
      }) as Promise<AnyRecord[]>,
      client.listEvents({
        start: `>=${eventDate} 00:00:00`,
        end: `<${nextDay} 00:00:00`,
        status: "2",
        fields: "id",
      }) as Promise<AnyRecord[]>,
      // Fetch event functions to know which roles/qualifications the event needs
      client.listEventFunctions({
        event_id: String(args.event_id),
        fields: "id,function_id,shift_name",
      }) as Promise<AnyRecord[]>,
      // Fetch event location for PLZ proximity scoring
      locationId
        ? (client.listLocations({
            id: String(locationId),
            fields: "id,zip,city",
          }) as Promise<AnyRecord[]>)
        : Promise.resolve([] as AnyRecord[]),
    ]);

  const eventLocation = locationResult.length > 0 ? locationResult[0] : null;
  const eventPlz = eventLocation?.zip as string | undefined;

  // 3. Resolve function names for role matching
  const functionIds = [
    ...new Set(eventFunctions.map((ef) => ef.function_id as number).filter(Boolean)),
  ];
  let functionNames: string[] = [];
  if (functionIds.length > 0) {
    try {
      const functions = (await client.listFunctions({
        id: functionIds.join(","),
        fields: "id,name",
      })) as AnyRecord[];
      functionNames = functions.map((f) => String(f.name).toLowerCase());
    } catch {
      // Functions endpoint may not be available
    }
  }
  // Also include shift_name as role names
  for (const ef of eventFunctions) {
    if (ef.shift_name) {
      functionNames.push(String(ef.shift_name).toLowerCase());
    }
  }
  // Deduplicate
  const eventRoles = [...new Set(functionNames)];

  // 4. Build exclusion sets
  const busyEmployeeIds = new Set(
    busyDates.map((b) => b.employee_id as number)
  );

  // Get assignments for the TARGET event — exclude already assigned
  const targetEventAssignments = (await client.listAssignments({
    event_id: String(args.event_id),
    status: "1,2,3,4,5,6,7",
    fields: "id,employee_id",
  })) as AnyRecord[];
  const targetAssignedIds = new Set(
    targetEventAssignments.map((a) => a.employee_id as number)
  );

  // Get assignments for other same-day events — exclude double-booked
  const otherDayAssignedIds = new Set<number>();
  const otherDayEventIds = sameDayEvents
    .filter((e) => (e.id as number) !== args.event_id)
    .map((e) => e.id);
  if (otherDayEventIds.length > 0) {
    const assignments = (await client.listAssignments({
      event_id: otherDayEventIds.join(","),
      status: "5,6,7",
      fields: "id,employee_id",
    })) as AnyRecord[];
    for (const a of assignments) {
      otherDayAssignedIds.add(a.employee_id as number);
    }
  }

  // 5. Filter candidates: not busy, not on target event, not double-booked
  let candidates = employees.filter((e) => {
    const id = e.id as number;
    return (
      !busyEmployeeIds.has(id) &&
      !targetAssignedIds.has(id) &&
      !otherDayAssignedIds.has(id)
    );
  });

  // Optional hard filter by qualification
  const qualFilter = args.qualification?.toLowerCase();
  if (qualFilter) {
    candidates = candidates.filter((e) => {
      const quals = e.qualifications;
      if (!quals || typeof quals !== "object") return false;
      return Object.keys(quals).some((k) =>
        k.toLowerCase().includes(qualFilter)
      );
    });
  }

  // 6. Fetch ratings for candidates
  const ratingMap: Record<number, number> = {};
  if (candidates.length > 0) {
    try {
      const ratings = (await client.listRatings({
        employee_id: candidates.map((c) => c.id).join(","),
        fields: "id,employee_id,average",
      })) as AnyRecord[];
      for (const r of ratings) {
        const empId = r.employee_id as number;
        const avg = r.average as number;
        if (avg && (!ratingMap[empId] || avg > ratingMap[empId]!)) {
          ratingMap[empId] = avg;
        }
      }
    } catch {
      // Ratings may not be available — continue without them
    }
  }

  // 7. Score and rank candidates
  const scored = candidates.map((emp) => {
    let score = 0;
    const scoreBreakdown: string[] = [];

    // A) Qualification match against event roles (highest weight)
    const quals = emp.qualifications;
    if (quals && typeof quals === "object") {
      const empQualKeys = Object.keys(quals).map((k) => k.toLowerCase());

      if (qualFilter) {
        // User-specified qualification filter
        const hasExact = empQualKeys.some((k) => k === qualFilter);
        const hasPartial = !hasExact && empQualKeys.some((k) => k.includes(qualFilter));
        if (hasExact) {
          score += 100;
          scoreBreakdown.push(`+100 qualification match (${qualFilter})`);
        } else if (hasPartial) {
          score += 50;
          scoreBreakdown.push(`+50 partial qualification match (${qualFilter})`);
        }
      } else if (eventRoles.length > 0) {
        // Auto-match against event's roles/functions
        let bestRoleScore = 0;
        let bestRoleName = "";
        for (const role of eventRoles) {
          const exactMatch = empQualKeys.some((k) => k === role);
          if (exactMatch && 100 > bestRoleScore) {
            bestRoleScore = 100;
            bestRoleName = role;
          }
          const partialMatch = !exactMatch && empQualKeys.some((k) => k.includes(role) || role.includes(k));
          if (partialMatch && 50 > bestRoleScore) {
            bestRoleScore = 50;
            bestRoleName = role;
          }
        }
        if (bestRoleScore > 0) {
          score += bestRoleScore;
          scoreBreakdown.push(
            `+${bestRoleScore} ${bestRoleScore === 100 ? "exact" : "partial"} role match (${bestRoleName})`
          );
        }
      }
    }

    // B) PLZ proximity (Swiss postal code based)
    const empZip = emp.zip as string | undefined;
    const proximity = plzProximityScore(empZip, eventPlz);
    if (proximity > 0) {
      score += proximity;
      const label =
        proximity >= 15 ? "same town" : proximity >= 10 ? "neighboring area" : "same region";
      scoreBreakdown.push(`+${proximity} proximity (${label})`);
    }

    // C) Rating score (0-10 points)
    const rating = ratingMap[emp.id as number];
    if (rating) {
      const pts = Math.min(Math.round(rating), 10);
      score += pts;
      scoreBreakdown.push(`+${pts} rating (${rating})`);
    }

    const candidate: AnyRecord = {
      employee_id: emp.id,
      name: `${emp.firstname} ${emp.lastname}`,
      city: emp.city,
      qualifications: quals ? Object.keys(quals).join(", ") : "",
      rating: rating || null,
      score,
      score_breakdown: scoreBreakdown,
    };
    if (piiAccess) {
      candidate.mobile = emp.mobile;
      candidate.email = emp.email;
    }
    return candidate;
  });

  // Sort by score descending, take top 20
  scored.sort((a, b) => (b.score as number) - (a.score as number));
  const topCandidates = scored.slice(0, 20);

  return {
    event: {
      id: event.id,
      name: event.name,
      start: event.start,
      end: event.end,
      project_id: event.project_id,
      location_id: event.location_id,
      location_city: eventLocation?.city || null,
      location_plz: eventPlz || null,
      roles: eventRoles,
    },
    filters: {
      qualification: args.qualification || null,
      city: args.city || null,
    },
    excluded: {
      already_assigned: targetAssignedIds.size,
      busy: busyEmployeeIds.size,
      other_shifts: otherDayAssignedIds.size,
    },
    total_candidates: scored.length,
    showing: topCandidates.length,
    candidates: topCandidates,
  };
}

// ─── Tool 14: update_project_location ───────────────────────────

export interface UpdateProjectLocationArgs {
  project_ids: number[];
  location_id: number;
  include_event_functions?: boolean;
}

/**
 * "Change all Dreame events to Messe Zürich"
 *
 * Updates the location_id on all active events (and optionally event functions)
 * for the given project(s). Projects themselves do NOT have a location_id —
 * the location lives on events and event functions.
 */
export async function updateProjectLocation(
  client: StaffCloudClient,
  args: UpdateProjectLocationArgs
): Promise<unknown> {
  const { project_ids, location_id, include_event_functions = false } = args;

  // 1. Fetch all active events for the given projects
  const events = (await client.listEvents({
    project_id: project_ids.join(","),
    status: "2",
    fields: "id,name,project_id,location_id",
  })) as AnyRecord[];

  if (events.length === 0) {
    return {
      location_id,
      projects_queried: project_ids.length,
      events_updated: 0,
      event_functions_updated: 0,
      message: "No active events found for the given project(s).",
    };
  }

  // 2. Update all events in parallel
  const eventResults = await Promise.all(
    events.map((e) =>
      client
        .updateEvent(e.id as number, { location_id })
        .then(() => ({ id: e.id as number, name: e.name as string, status: "updated" as const }))
        .catch((err: Error) => ({ id: e.id as number, name: e.name as string, status: "failed" as const, error: err.message }))
    )
  );

  const eventsUpdated = eventResults.filter((r) => r.status === "updated").length;
  const eventsFailed = eventResults.filter((r) => r.status === "failed");

  // 3. Optionally update event functions too
  let efUpdated = 0;
  let efFailed: { id: number; error: string }[] = [];

  if (include_event_functions) {
    const eventIds = events.map((e) => e.id as number);
    const eventFunctions = (await client.listEventFunctions({
      event_id: eventIds.join(","),
      fields: "id,event_id,location_id",
    })) as AnyRecord[];

    if (eventFunctions.length > 0) {
      const efResults = await Promise.all(
        eventFunctions.map((ef) =>
          client
            .updateEventFunction(ef.id as number, { location_id })
            .then(() => ({ id: ef.id as number, status: "updated" as const }))
            .catch((err: Error) => ({ id: ef.id as number, status: "failed" as const, error: err.message }))
        )
      );

      efUpdated = efResults.filter((r) => r.status === "updated").length;
      efFailed = efResults
        .filter((r): r is { id: number; status: "failed"; error: string } => r.status === "failed")
        .map((r) => ({ id: r.id, error: r.error }));
    }
  }

  return {
    location_id,
    projects_queried: project_ids.length,
    total_events_found: events.length,
    events_updated: eventsUpdated,
    events_failed: eventsFailed.length > 0 ? eventsFailed : undefined,
    event_functions_updated: include_event_functions ? efUpdated : undefined,
    event_functions_failed: efFailed.length > 0 ? efFailed : undefined,
  };
}

// ─── Tool 15: get_planned_hours ──────────────────────────────────

export interface PlannedHoursArgs {
  date_start: string;
  date_end: string;
  project_id?: number;
  group_by?: "project" | "month" | "day";
  include_drafts?: boolean;
}

/**
 * "How many hours are planned for Q1?" / "What's our 2026 capacity?"
 *
 * Calculates PLANNED person-hours from scheduled events × event function
 * quantities. This is forward-looking (forecast), unlike get_work_hours_summary
 * which reads past actual logged hours from work-time records.
 *
 * Fetches events in the date range, then batch-fetches their event functions
 * (by event ID, not globally) to get staffing quantities. Each event function's
 * duration × quantity = person-hours for that role.
 *
 * Returns event-hours (raw shift time) and person-hours (duration × headcount).
 */
export async function getPlannedHours(
  client: StaffCloudClient,
  args: PlannedHoursArgs
): Promise<unknown> {
  // 1. Fetch events in date range
  const eventParams: QueryParams = {
    start: `>=${args.date_start} 00:00:00`,
    end: `<=${args.date_end} 23:59:59`,
    fields: "id,name,project_id,start,end,status",
    sort: "start",
  };
  if (!args.include_drafts) {
    eventParams.status = "2";
  }
  if (args.project_id) {
    eventParams.project_id = String(args.project_id);
  }

  const events = (await client.listEvents(eventParams)) as AnyRecord[];

  if (events.length === 0) {
    return {
      date_start: args.date_start,
      date_end: args.date_end,
      event_count: 0,
      total_event_hours: 0,
      total_person_hours: 0,
      groups: [],
    };
  }

  // 2. Batch-fetch event functions for matched events only (avoids global fetch)
  const eventIds = events.map((e) => e.id as number);
  const eventFunctions = (await client.listEventFunctions({
    event_id: eventIds.join(","),
    fields: "id,event_id,function_id,quantity,start,end",
  })) as AnyRecord[];

  // 3. Build event function lookup: event_id → [ef, ...]
  const efByEvent = new Map<number, AnyRecord[]>();
  for (const ef of eventFunctions) {
    const eid = ef.event_id as number;
    let arr = efByEvent.get(eid);
    if (!arr) { arr = []; efByEvent.set(eid, arr); }
    arr.push(ef);
  }

  // 4. Fetch project names for grouping
  const projectIds = [...new Set(events.map((e) => e.project_id as number).filter(Boolean))];
  const projectMap: Record<number, string> = {};
  if (projectIds.length > 0) {
    const projects = (await client.listProjects({
      id: projectIds.join(","),
      fields: "id,name",
    })) as AnyRecord[];
    for (const p of projects) {
      projectMap[p.id as number] = p.name as string;
    }
  }

  // 5. Calculate hours per event
  let totalEventHours = 0;
  let totalPersonHours = 0;
  let activeCount = 0;
  let draftCount = 0;

  interface EventHours {
    project_name: string;
    date: string;
    month: string;
    event_hours: number;
    person_hours: number;
    headcount: number;
  }

  const eventHoursList: EventHours[] = [];

  for (const event of events) {
    const evStart = new Date(event.start as string);
    const evEnd = new Date(event.end as string);
    const evHours = (evEnd.getTime() - evStart.getTime()) / 3_600_000;
    const date = (event.start as string).split(" ")[0]!;
    const month = date.substring(0, 7);

    if (event.status === 2) activeCount++;
    else draftCount++;

    const efs = efByEvent.get(event.id as number);
    let personHours = 0;
    let headcount = 0;

    if (efs && efs.length > 0) {
      for (const ef of efs) {
        const qty = (ef.quantity as number) || 1;
        const efStart = ef.start ? new Date(ef.start as string) : evStart;
        const efEnd = ef.end ? new Date(ef.end as string) : evEnd;
        const funcHours = (efEnd.getTime() - efStart.getTime()) / 3_600_000;
        personHours += funcHours * qty;
        headcount += qty;
      }
    } else {
      personHours = evHours;
      headcount = 1;
    }

    totalEventHours += evHours;
    totalPersonHours += personHours;

    eventHoursList.push({
      project_name: projectMap[event.project_id as number] || `Project #${event.project_id}`,
      date,
      month,
      event_hours: Math.round(evHours * 100) / 100,
      person_hours: Math.round(personHours * 100) / 100,
      headcount,
    });
  }

  // 6. Group results
  const groupBy = args.group_by || "project";

  type GroupEntry = { event_hours: number; person_hours: number; events: number; headcount_total: number };
  const groups = new Map<string, GroupEntry>();

  for (const eh of eventHoursList) {
    const key = groupBy === "project" ? eh.project_name
      : groupBy === "month" ? eh.month
      : eh.date;
    let g = groups.get(key);
    if (!g) { g = { event_hours: 0, person_hours: 0, events: 0, headcount_total: 0 }; groups.set(key, g); }
    g.event_hours += eh.event_hours;
    g.person_hours += eh.person_hours;
    g.events++;
    g.headcount_total += eh.headcount;
  }

  const groupedResults = [...groups.entries()]
    .map(([key, g]) => ({
      [groupBy]: key,
      events: g.events,
      event_hours: Math.round(g.event_hours * 100) / 100,
      person_hours: Math.round(g.person_hours * 100) / 100,
      avg_headcount: Math.round((g.headcount_total / g.events) * 10) / 10,
    }))
    .sort((a, b) => b.person_hours - a.person_hours);

  return {
    date_start: args.date_start,
    date_end: args.date_end,
    event_count: events.length,
    active_events: activeCount,
    draft_events: draftCount,
    total_event_hours: Math.round(totalEventHours * 100) / 100,
    total_person_hours: Math.round(totalPersonHours * 100) / 100,
    multiplier: totalEventHours > 0 ? Math.round((totalPersonHours / totalEventHours) * 10) / 10 : 0,
    group_by: groupBy,
    groups: groupedResults,
  };
}
