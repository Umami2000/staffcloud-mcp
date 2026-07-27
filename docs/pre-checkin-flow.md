# StaffCloud Pre-Check-In Flow

> Daily automated reconfirmation via SMS — employees confirm shifts with one click, no app login needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       PRE-CHECK-IN FLOW                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    06:00 CRON (n8n Schedule Trigger)              │
│  │  FLOW 1       │                                                  │
│  │  Daily Reset  │   1. StaffCloud: GET /assignments (tomorrow)     │
│  │               │   2. Generate unique token per assignment        │
│  │               │   3. StaffCloud: PUT /assignments/{id}/status →6 │
│  │               │   4. ClickSend: POST /sms/send per employee      │
│  └──────────────┘      SMS: "Bestätige: https://n8n.xx/confirm?t=…"│
│                                                                     │
│         ── employee receives SMS, taps link ──                      │
│                                                                     │
│  ┌──────────────┐    n8n Webhook: GET /confirm?t={token}            │
│  │  FLOW 2       │                                                  │
│  │  Confirm      │   1. Decode token → assignment_id, employee_id   │
│  │               │   2. StaffCloud: PUT /assignments/{id}/status →7 │
│  │               │   3. Store confirmation in n8n static data       │
│  │               │   4. Respond with "Bestätigt ✓" HTML page        │
│  └──────────────┘                                                   │
│                                                                     │
│  ┌──────────────┐    Every 5 min (n8n Schedule Trigger)             │
│  │  FLOW 3       │                                                  │
│  │  Teams Digest │   1. Read confirmations from last 5 min          │
│  │               │   2. Group by project                            │
│  │               │   3. POST to MS Teams Incoming Webhook           │
│  │               │   4. Clear buffer                                │
│  └──────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Services & Credentials

| Service | Auth | Docs |
|---------|------|------|
| **StaffCloud** | `Authorization: Bearer {JWT}` | `https://{tenant}.staff.cloud/api/v1` |
| **ClickSend** | Basic Auth: `username:api_key` | `https://rest.clicksend.com/v3` |
| **MS Teams** | Incoming Webhook URL (no auth header) | Teams Channel → Connectors → Incoming Webhook |

### Environment Variables (n8n Credentials)

```bash
# StaffCloud
STAFFCLOUD_API_URL="https://{tenant}.staff.cloud/api/v1"
STAFFCLOUD_API_KEY="eyJ..."

# ClickSend
CLICKSEND_USERNAME="you@example.com"
CLICKSEND_API_KEY="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
CLICKSEND_FROM="+41440000000"        # Sender ID or phone number

# MS Teams
TEAMS_WEBHOOK_URL="https://outlook.office.com/webhook/..."

# n8n
CONFIRM_WEBHOOK_URL="https://your-n8n.example.com/webhook/confirm"
TOKEN_SECRET="random-32-char-secret-for-signing"
```

---

## Flow 1: Daily Reset & SMS (06:00 Cron)

### n8n Nodes

```
Schedule Trigger (06:00 daily)
  → HTTP Request: GET StaffCloud assignments
  → IF: any assignments found?
  → SplitInBatches: per assignment
    → Code: generate signed token
    → HTTP Request: PUT StaffCloud status → 6
  → Code: group by employee
  → SplitInBatches: per employee
    → HTTP Request: POST ClickSend SMS
```

### Step 1: Fetch Tomorrow's Confirmed Assignments

```http
GET https://{tenant}.staff.cloud/api/v1/assignments
  ?start=>{today} 23:59:59
  &end=<{tomorrow} 23:59:59
  &status=6,7
  &fields=id,employee_id,start,end,event.name,event.project.name,event_function.function,location,status,project_id,event_id
Authorization: Bearer {JWT}
```

Response:
```json
[
  {
    "id": 372,
    "status": 7,
    "employee_id": 16,
    "start": "2026-04-01 06:00:00",
    "end": "2026-04-01 16:00:00",
    "event.name": "Aufbau Tag 2",
    "event.project.name": "Logistik Messebau",
    "event_function.function": "Teamleader",
    "location": "Messe Zürich, Wallisellenstrasse 49, 8050 Zürich",
    "project_id": 1208,
    "event_id": 7681
  }
]
```

### Step 2: Get Employee Names (for SMS personalization)

```http
GET https://{tenant}.staff.cloud/api/v1/employees
  ?id={comma_separated_employee_ids}
  &fields=id,firstname,lastname,mobile
Authorization: Bearer {JWT}
```

> ⚠️ `mobile` may be blocked by PII protection depending on tenant config.
> If blocked, store employee phone numbers in a separate mapping (n8n static data or database).
> Alternative: Use ClickSend contact lists synced separately.

### Step 3: Generate Signed Token per Assignment

Each SMS link needs a unique, tamper-proof token so employees can't confirm someone else's shift.

```javascript
// n8n Code node
const crypto = require('crypto');
const SECRET = $env.TOKEN_SECRET;

function generateToken(assignmentId, employeeId) {
  const payload = `${assignmentId}:${employeeId}:${Date.now()}`;
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 16);  // short enough for SMS URL
  
  // Base64url encode: assignmentId:employeeId:timestamp:signature
  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return token;
}

function verifyToken(token) {
  const decoded = Buffer.from(token, 'base64url').toString();
  const parts = decoded.split(':');
  if (parts.length !== 4) return null;
  
  const [assignmentId, employeeId, timestamp, signature] = parts;
  const payload = `${assignmentId}:${employeeId}:${timestamp}`;
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 16);
  
  if (signature !== expected) return null;
  
  // Token expires after 36 hours (covers overnight + shift)
  const age = Date.now() - parseInt(timestamp);
  if (age > 36 * 60 * 60 * 1000) return null;
  
  return {
    assignmentId: parseInt(assignmentId),
    employeeId: parseInt(employeeId)
  };
}
```

### Step 4: Reset Assignment to "Assigned"

```http
PUT https://{tenant}.staff.cloud/api/v1/assignments/{id}/status
Content-Type: application/json
Authorization: Bearer {JWT}

{"status": 6}
```

> Only reset assignments that are currently status 7 (confirmed).
> Status 6 (assigned) can stay — they already need to confirm.
> Handle 400 gracefully (already at target status).

### Step 5: Send SMS via ClickSend

```http
POST https://rest.clicksend.com/v3/sms/send
Content-Type: application/json
Authorization: Basic {base64(username:api_key)}

{
  "messages": [
    {
      "source": "n8n",
      "from": "+41440000000",
      "body": "Hallo Reon! Bestätige deinen Einsatz morgen:\n\nAufbau Tag 2\n06:00-16:00\nMesse Zürich\n\nBestätigen: https://your-n8n.example.com/webhook/confirm?t=MzcyOjE2OjE3MTE...",
      "to": "+41791234567",
      "custom_string": "assignment_372"
    }
  ]
}
```

Response:
```json
{
  "http_code": 200,
  "response_code": "SUCCESS",
  "response_msg": "Messages queued for delivery.",
  "data": {
    "total_price": 0.0564,
    "total_count": 1,
    "queued_count": 1,
    "messages": [
      {
        "message_id": "abc123",
        "status": "SUCCESS",
        "to": "+41791234567",
        "custom_string": "assignment_372"
      }
    ]
  }
}
```

**SMS Content Rules:**
- Max 160 chars for single SMS (longer = multiple SMS = higher cost)
- Keep it short — name, shift, time, location, link
- URL shortener recommended (ClickSend has built-in link tracking)

**SMS Template (compact, ~155 chars):**
```
Hallo {firstname}! Einsatz morgen:
{event_name}, {start}-{end}
{location_short}
Bestätigen: {confirm_url}
```

**If employee has multiple shifts** — send one SMS per shift (each needs its own confirm link), or send one SMS with a link to a page listing all shifts.

### Grouping: One SMS per Employee

If an employee has multiple assignments tomorrow, options:

**Option A: One SMS per assignment** (simple, more SMS cost)
```
SMS 1: "Aufbau Tag 2, 06:00-16:00 → {link1}"
SMS 2: "Feinaufbau, 07:00-17:00 → {link2}"
```

**Option B: One SMS with multi-confirm link** (complex, cheaper)
```
SMS: "2 Einsätze morgen → {link_to_page_listing_all}"
```
→ The link opens a page showing all shifts with individual confirm buttons.

Recommendation: **Option A** for simplicity. SMS cost is CHF 0.0564 each — marginal.

---

## Flow 2: Confirm Webhook (Employee Clicks Link)

### n8n Nodes

```
Webhook Trigger: GET /webhook/confirm?t={token}
  → Code: verify & decode token
  → IF: token valid?
    → HTTP Request: PUT StaffCloud status → 7
    → Code: add to confirmation buffer (static data)
    → Respond: HTML "Bestätigt ✓" page
  → ELSE:
    → Respond: HTML "Link ungültig" page
```

### Webhook Endpoint

```
GET https://your-n8n.example.com/webhook/confirm?t={token}
```

Employee taps this in their SMS → browser opens → n8n processes.

### Step 1: Verify Token

```javascript
// n8n Code node (reuse verifyToken from Flow 1)
const token = $input.first().json.query.t;
const result = verifyToken(token);

if (!result) {
  return [{ json: { valid: false } }];
}

return [{ json: { valid: true, ...result } }];
```

### Step 2: Confirm in StaffCloud

```http
PUT https://{tenant}.staff.cloud/api/v1/assignments/{assignmentId}/status
Content-Type: application/json
Authorization: Bearer {JWT}

{"status": 7}
```

### Step 3: Store Confirmation in Buffer

```javascript
// n8n Code node — store in static data for Teams digest
const staticData = $getWorkflowStaticData('global');
if (!staticData.confirmations) staticData.confirmations = [];

staticData.confirmations.push({
  assignment_id: $json.assignmentId,
  employee_id: $json.employeeId,
  employee_name: $json.employeeName,     // fetched from StaffCloud
  project_name: $json.projectName,
  event_name: $json.eventName,
  function_name: $json.functionName,
  confirmed_at: new Date().toISOString()
});
```

### Step 4: Respond with Success Page

```html
<!-- n8n Respond to Webhook node — Content-Type: text/html -->
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Einsatz bestätigt</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white; border-radius: 16px; padding: 40px;
      text-align: center; max-width: 360px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .check { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #2d3748; font-size: 24px; margin: 0 0 8px; }
    .detail { color: #718096; font-size: 14px; line-height: 1.6; }
    .shift { background: #f7fafc; border-radius: 8px; padding: 12px; margin: 16px 0; }
    .shift strong { color: #2d3748; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✅</div>
    <h1>Bestätigt!</h1>
    <div class="shift">
      <strong>{{event_name}}</strong><br>
      {{date}}, {{start}}–{{end}}<br>
      📍 {{location}}
    </div>
    <p class="detail">
      Dein Einsatz ist bestätigt.<br>
      Du kannst dieses Fenster schliessen.
    </p>
  </div>
</body>
</html>
```

**Error Page (invalid/expired token):**
```html
<div class="card">
  <div class="check">❌</div>
  <h1>Link ungültig</h1>
  <p class="detail">
    Dieser Bestätigungslink ist abgelaufen oder ungültig.<br>
    Bitte öffne StaffCloud direkt um deinen Einsatz zu bestätigen.
  </p>
</div>
```

---

## Flow 3: Teams Digest (Every 5 Minutes)

### n8n Nodes

```
Schedule Trigger (every 5 min)
  → Code: read & clear confirmation buffer
  → IF: any new confirmations?
    → Code: group by project, count totals
    → HTTP Request: POST Teams Incoming Webhook
```

### Step 1: Read & Clear Buffer

```javascript
// n8n Code node
const staticData = $getWorkflowStaticData('global');
const confirmations = staticData.confirmations || [];

// Clear buffer after reading
staticData.confirmations = [];

if (confirmations.length === 0) {
  return [];  // nothing to send → stop workflow
}

return [{ json: { confirmations } }];
```

### Step 2: Enrich with Total Counts

To show "3/10 bestätigt", we need the total assignment count per project. Fetch from StaffCloud:

```http
GET https://{tenant}.staff.cloud/api/v1/assignments
  ?start=>{today} 23:59:59
  &end=<{tomorrow} 23:59:59
  &status=6,7
  &fields=id,status,project_id,event.project.name
Authorization: Bearer {JWT}
```

Then count:
```javascript
// Group by project
const byProject = {};
for (const a of allAssignments) {
  const key = a.project_id;
  if (!byProject[key]) {
    byProject[key] = { name: a['event.project.name'], total: 0, confirmed: 0 };
  }
  byProject[key].total++;
  if (a.status === 7) byProject[key].confirmed++;
}
```

### Step 3: Post to MS Teams

```http
POST {TEAMS_WEBHOOK_URL}
Content-Type: application/json

{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
          {
            "type": "TextBlock",
            "size": "Medium",
            "weight": "Bolder",
            "text": "📋 Pre-Check-In Update"
          },
          {
            "type": "TextBlock",
            "text": "01.04.2026 — Stand 07:35",
            "isSubtle": true,
            "spacing": "None"
          },
          {
            "type": "ColumnSet",
            "columns": [
              {
                "type": "Column",
                "width": "stretch",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "**Logistik Messebau**",
                    "wrap": true
                  },
                  {
                    "type": "TextBlock",
                    "text": "3/10 bestätigt",
                    "color": "Good",
                    "spacing": "None"
                  }
                ]
              }
            ]
          },
          {
            "type": "FactSet",
            "facts": [
              { "title": "✅", "value": "Reon Schröder — Teamleader (07:31)" },
              { "title": "✅", "value": "Joel Krebs — Logistics (07:33)" },
              { "title": "✅", "value": "Theodor Hess — Event Manager (07:35)" }
            ]
          },
          {
            "type": "TextBlock",
            "text": "⏳ 7 ausstehend",
            "color": "Attention",
            "spacing": "Medium"
          }
        ]
      }
    }
  ]
}
```

**Teams Adaptive Card renders as:**

```
┌─────────────────────────────────────────┐
│ 📋 Pre-Check-In Update                 │
│ 01.04.2026 — Stand 07:35               │
│                                         │
│ Logistik Messebau                       │
│ 3/10 bestätigt                          │
│                                         │
│ ✅ Reon Schröder — Teamleader (07:31)   │
│ ✅ Joel Krebs — Logistics (07:33)       │
│ ✅ Theodor Hess — Event Manager (07:35) │
│                                         │
│ ⏳ 7 ausstehend                         │
└─────────────────────────────────────────┘
```

---

## API Quick Reference

### StaffCloud

```bash
# Get tomorrow's assignments
curl -s "https://{tenant}.staff.cloud/api/v1/assignments?\
start=>2026-03-31 23:59:59&\
end=<2026-04-01 23:59:59&\
status=6,7&\
fields=id,employee_id,start,end,event.name,event.project.name,event_function.function,location,status,project_id" \
  -H "Authorization: Bearer ${STAFFCLOUD_API_KEY}"

# Reset to assigned
curl -s -X PUT "https://{tenant}.staff.cloud/api/v1/assignments/{id}/status" \
  -H "Authorization: Bearer ${STAFFCLOUD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": 6}'

# Confirm (from webhook)
curl -s -X PUT "https://{tenant}.staff.cloud/api/v1/assignments/{id}/status" \
  -H "Authorization: Bearer ${STAFFCLOUD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": 7}'
```

### ClickSend SMS

```bash
curl -s -X POST "https://rest.clicksend.com/v3/sms/send" \
  -u "${CLICKSEND_USERNAME}:${CLICKSEND_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "source": "n8n-precheckin",
        "from": "+41440000000",
        "body": "Hallo Reon! Einsatz morgen: Aufbau Tag 2, 06:00-16:00, Messe Zürich. Bestätigen: https://n8n.xx/confirm?t=abc123",
        "to": "+41791234567",
        "custom_string": "assignment_372"
      }
    ]
  }'
```

**ClickSend Auth:** Basic Auth with `username:api_key` base64 encoded.

**Pricing (Switzerland):** CHF 0.0564 per SMS. 10 employees × 30 days = ~CHF 17/month.

### MS Teams Incoming Webhook

```bash
curl -s -X POST "${TEAMS_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"type":"AdaptiveCard","version":"1.4","body":[{"type":"TextBlock","text":"📋 3/10 bestätigt — Logistik Messebau"}]}}]}'
```

---

## Token Security

### Why Tokens?

Without tokens, the confirm URL would be something like `/confirm?assignment_id=372` — anyone could guess IDs and confirm shifts for other people.

### Token Format

```
base64url( assignmentId : employeeId : timestamp : hmac_signature )
```

Example: `MzcyOjE2OjE3MTE4NjgwMDAwMDA6YWJjZGVmMTIzNDU2`

### Properties

| Property | Value |
|----------|-------|
| **Signed** | HMAC-SHA256 — can't be forged without `TOKEN_SECRET` |
| **Expiry** | 36 hours (covers overnight + full shift day) |
| **One-time?** | Optional — StaffCloud will return 400 if already confirmed |
| **URL-safe** | base64url encoding, no special chars |

### Token Verification (n8n Code Node)

```javascript
const crypto = require('crypto');

function verifyToken(token, secret) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [assignmentId, employeeId, timestamp, signature] = decoded.split(':');
    
    // Verify signature
    const payload = `${assignmentId}:${employeeId}:${timestamp}`;
    const expected = crypto.createHmac('sha256', secret)
      .update(payload).digest('hex').slice(0, 16);
    
    if (signature !== expected) return null;
    
    // Check expiry (36h)
    if (Date.now() - parseInt(timestamp) > 36 * 3600 * 1000) return null;
    
    return { assignmentId: parseInt(assignmentId), employeeId: parseInt(employeeId) };
  } catch {
    return null;
  }
}
```

---

## Employee Phone Numbers

### The PII Problem

StaffCloud's API blocks `mobile` and `phone` fields via PII protection. You need phone numbers for ClickSend SMS but can't get them from the API.

### Solutions

**Option A: Separate phone mapping** (recommended)
- Maintain a mapping table (n8n static data, Google Sheet, or database)
- `{ employee_id: 16, phone: "+41791234567" }`
- Manually maintained or synced from StaffCloud export

**Option B: StaffCloud export**
- Export employee data as CSV from StaffCloud admin UI
- Import into n8n as reference data
- Re-export periodically when staff changes

**Option C: Ask StaffCloud to enable PII access on the API key**
- Tenant admin can potentially enable PII fields for specific API keys
- Then `GET /employees?fields=id,firstname,mobile` would return phone numbers

---

## Error Handling

| Scenario | How to Handle |
|----------|---------------|
| StaffCloud assignment already status 6 | Skip — HTTP 400, log "already reset" |
| StaffCloud assignment already status 7 (on confirm) | Show success page anyway — idempotent |
| ClickSend SMS fails | Log error, retry once, alert planner |
| Invalid/expired token on confirm click | Show error page with "open StaffCloud" fallback |
| Employee clicks link twice | StaffCloud returns 400, show "already confirmed" page |
| Teams webhook fails | Log error, buffer carries over to next 5-min cycle |

---

## Scheduling Summary

| Flow | Trigger | Frequency |
|------|---------|-----------|
| **Flow 1: Daily Reset** | n8n Schedule Trigger | Daily at 06:00 |
| **Flow 2: Confirm** | n8n Webhook | On-demand (employee clicks) |
| **Flow 3: Teams Digest** | n8n Schedule Trigger | Every 5 minutes |

---

## Cost Estimate

| Item | Unit Cost | Monthly (10 staff, 20 workdays) |
|------|-----------|--------------------------------|
| ClickSend SMS (CH) | CHF 0.0564/SMS | ~CHF 11.28 (200 SMS) |
| StaffCloud API | Free (included) | CHF 0 |
| MS Teams Webhook | Free | CHF 0 |
| n8n (self-hosted) | Free | CHF 0 |
| **Total** | | **~CHF 12/month** |

At scale (50 staff): ~CHF 56/month.

---

## Safety Rules

- ✅ Always reset 7→6 only (confirmed → assigned), never to 8 (denied)
- ✅ Tokens are signed and expire after 36 hours
- ✅ SMS via ClickSend — full delivery tracking and cost control
- ✅ Teams digest batched every 5 min — no spam
- ✅ Confirm webhook is idempotent — double-click safe
- ❌ Never expose StaffCloud API key in SMS links or frontend
- ❌ Never use bulk assignment endpoint (no ID filter = global change)
- ❌ Never send SMS to numbers without employee consent (GDPR)

---

## Quick Reference

```
┌──────────────────────────────────────────────────────────────────┐
│ FLOW 1 — Daily Reset (06:00)                                    │
│ StaffCloud:  GET  /assignments?start=>&end=<&status=6,7          │
│ StaffCloud:  PUT  /assignments/{id}/status  {"status": 6}        │
│ ClickSend:   POST /v3/sms/send  (Basic Auth)                    │
├──────────────────────────────────────────────────────────────────┤
│ FLOW 2 — Confirm Webhook (on click)                              │
│ n8n:         GET  /webhook/confirm?t={token}                     │
│ StaffCloud:  PUT  /assignments/{id}/status  {"status": 7}        │
│ n8n:         → store in static data buffer                       │
│              → respond with HTML success page                    │
├──────────────────────────────────────────────────────────────────┤
│ FLOW 3 — Teams Digest (every 5 min)                              │
│ n8n:         read buffer, clear, group by project                │
│ Teams:       POST Incoming Webhook (Adaptive Card)               │
│              "3/10 bestätigt — ✅ Reon, ✅ Joel, ✅ Theodor"      │
└──────────────────────────────────────────────────────────────────┘
```
