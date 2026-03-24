# staffcloud-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2.svg)](https://modelcontextprotocol.io)

An open-source [MCP server](https://modelcontextprotocol.io) that connects AI assistants to the [StaffCloud](https://www.staff.cloud/) API. **119 tools** across 5 modules — manage employees, scheduling, assignments, and more through natural language.

Works with Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

```
"Who's working the festival this Saturday?"
"Find me 3 available bartenders for Friday night"
"Create 12 shifts for next week's conference, with Swiss break rules"
```

---

## What's inside

**119 tools** organized into 5 loadable modules. Pick what you need — default is `core` (27 tools), which covers 90% of daily operations.

| Module | Tools | Covers |
|--------|------:|--------|
| **core** | 27 | Employees, projects, events, assignments, smart scheduling |
| **setup** | 22 | Clients, contacts, event functions, locations, bulk import |
| **ops** | 26 | Assignment details, check-ins, busy dates, ratings, work hours |
| **admin** | 26 | Webhooks, messages, external staff, files, special dates |
| **reference** | 18 | Settings, planners, languages, wage profiles, pay runs |

### Smart tools

13 composite tools that handle real staffing workflows in a single call — orchestrating multiple API requests behind the scenes:

| Tool | What it does |
|------|-------------|
| `get_staff_schedule` | Full schedule for a date, event, or employee — names, roles, times, all resolved |
| `find_available_staff` | Cross-checks employees against busy dates and existing assignments |
| `get_staffing_gaps` | Finds understaffed shifts by comparing required positions vs assigned staff |
| `find_replacement` | Ranks available candidates when someone calls in sick |
| `create_shift` | Creates event + function with automatic Swiss break calculation (ArG Art. 15) |
| `bulk_create_events` | Import hundreds of shifts with break rules baked in |
| `bulk_create_projects` | Batch project creation with error handling and ID mapping |
| `bulk_create_event_functions` | Batch creation of event functions |
| `get_employee_profile` | Human-readable profile with custom field labels resolved |
| `get_work_hours_summary` | Aggregated hours by employee, event, or day |
| `resolve_field_value` | Resolves text labels (e.g. "Zürich") to collection value IDs |
| `get_field_definitions` | Maps `dynamic_field_49` → human-readable field name |
| `format_phone` | Swiss E.164 phone formatting |

---

## Safety & risk levels

Every tool that writes, modifies, or deletes data includes a risk indicator in its description. The AI assistant is instructed to ask for confirmation before executing anything destructive.

| Risk level | Prefix | What it means | AI behavior |
|:----------:|--------|---------------|-------------|
| Safe | *(none)* | Read-only — lists and gets | Executes freely |
| Write | `⚠️ MODIFIES DATA` | Updates existing records | Confirms with user before executing |
| Bulk Write | `⚠️ BULK WRITE` | Creates or updates many records at once | Runs dry_run first, then confirms |
| Communication | `⚠️ SENDS COMMUNICATION` | Sends real messages to real people | Confirms recipient, content, and channel |
| State Change | `⚠️ STATE / STATUS CHANGE` | Changes employee or assignment lifecycle status | Confirms and explains the impact |
| Destructive | `⛔ DESTRUCTIVE` | Permanently deletes data — cannot be undone | Always confirms, suggests safer alternatives |
| Critical | `⛔ EXTREMELY DANGEROUS` | Affects the entire StaffCloud instance | Requires explicit confirmation and explanation |

### Destructive operations — what gets deleted

These tools permanently remove data. There is no trash, no undo, no recovery.

| Tool | What it deletes | Cascade effect |
|------|----------------|----------------|
| `delete_employee` | Employee record | All assignments, work times, ratings, files for this employee |
| `delete_project` | Project | All events, event functions, and assignments under this project |
| `delete_event` | Event (shift) | All event functions and assignments for this shift |
| `delete_event_function` | Position/role within an event | All assignments linked to this position |
| `delete_client` | Client (company) | May affect linked projects and contacts |
| `delete_contact` | Client contact person | Contact record only |
| `delete_file` | Uploaded file | File is permanently removed |
| `delete_employee_picture` | Profile picture | Picture is permanently removed |
| `delete_checkin` | Check-in record | Proof of attendance is lost |
| `delete_busy_date` | Vacation/leave entry | Employee appears available again for that period |
| `delete_webhook` | Webhook configuration | Stops all notifications to that URL |
| `delete_special_date` | Holiday/special date | Scheduling impact for that date |
| `delete_external_staff_request` | External staffing request | Request is removed |

### Safer alternatives

| Instead of | Consider |
|-----------|----------|
| `delete_employee` | `set_employee_state` with state=5 (inactive) or state=6 (soft-delete) |
| `delete_event` | `update_event` with status=5 (aborted) |
| `delete_project` | Archive by updating status — deletion is rarely necessary |
| `bulk_update_assignment_status` | `update_assignment_status` on individual assignments |

### Bulk operations

All bulk tools (`bulk_create_*`, `bulk_update_*`) support `dry_run=true`, which previews the operation without making any API calls. The AI is instructed to always dry-run first.

### Privacy

Sensitive employee data (email, phone, address, birthday, gender) is **always protected** and cannot be exposed through the AI. This is hardcoded — there is no configuration to disable it.

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/Umami2000/staffcloud-mcp.git
cd staffcloud-mcp
npm install        # installs dependencies and builds automatically
```

### 2. Run the setup wizard

```bash
npm run setup
```

The wizard validates your connection, lets you pick a default planner, choose which modules to load, and saves the config — all in under a minute.

**API key:** Log into StaffCloud → Settings → API → Security Token. Copy the JWT (starts with `eyJ...`). Paste just the token, without the `Bearer ` prefix.

### 3. Add to your AI client

The setup wizard can write this for you, or you can add it manually. Create `.mcp.json` in your project root (or add to `~/.claude/settings.local.json` for global access):

```json
{
  "mcpServers": {
    "staffcloud": {
      "command": "node",
      "args": ["/path/to/staffcloud-mcp/dist/index.js"],
      "env": {
        "STAFFCLOUD_API_URL": "https://yourcompany.staff.cloud/api/v1",
        "STAFFCLOUD_API_KEY": "your-jwt-token"
      }
    }
  }
}
```

Replace `/path/to/staffcloud-mcp` with the absolute path to where you cloned the repo.

<details>
<summary>Cursor / Windsurf / other MCP clients</summary>

Same JSON config — just place it where your client expects it. For Cursor: `.cursor/mcp.json`. Check your client's docs for the exact path.

</details>

### 4. Start using it

Restart Claude Code (or run `/mcp` to reconnect). Your AI assistant now has full access to your StaffCloud instance.

---

## Configuration

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `STAFFCLOUD_API_URL` | Yes | — | `https://yourcompany.staff.cloud/api/v1` |
| `STAFFCLOUD_API_KEY` | Yes | — | JWT token (without `Bearer ` prefix) |
| `STAFFCLOUD_MODULES` | No | `core` | `core`, `setup`, `ops`, `admin`, `reference`, or `all` |
| `STAFFCLOUD_DEFAULT_PLANNER_ID` | No | — | Default planner ID for creating projects/events |
| `STAFFCLOUD_DESCRIPTION_FIELD` | No | `dynamic_field_51` | Dynamic field used for event descriptions |

### Privacy built in

Sensitive employee data (email, phone, address, birthday, gender) is **always protected** — there is no way to disable this. The AI only sees planning-safe fields: name, city, status, qualifications, language.

### Module loading

```bash
"core"              # 27 tools — default
"core,setup"        # 49 tools
"core,setup,ops"    # 75 tools
"all"               # 119 tools
```

---

## Filtering & sorting

All list tools support StaffCloud's query operators:

```bash
?status=4              # equals
?city=~zürich          # case-insensitive like
?status=-6             # not equals
?updated_at=>2024-01   # greater than
?mobile=-null          # not null
?status=4,5            # OR (comma-separated)
?fields=id,firstname   # field selection (reduces payload)
?sort=-updated_at      # descending sort
```

---

## Architecture

```
AI Client (Claude / Cursor / ...)
  │ stdio (MCP protocol)
  ▼
staffcloud-mcp
  ├─ Tool modules (load only what you need)
  ├─ Smart tools (composite operations)
  ├─ API client (retry · rate limits · timeouts)
  └─ Zod input validation
  │ HTTPS + Bearer JWT
  ▼
StaffCloud REST API
```

**Resilience built in:**
- Automatic retry with exponential backoff (1s → 2s → 4s) on 429 and 5xx
- Rate limit tracking with warnings when running low
- 30-second request timeouts
- Zod validation on every tool input

---

## Contributing

```bash
git clone https://github.com/Umami2000/staffcloud-mcp.git
cd staffcloud-mcp
npm install    # auto-builds via prepare script
```

After editing source files, run `npm run build` and restart your MCP connection.

### Project structure

```
src/
  index.ts              # Server entry — module loading, dispatch
  staffcloud-client.ts  # HTTP client — retry, rate limits, all API calls
  smart-tools.ts        # 13 composite tools
  setup.ts              # Interactive setup wizard
  tools/
    core.ts             # Core module (27 tools)
    setup.ts            # Setup module (22 tools)
    ops.ts              # Ops module (26 tools)
    admin.ts            # Admin module (26 tools)
    reference.ts        # Reference module (18 tools)
    shared.ts           # Validation, PII filtering, utilities
    types.ts            # Shared interfaces
```

Contributions, ideas, and feedback are welcome — feel free to open an issue or submit a PR.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Invalid security token structure` | Paste just the JWT token — no `Bearer ` prefix |
| `401 Unauthorized` | Token expired — regenerate in StaffCloud → Settings → API |
| `404 Not Found` | Check URL format: `https://yourcompany.staff.cloud/api/v1` |
| `ENOTFOUND` | DNS issue — check internet connection and subdomain |

---

<details>
<summary><strong>Full tool reference (119 tools)</strong></summary>

### Core — Employees
`list_employees` · `get_employee` · `create_employee` · `update_employee` · `delete_employee` · `set_employee_state` · `get_employee_profile`

### Core — Projects & Events
`list_projects` · `get_project` · `create_project` · `update_project` · `list_events` · `get_event` · `create_event` · `update_event`

### Core — Assignments
`list_assignments` · `get_assignment` · `update_assignment_status` · `bulk_update_assignment_status`

### Core — Smart Scheduling
`get_staff_schedule` · `find_available_staff` · `create_shift` · `get_staffing_gaps` · `find_replacement` · `update_project_location` · `resolve_field_value` · `format_phone`

### Setup — Event Functions & Locations
`list_event_functions` · `get_event_function` · `create_event_function` · `update_event_function` · `delete_event_function` · `list_functions` · `list_locations` · `create_location` · `update_location`

### Setup — Clients & Contacts
`list_clients` · `get_client` · `create_client` · `update_client` · `delete_client` · `list_contacts` · `get_contact` · `create_contact` · `update_contact` · `delete_contact`

### Setup — Bulk Import
`bulk_create_projects` · `bulk_create_events` · `bulk_create_event_functions`

### Ops — Assignment Details
`get_assignment_wages` · `get_assignment_paysheets` · `get_assignment_work_times` · `get_assignment_configurations` · `get_assignment_work_time_proposals` · `get_assignment_wage_proposals` · `get_assignment_livestamps` · `get_assignment_reporting_forms` · `get_assignment_teamsheet` · `get_assignment_open_actions` · `get_assignment_status_map`

### Ops — Tracking
`list_checkins` · `create_checkin` · `delete_checkin` · `list_work_times` · `get_employee_availabilities` · `get_employee_availability_requests`

### Ops — Busy Dates & Ratings
`list_busy_dates` · `create_busy_date` · `update_busy_date` · `delete_busy_date` · `get_work_hours_summary` · `list_ratings` · `create_rating` · `list_rating_criteria` · `delete_event`

### Admin — Webhooks & Messages
`list_webhooks` · `create_webhook` · `update_webhook` · `delete_webhook` · `list_messages` · `send_message`

### Admin — External Staff
`list_external_staff_requests` · `get_external_staff_request` · `create_external_staff_request` · `update_external_staff_request` · `delete_external_staff_request` · `list_external_workers` · `get_external_worker` · `create_external_worker` · `update_external_worker`

### Admin — Files & Special Dates
`list_files` · `get_file` · `delete_file` · `list_employee_pictures` · `get_employee_picture` · `delete_employee_picture` · `list_special_dates` · `get_special_date` · `create_special_date` · `update_special_date` · `delete_special_date`

### Reference
`list_settings` · `list_planners` · `list_languages` · `list_wage_profiles` · `list_wage_types` · `list_attributes` · `list_forms` · `list_automations` · `list_collection_values` · `list_availability_requests` · `list_pay_runs` · `get_pay_run` · `list_pay_lines` · `get_pay_line` · `list_time_slots` · `get_time_slot` · `get_field_definitions` · `delete_project`

</details>

---

**Requires Node.js >= 18** · **[MIT License](LICENSE)**

Built by [Reon Schröder](https://aetlo.ch)
