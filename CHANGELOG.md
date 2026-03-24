# Changelog

## 1.0.0 (2026-03-19)

### Features
- **119 tools** covering the full StaffCloud REST API across 5 loadable modules
- **13 smart composite tools** for common business operations:
  - `get_staff_schedule` — complete schedule for a date or event in one call
  - `find_available_staff` — availability check with busy-date and assignment cross-reference
  - `get_employee_profile` — human-readable profile with resolved custom field labels
  - `get_work_hours_summary` — aggregated hours by employee, event, or day
  - `get_field_definitions` — dynamic field ID to label lookup
  - `create_shift` — event + function creation with Swiss break auto-calculation
  - `resolve_field_value` — text label to collection value ID resolution
  - `format_phone` — Swiss E.164 phone formatting
  - `get_staffing_gaps` — understaffed shift detection
  - `find_replacement` — emergency no-show candidate ranking
  - `bulk_create_projects` — batch project creation with error continuation
  - `bulk_create_events` — batch event creation with break calculation
  - `bulk_create_event_functions` — batch event function creation
- **Modular architecture** — 5 modules (core, setup, ops, admin, reference) loaded via env var
- **PII protection** — sensitive employee data blocked by default
- **Interactive setup wizard** with connection validation and smoke test
- **Retry with exponential backoff** for 429/5xx responses (3 retries, 1s/2s/4s)
- **Rate limit awareness** — tracks X-Rate-Limit-Remaining header, warns when low
- **Request timeout** handling (30s default)
- **Zod input validation** on all tool parameters
- **Swiss labor law compliance** — automatic break calculation per ArG Art. 15
