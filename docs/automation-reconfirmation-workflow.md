# StaffCloud Daily Reconfirmation Automation

> Every day at 06:00, fetch all confirmed assignments for tomorrow, reset them to "assigned", and notify employees to reconfirm.

---

## Workflow

```
┌──────────────────────────────────────────────────────────┐
│                  DAILY CRON — 06:00 AM                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. SCAN         GET /assignments?status=7               │
│                  &start=>today 23:59:59                   │
│                  &end=<tomorrow 23:59:59                  │
│                  → all confirmed assignments for tomorrow │
│                                                          │
│  2. RESET EACH   PUT /assignments/{id}/status → 6        │
│                  → confirmed → assigned, one by one      │
│                                                          │
│  3. NOTIFY       POST /notifications                          │
│                  → one message per employee (grouped)     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Authentication

```
Base URL:  https://{tenant}.staff.cloud/api/v1
Header:    Authorization: Bearer {JWT_TOKEN}
```

The API key is a JWT token. Use it directly after `Bearer `. No `Bearer ` prefix in the env var.

---

## Step 1: Get Tomorrow's Confirmed Assignments

**Single API call — date filtering works on `start` and `end` fields directly.**

```bash
curl -s "https://{tenant}.staff.cloud/api/v1/assignments?\
start=>2026-03-31 23:59:59&\
end=<2026-04-01 23:59:59&\
status=6,7&\
fields=id,employee_id,start,end,event.name,event.project.name,event_function.function,break_start,break_end,status,location,event_id,project_id" \
  -H "Authorization: Bearer ${STAFFCLOUD_API_KEY}"
```

Response:
```json
[
  {
    "id": 369,
    "status": 7,
    "start": "2026-04-01 11:00:00",
    "end": "2026-04-01 16:00:00",
    "employee_id": 16,
    "event.name": "Aufbau Tag 2",
    "event.project.name": "Logistik Messebau",
    "event_function.function": "Logistics",
    "break_start": "2026-04-01 13:00:00",
    "break_end": "2026-04-01 13:15:00",
    "location": "Messe Zürich, Wallisellenstrasse 49, 8050 Zürich",
    "event_id": 7681,
    "project_id": 1208
  }
]
```

**Date filter pattern:**
```
start=>YYYY-MM-DD 23:59:59    ← "starts after end of today"  (today = day before target)
end=<YYYY-MM-DD 23:59:59      ← "ends before end of tomorrow" (tomorrow = target day)
```

**Working filters on `/assignments`:**

| Filter | Works? | Example |
|--------|--------|---------|
| `status` | ✅ | `status=7` or `status=6,7` |
| `start=>` | ✅ | `start=>2026-03-31 23:59:59` |
| `end=<` | ✅ | `end=<2026-04-01 23:59:59` |
| `event_id` | ✅ | `event_id=7681,7682` |
| `employee_id` | ✅ | `employee_id=16` |
| `client_id` | ✅ | `client_id=13` |
| `project_id` | ✅ | `project_id=1208` |
| `event.start=>` | ❌ | Joined field — silently ignored |

**Useful fields:**

```
id                        → assignment ID (needed for status update)
status                    → 6=assigned, 7=confirmed
employee_id               → for notification targeting
start / end               → shift times (filterable!)
break_start / break_end   → break window
event.name                → shift name (for message)
event.project.name        → project name (for message)
event_function.function   → role e.g. "Logistics" (for message)
location                  → venue + address (for message)
event_id / project_id     → for additional filtering
```

---

## Step 2: Reset Each Assignment to "Assigned"

```bash
curl -s -X PUT "https://{tenant}.staff.cloud/api/v1/assignments/369/status" \
  -H "Authorization: Bearer ${STAFFCLOUD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": 6}'
```

Response: full assignment object with `"status": 6`.

**Error if already reset (HTTP 400):**
```json
{
  "error": "State transition error",
  "message": "Cannot change assignment status for assignment id 369 from: 'Confirmed' to: 'Confirmed'"
}
```
→ Safe to skip — already at target status.

> **⚠️ NEVER use `PUT /assignments/status` (without ID) — it changes ALL assignments globally with no filter. Always use `PUT /assignments/{id}/status` in a loop.**

**Assignment Status Values:**

| Value | Status | Description |
|-------|--------|-------------|
| 6 | **Assigned** | ← Target (employee must reconfirm) |
| 7 | **Confirmed** | ← Source (what we're resetting) |
| 8 | Denied | ❌ Never use — removes staff permanently |

---

## Step 3: Notify Employees

```bash
curl -s -X POST "https://{tenant}.staff.cloud/api/v1/messages" \
  -H "Authorization: Bearer ${STAFFCLOUD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Bitte bestätige deinen Einsatz morgen",
    "text": "Hallo!\n\nBitte bestätige folgende Einsätze für morgen:\n\n• Aufbau Tag 2 — Logistics (06:00–16:00)\n  Messe Zürich\n\nLogge dich in StaffCloud ein und bestätige.\n\nDanke und Grüsse",
    "to": {
      "userType": "employee",
      "userId": 16
    },
    "channels": ["inbox", "email"]
  }'
```

**Channels:**

| Channel | Cost | Use |
|---------|------|-----|
| `inbox` | Free | Always — in-app notification |
| `email` | Free | Always — email reminder |
| `sms` | Paid | Only for escalation |

**Group by employee** — if an employee has 3 shifts tomorrow, send 1 message listing all 3, not 3 separate messages.

---

## Complete Implementation (JavaScript)

```javascript
const BASE_URL = process.env.STAFFCLOUD_API_URL;
const API_KEY = process.env.STAFFCLOUD_API_KEY;
const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Step 1: Get tomorrow's confirmed assignments (single API call) ──
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const todayStr = today.toISOString().split('T')[0];      // "2026-03-31"
const tomorrowStr = tomorrow.toISOString().split('T')[0]; // "2026-04-01"

const params = new URLSearchParams({
  'start': `=>${todayStr} 23:59:59`,
  'end': `=<${tomorrowStr} 23:59:59`,
  'status': '7',
  'fields': 'id,employee_id,start,end,event.name,event.project.name,event_function.function,break_start,break_end,location'
});

const assignments = await fetch(
  `${BASE_URL}/assignments?${params}`, { headers }
).then(r => r.json());

if (assignments.length === 0) {
  console.log(`No confirmed assignments for ${tomorrowStr}. Done.`);
  process.exit(0);
}

console.log(`Found ${assignments.length} confirmed assignments for ${tomorrowStr}`);

// ── Step 2: Reset each to assigned (status 6) ──
const results = [];
for (const a of assignments) {
  try {
    const res = await fetch(`${BASE_URL}/assignments/${a.id}/status`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status: 6 })
    });
    if (res.ok) {
      results.push({ id: a.id, employee_id: a.employee_id, ok: true });
    } else {
      const err = await res.json();
      results.push({ id: a.id, ok: false, error: err.message });
    }
  } catch (err) {
    results.push({ id: a.id, ok: false, error: err.message });
  }
  await sleep(200); // rate limit
}

// ── Step 3: Notify employees (grouped) ──
const byEmployee = {};
for (const r of results.filter(r => r.ok)) {
  const a = assignments.find(x => x.id === r.id);
  if (!byEmployee[a.employee_id]) byEmployee[a.employee_id] = [];
  byEmployee[a.employee_id].push(a);
}

for (const [empId, shifts] of Object.entries(byEmployee)) {
  const shiftList = shifts.map(s =>
    `• ${s['event.name']} — ${s['event_function.function']} (${s.start?.slice(11,16)}–${s.end?.slice(11,16)})\n  ${s.location}`
  ).join('\n');

  await fetch(`${BASE_URL}/notifications`, {
    method: 'POST', headers,
    body: JSON.stringify({
      subject: `Bitte bestätige deinen Einsatz am ${tomorrowStr}`,
      text: `Hallo!\n\nBitte bestätige folgende Einsätze für morgen:\n\n${shiftList}\n\nLogge dich in StaffCloud ein und bestätige deine Schichten.\n\nDanke und Grüsse`,
      to: { userType: 'employee', userId: parseInt(empId) },
      channels: ['inbox', 'email']
    })
  });
  await sleep(200);
}

// ── Summary ──
const ok = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log(`Done: ${ok} reset, ${fail} failed, ${Object.keys(byEmployee).length} employees notified`);
```

---

## Environment Variables

```bash
STAFFCLOUD_API_URL="https://{tenant}.staff.cloud/api/v1"
STAFFCLOUD_API_KEY="eyJ..."    # JWT token, no "Bearer " prefix
```

---

## Scheduling (Cron)

```cron
# Run at 06:00 every day
0 6 * * * node /path/to/reconfirmation.js >> /var/log/reconfirmation.log 2>&1
```

---

## Rate Limiting

The API returns rate limit info in headers:

```
X-Rate-Limit-Limit: 60
X-Rate-Limit-Remaining: 45
X-Rate-Limit-Reset: 1711868400
```

- 200ms delay between calls
- On 429: wait until `X-Rate-Limit-Reset`, then retry
- On 5xx: exponential backoff (1s, 2s, 4s), max 3 retries

---

## Safety Rules

- ✅ Use `PUT /assignments/{id}/status` (single) — never the bulk endpoint without ID
- ✅ Only transition 7 → 6 (confirmed → assigned)
- ✅ Group notifications per employee
- ✅ 200ms delay between API calls
- ✅ Safe to re-run — already-reset assignments return 400 (skipped)
- ❌ Never use status 8 (denied) — permanently removes staff
- ❌ Never use `PUT /assignments/status` (no ID) — affects ALL assignments
- ❌ Never send SMS without business approval — costs money

---

## Quick Reference

```
GET  /assignments?status=7&start=>{today} 23:59:59&end=<{tomorrow} 23:59:59
     &fields=id,employee_id,start,end,event.name,event_function.function,location
     → tomorrow's confirmed assignments (single call!)

PUT  /assignments/{id}/status  {"status": 6}
     → reset one assignment: confirmed → assigned

POST /notifications  {"to":{"userType":"employee","userId":16},"channels":["inbox","email"],...}
     → notify employee to reconfirm

Auth:   Authorization: Bearer {JWT}
Rate:   200ms between calls, retry on 429/5xx
```
