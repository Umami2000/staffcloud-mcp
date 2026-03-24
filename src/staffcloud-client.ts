/**
 * StaffCloud API Client
 *
 * Handles all HTTP communication with the StaffCloud REST API.
 * Supports filtering, field selection, sorting, retry with exponential
 * backoff, rate-limit awareness, request timeouts, and all CRUD operations.
 */

export interface StaffCloudConfig {
  baseUrl: string; // e.g. "https://yourcompany.staff.cloud/api/v1"
  apiKey: string; // Bearer JWT token
  maxRetries?: number; // default 3
  timeoutMs?: number; // default 30000
}

export interface QueryParams {
  fields?: string;
  sort?: string;
  embed?: string;
  [key: string]: string | string[] | undefined;
}

export interface ApiError {
  code: string;
  message: string;
  description?: string;
  validationErrors?: Record<string, string[]>;
}

export interface RateLimitInfo {
  remaining: number | null;
  limit: number | null;
  reset: number | null; // seconds until reset
}

export class StaffCloudClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private timeoutMs: number;
  private _attributeCache: { data: unknown[]; fetchedAt: number } | null = null;
  private _rateLimitInfo: RateLimitInfo = {
    remaining: null,
    limit: null,
    reset: null,
  };

  constructor(config: StaffCloudConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    // Strip "Bearer " prefix if present — some MCP clients add it automatically
    this.apiKey = config.apiKey.replace(/^Bearer\s+/i, "");
    this.maxRetries = config.maxRetries ?? 3;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  get rateLimitInfo(): RateLimitInfo {
    return { ...this._rateLimitInfo };
  }

  private async request<T>(
    method: string,
    path: string,
    params?: QueryParams,
    body?: unknown
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === "") continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            url.searchParams.append(key, v);
          }
        } else {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };

    if (body && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Exponential backoff: 1s, 2s, 4s
      if (attempt > 0) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method,
          headers,
          body:
            body && (method === "POST" || method === "PUT")
              ? JSON.stringify(body)
              : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        // Network error or timeout — retry
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(
            `Request timeout after ${this.timeoutMs}ms: ${method} ${path}`
          );
        } else {
          lastError =
            error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < this.maxRetries) continue;
        throw lastError;
      }

      clearTimeout(timeoutId);

      // Track rate limit headers
      const remaining = response.headers.get("X-Rate-Limit-Remaining");
      const limit = response.headers.get("X-Rate-Limit-Limit");
      const reset = response.headers.get("X-Rate-Limit-Reset");
      if (remaining !== null)
        this._rateLimitInfo.remaining = parseInt(remaining, 10);
      if (limit !== null) this._rateLimitInfo.limit = parseInt(limit, 10);
      if (reset !== null) this._rateLimitInfo.reset = parseInt(reset, 10);

      // Retry on 429 (rate limited) or 5xx (server error)
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(
          `StaffCloud API ${response.status}: ${response.statusText}`
        );
        if (attempt < this.maxRetries) continue;
        throw lastError;
      }

      // Success: no content
      if (response.status === 204) {
        return { success: true, status: 204 } as T;
      }

      // Cache hit
      if (response.status === 304) {
        return { notModified: true, status: 304 } as T;
      }

      const data = await response.json();

      // Client errors (4xx) — don't retry
      if (!response.ok) {
        const error = data as ApiError;
        throw new Error(
          `StaffCloud API ${response.status}: ${error.message || response.statusText}` +
            (error.validationErrors
              ? `\nValidation: ${JSON.stringify(error.validationErrors)}`
              : "") +
            (error.description ? `\n${error.description}` : "")
        );
      }

      return data as T;
    }

    throw lastError || new Error("Max retries exceeded");
  }

  // ─── Employees ──────────────────────────────────────────────

  async listEmployees(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/employees", params);
  }

  async getEmployee(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/employees/${id}`,
      params
    );
  }

  async createEmployee(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/employees",
      {},
      data
    );
  }

  async updateEmployee(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/employees/${id}`,
      {},
      data
    );
  }

  async deleteEmployee(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/employees/${id}`
    );
  }

  // ─── Clients ────────────────────────────────────────────────

  async listClients(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/clients", params);
  }

  async getClient(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/clients/${id}`,
      params
    );
  }

  async createClient(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/clients", {}, data);
  }

  async updateClient(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/clients/${id}`,
      {},
      data
    );
  }

  async deleteClient(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/clients/${id}`
    );
  }

  // ─── Contacts ───────────────────────────────────────────────

  async listContacts(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/contacts", params);
  }

  async getContact(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/contacts/${id}`,
      params
    );
  }

  async createContact(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/contacts",
      {},
      data
    );
  }

  async updateContact(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/contacts/${id}`,
      {},
      data
    );
  }

  async deleteContact(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/contacts/${id}`
    );
  }

  // ─── Assignments ────────────────────────────────────────────

  async listAssignments(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/assignments", params);
  }

  async getAssignment(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/assignments/${id}`,
      params
    );
  }

  async getAssignmentStatusMap(
    id: number
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/assignments/${id}/status-map`
    );
  }

  async getAssignmentTeamsheet(
    id: number
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/assignments/${id}/teamsheet`
    );
  }

  async getAssignmentOpenActions(
    id: number
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/assignments/${id}/open-actions`
    );
  }

  async updateAssignmentStatus(
    id: number,
    status: number
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/assignments/${id}/status`,
      {},
      { status }
    );
  }

  async bulkUpdateAssignmentStatus(
    status: number,
    remarks?: string
  ): Promise<unknown> {
    return this.request<unknown>("PUT", "/assignments/status", {}, {
      status,
      ...(remarks ? { remarks } : {}),
    });
  }

  // ─── Busy Dates (Vacation/Leave) ───────────────────────────

  async listBusyDates(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/busy-dates", params);
  }

  async createBusyDate(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/busy-dates",
      {},
      data
    );
  }

  async updateBusyDate(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/busy-dates/${id}`,
      {},
      data
    );
  }

  async deleteBusyDate(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/busy-dates/${id}`
    );
  }

  // ─── Check-ins ──────────────────────────────────────────────

  async listCheckins(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/checkins", params);
  }

  async createCheckin(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/checkins",
      {},
      data
    );
  }

  async deleteCheckin(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/checkins/${id}`
    );
  }

  // ─── Projects ───────────────────────────────────────────────

  async listProjects(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/projects", params);
  }

  async getProject(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/projects/${id}`,
      params
    );
  }

  async createProject(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/projects",
      {},
      data
    );
  }

  async updateProject(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/projects/${id}`,
      {},
      data
    );
  }

  // ─── Events ─────────────────────────────────────────────────

  async listEvents(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/events", params);
  }

  async getEvent(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/events/${id}`,
      params
    );
  }

  async createEvent(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/events", {}, data);
  }

  async updateEvent(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/events/${id}`,
      {},
      data
    );
  }

  // ─── Messages ───────────────────────────────────────────────

  async listMessages(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/messages", params);
  }

  async sendMessage(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/messages",
      {},
      data
    );
  }

  // ─── Webhooks ───────────────────────────────────────────────

  async listWebhooks(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/webhooks", params);
  }

  async createWebhook(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/webhooks",
      {},
      data
    );
  }

  async updateWebhook(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/webhooks/${id}`,
      {},
      data
    );
  }

  async deleteWebhook(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/webhooks/${id}`
    );
  }

  // ─── Forms & Attributes ─────────────────────────────────────

  async listForms(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/forms", params);
  }

  async listAttributes(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/attributes", params);
  }

  /** Cached version of listAttributes with 5-minute TTL. Use for smart tools. */
  async listAttributesCached(): Promise<unknown[]> {
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    if (
      this._attributeCache &&
      Date.now() - this._attributeCache.fetchedAt < CACHE_TTL_MS
    ) {
      return this._attributeCache.data;
    }
    const data = await this.listAttributes();
    this._attributeCache = { data, fetchedAt: Date.now() };
    return data;
  }

  // ─── Employee State ─────────────────────────────────────────

  async setEmployeeState(
    id: number,
    state: number
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      `/employees/${id}/state/${state}`
    );
  }

  // ─── Automations ────────────────────────────────────────────

  async listAutomations(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/automations", params);
  }

  // ─── Wage Profiles & Types ──────────────────────────────────

  async listWageProfiles(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/wage-profiles", params);
  }

  async listWageTypes(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/wage-types", params);
  }

  // ─── Work Times ─────────────────────────────────────────────

  async listWorkTimes(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/work-times", params);
  }

  // ─── Planners ───────────────────────────────────────────────

  async listPlanners(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/planners", params);
  }

  // ─── Locations ──────────────────────────────────────────────

  async listLocations(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/locations", params);
  }

  // ─── Languages ──────────────────────────────────────────────

  async listLanguages(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/languages", params);
  }

  // ─── Settings ───────────────────────────────────────────────

  async listSettings(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/settings", params);
  }

  // ─── Ratings ────────────────────────────────────────────────

  async listRatings(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/ratings", params);
  }

  // ─── Availability Requests ──────────────────────────────────

  async listAvailabilityRequests(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/availability-requests", params);
  }

  // ─── Event Functions ──────────────────────────────────────────

  async listEventFunctions(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/event-functions", params);
  }

  async getEventFunction(
    id: number,
    params?: QueryParams
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/event-functions/${id}`,
      params
    );
  }

  async createEventFunction(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/event-functions",
      {},
      data
    );
  }

  async updateEventFunction(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/event-functions/${id}`,
      {},
      data
    );
  }

  async deleteEventFunction(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/event-functions/${id}`
    );
  }

  // ─── Functions (templates) ──────────────────────────────────

  async listFunctions(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/functions", params);
  }

  async createFunction(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      "/functions",
      {},
      data
    );
  }

  async updateFunction(
    id: number,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/functions/${id}`,
      {},
      data
    );
  }

  // ─── Ratings / Criteria ─────────────────────────────────────

  async listRatingCriteria(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/ratings/criteria", params);
  }

  // ─── Collections (reference data values) ──────────────────────

  async listCollectionValues(collectionId: number, params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/collections/${collectionId}/values`, params);
  }

  async createCollectionValue(collectionId: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/collections/${collectionId}/value`, {}, data);
  }

  async updateCollectionValue(collectionId: number, valueId: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("PUT", `/collections/${collectionId}/value/${valueId}`, {}, data);
  }

  // ─── External Staff Requests ────────────────────────────────

  async listExternalStaffRequests(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/external-staff-requests", params);
  }

  async getExternalStaffRequest(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/external-staff-requests/${id}`, params);
  }

  async createExternalStaffRequest(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/external-staff-requests", {}, data);
  }

  async updateExternalStaffRequest(id: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("PUT", `/external-staff-requests/${id}`, {}, data);
  }

  async deleteExternalStaffRequest(id: number): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>("DELETE", `/external-staff-requests/${id}`);
  }

  // ─── External Workers ─────────────────────────────────────

  async listExternalWorkers(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/external-workers", params);
  }

  async getExternalWorker(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/external-workers/${id}`, params);
  }

  async createExternalWorker(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/external-workers", {}, data);
  }

  async updateExternalWorker(id: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("PUT", `/external-workers/${id}`, {}, data);
  }

  // ─── Files ────────────────────────────────────────────────

  async listFiles(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/files", params);
  }

  async getFile(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/files/${id}`, params);
  }

  async deleteFile(id: number): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>("DELETE", `/files/${id}`);
  }

  // ─── Employee Pictures ────────────────────────────────────

  async listEmployeePictures(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/employee-pictures", params);
  }

  async getEmployeePicture(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/employee-pictures/${id}`, params);
  }

  async deleteEmployeePicture(id: number): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>("DELETE", `/employee-pictures/${id}`);
  }

  // ─── Special Dates ────────────────────────────────────────

  async listSpecialDates(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/special-dates", params);
  }

  async getSpecialDate(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/special-dates/${id}`, params);
  }

  async createSpecialDate(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/special-dates", {}, data);
  }

  async updateSpecialDate(id: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("PUT", `/special-dates/${id}`, {}, data);
  }

  async deleteSpecialDate(id: number): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>("DELETE", `/special-dates/${id}`);
  }

  // ─── Pay Runs & Pay Lines ─────────────────────────────────

  async listPayRuns(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/pay-runs", params);
  }

  async getPayRun(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/pay-runs/${id}`, params);
  }

  async listPayLines(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/pay-lines", params);
  }

  async getPayLine(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/pay-lines/${id}`, params);
  }

  // ─── Time Slots ───────────────────────────────────────────

  async listTimeSlots(params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/time-slots", params);
  }

  async getTimeSlot(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/time-slots/${id}`, params);
  }

  // ─── Assignment Sub-Resources ─────────────────────────────

  async getAssignmentWages(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/wages`);
  }

  async getAssignmentPaysheets(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/paysheets`);
  }

  async getAssignmentWorkTimes(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/work-times`);
  }

  async getAssignmentConfigurations(id: number): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/assignments/${id}/configurations`);
  }

  async getAssignmentWorkTimeProposals(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/work-time-proposals`);
  }

  async getAssignmentWageProposals(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/wage-proposals`);
  }

  async getAssignmentLivestamps(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/livestamps`);
  }

  async getAssignmentReportingForms(id: number): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/assignments/${id}/reporting-forms`);
  }

  // ─── Employee Availability ────────────────────────────────

  async getEmployeeAvailabilities(id: number, params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/employees/${id}/availabilities`, params);
  }

  async getEmployeeAvailabilityRequests(id: number, params?: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/employees/${id}/availability-requests`, params);
  }

  // ─── Read-by-ID for reference resources ───────────────────

  async getAttribute(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/attributes/${id}`, params);
  }

  async getForm(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/forms/${id}`, params);
  }

  async getPlanner(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/planners/${id}`, params);
  }

  async getWageProfile(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/wage-profiles/${id}`, params);
  }

  async getWageType(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/wage-types/${id}`, params);
  }

  async getBusyDate(id: number, params?: QueryParams): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/busy-dates/${id}`, params);
  }

  // ─── Rating Create ──────────────────────────────────────────

  async createRating(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/ratings", {}, data);
  }

  // ─── Project/Event Delete ───────────────────────────────────

  async deleteProject(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/projects/${id}`
    );
  }

  async deleteEvent(
    id: number
  ): Promise<{ success: boolean; status: number }> {
    return this.request<{ success: boolean; status: number }>(
      "DELETE",
      `/events/${id}`
    );
  }
}
