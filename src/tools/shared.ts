/**
 * Shared utilities used by all tool modules.
 */

import { z } from "zod";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { QueryParams } from "../staffcloud-client.js";
import { formatSwissPhone } from "../smart-tools.js";

// ─── Zod Fragments ──────────────────────────────────────────────

export const zId = z.coerce.number().int().positive();
export const zFields = z.string().optional();
export const zSort = z.string().optional();
export const zFilter = z.string().optional();
export const zData = z.record(z.string(), z.unknown());
export const zListParams = z
  .object({ fields: zFields, sort: zSort, filter: zFilter })
  .passthrough();

// ─── Validation ─────────────────────────────────────────────────

export function validate<T>(
  schema: z.ZodType<T>,
  args: unknown,
  toolName: string
): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid parameters for ${toolName}: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ")}`
    );
  }
  return result.data;
}

// ─── Parameter Building ─────────────────────────────────────────

export function buildParams(args: Record<string, unknown>): QueryParams {
  const params: QueryParams = {};

  if (args["fields"]) params.fields = String(args["fields"]);
  if (args["sort"]) params.sort = String(args["sort"]);
  if (args["status"]) params.status = String(args["status"]);
  if (args["embed"]) params.embed = String(args["embed"]);

  if (args["updated_since"]) {
    params["updated_at"] = `>${String(args["updated_since"])}`;
  }

  if (args["filter"]) {
    const filterStr = String(args["filter"]);
    for (const part of filterStr.split("&")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        const key = part.substring(0, eqIdx);
        // Block filters on PII fields to prevent boolean oracle attacks
        // (e.g. "email=~john" could be used to infer email addresses)
        if (SENSITIVE_FIELDS.has(key)) continue;
        const value = part.substring(eqIdx + 1);
        params[key] = value;
      }
    }
  }

  return params;
}

// ─── PII / Sensitive Field Filtering ────────────────────────────

/**
 * Fields classified as sensitive personal data (PII).
 * These are blocked from employee API requests when piiAccess is false,
 * and stripped from smart tool outputs.
 *
 * Planning-safe fields (always allowed):
 *   id, firstname, lastname, status, city, qualifications,
 *   communication_language, wage_profile_id, created_at, updated_at
 */
export const SENSITIVE_FIELDS = new Set([
  "email",
  "mobile",
  "phone",
  "telephone",
  "birthday",
  "gender",
  "address_first",
  "address_second",
  "zip",
  "country",
  "last_active_at",
  "social_insurance_number",
  "ahv_number",
  "bank_account",
  "iban",
]);

/**
 * Default safe fields to request when no explicit `fields` param is given
 * and piiAccess is false. Covers everything needed for scheduling.
 */
const SAFE_EMPLOYEE_FIELDS =
  "id,firstname,lastname,status,city,qualifications,communication_language,wage_profile_id,created_at,updated_at";

/**
 * Filter a `fields` parameter to remove sensitive field names.
 * If fields is undefined/empty and piiAccess is false, returns a safe default.
 */
export function filterEmployeeFields(
  fields: string | undefined,
  piiAccess: boolean
): string | undefined {
  if (piiAccess) return fields; // no filtering

  if (!fields) {
    // No fields specified → inject safe default instead of returning all 136
    return SAFE_EMPLOYEE_FIELDS;
  }

  // Filter out sensitive fields from user's explicit request
  const requested = fields.split(",").map((f) => f.trim());
  const filtered = requested.filter((f) => !SENSITIVE_FIELDS.has(f));
  return filtered.length > 0 ? filtered.join(",") : SAFE_EMPLOYEE_FIELDS;
}

/**
 * Strip PII keys from a plain object (shallow).
 * Used for smart tool outputs where we build custom result objects.
 */
export function stripPii(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key)) continue; // omit entirely
    cleaned[key] = value;
  }
  return cleaned;
}

// ─── Result Formatting ──────────────────────────────────────────

export function formatResult(data: unknown, limit?: number): string {
  if (Array.isArray(data)) {
    const items = limit ? data.slice(0, limit) : data;
    return JSON.stringify(
      { count: data.length, showing: items.length, data: items },
      null,
      2
    );
  }
  return JSON.stringify(data, null, 2);
}

// ─── Qualification Auto-Resolution ──────────────────────────────

/**
 * Auto-resolve qualification names to function IDs in employee data.
 *
 * The StaffCloud API returns qualifications as {"Promoter": true, "Teamleader": true}
 * but WRITES require numeric function IDs: {"3": true, "2": false}.
 *
 * IMPORTANT: The API treats omitted qualifications as "no change". To REMOVE
 * a qualification, you must explicitly send {id: false}. This function handles
 * that by fetching all available functions and setting unmentioned ones to false.
 *
 * Handles three input formats:
 *   - Name→boolean object: {"Promoter": true, "Teamleader": false}  → resolved to IDs
 *   - ID→boolean object:   {"3": true, "2": false}                  → passed through
 *   - Array of IDs:         [3]                                      → converted to object
 */
export async function resolveQualifications(
  data: Record<string, unknown>,
  client: { listFunctions(params?: QueryParams): Promise<unknown[]> }
): Promise<Record<string, unknown>> {
  const quals = data.qualifications;
  if (!quals || typeof quals !== "object") return data;

  // Fetch all available functions for resolution
  const functions = (await client.listFunctions({
    fields: "id,name",
  })) as { id: number; name: string }[];

  const nameToId: Record<string, number> = {};
  for (const fn of functions) {
    nameToId[fn.name.toLowerCase()] = fn.id;
  }
  const allFunctionIds = functions.map((f) => f.id);

  // Handle array format: [3, 5] → keep those, remove everything else
  if (Array.isArray(quals)) {
    const keepIds = new Set((quals as unknown[]).map(Number));
    const resolved: Record<string, boolean> = {};
    for (const id of allFunctionIds) {
      resolved[String(id)] = keepIds.has(id);
    }
    return { ...data, qualifications: resolved };
  }

  const entries = Object.entries(quals as Record<string, unknown>);
  if (entries.length === 0) return data;

  // Check if keys are already numeric IDs
  const allNumeric = entries.every(([k]) => /^\d+$/.test(k));

  if (allNumeric) {
    // Already ID-based — fill in missing IDs as false so removals work
    const specified = new Set(entries.map(([k]) => Number(k)));
    const resolved: Record<string, boolean> = {};
    for (const id of allFunctionIds) {
      if (specified.has(id)) {
        resolved[String(id)] = entries.find(([k]) => Number(k) === id)![1] === true;
      } else {
        resolved[String(id)] = false;
      }
    }
    return { ...data, qualifications: resolved };
  }

  // Name-based — resolve names to IDs
  // Mentioned names with true → keep, mentioned with false → remove
  // Unmentioned → remove (user specified the full desired set)
  const keepIds = new Set<number>();
  for (const [name, value] of entries) {
    const id = nameToId[name.toLowerCase()];
    if (id !== undefined && value === true) {
      keepIds.add(id);
    }
  }

  const resolved: Record<string, boolean> = {};
  for (const id of allFunctionIds) {
    resolved[String(id)] = keepIds.has(id);
  }

  return { ...data, qualifications: resolved };
}

// ─── Phone Auto-Formatting ──────────────────────────────────────

export function autoFormatPhones(
  data: Record<string, unknown>,
  phoneFormat: "swiss" | "none" = "none"
): Record<string, unknown> {
  if (phoneFormat !== "swiss") return data; // no formatting unless explicitly Swiss
  const phoneFields = ["mobile", "phone", "telephone", "_dyn_attr_20"];
  const result = { ...data };
  for (const field of phoneFields) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = formatSwissPhone(result[field] as string);
    }
  }
  return result;
}
