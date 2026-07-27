#!/usr/bin/env node
// Bulk-fetch all events referenced by saved per-employee assignments and rebuild summary
// using REAL event.start dates (API sort=event_start:asc was unreliable).

import fs from "node:fs";
import path from "node:path";

const API = "https://wearekyo.staff.cloud/api/v1";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJuYmYiOjE3NTgwMjIwMDksImlhdCI6MTc1ODAyMjAwOSwiZXhwIjo0OTEzNjk1NjA5LCJ0eXBlIjoiZXh0ZXJuYWxfdXNlcnMiLCJpZCI6MjY5LCJ0ZW5hbnRfaWQiOjExNTF9.g9O12iD0TthaI5-4Kvqtft1goB6_TRSsP-6egbhvD-o";
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const RAW_DIR = path.join(HERE, "raw_per_employee");
const EMPLOYEES_SRC = path.join(HERE, "..", "2026-05-08_iqos_pensum_2025-07_2026-04.json");
const EVENTS_CACHE = path.join(HERE, "events_bulk_cache.json");

async function api(pathStr) {
  const res = await fetch(`${API}${pathStr}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`API ${res.status} on ${pathStr}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const src = JSON.parse(fs.readFileSync(EMPLOYEES_SRC, "utf8"));
  const employees = src.employees;

  // collect unique event ids across all employees
  const perEmpAssignments = new Map();
  const allEventIds = new Set();
  for (const emp of employees) {
    const file = path.join(RAW_DIR, `${emp.id}_${emp.name.replace(/[^\w]+/g, "_")}.json`);
    const arr = JSON.parse(fs.readFileSync(file, "utf8"));
    perEmpAssignments.set(emp.id, arr);
    for (const a of arr) if (a.event_id) allEventIds.add(a.event_id);
  }
  console.log(`employees=${employees.length}  unique_events=${allEventIds.size}`);

  // bulk-fetch events in batches
  let eventCache = fs.existsSync(EVENTS_CACHE) ? JSON.parse(fs.readFileSync(EVENTS_CACHE, "utf8")) : {};
  const need = [...allEventIds].filter(id => !eventCache[id]);
  console.log(`need to fetch ${need.length} events (cached ${Object.keys(eventCache).length})`);
  const BATCH = 200;
  for (let i = 0; i < need.length; i += BATCH) {
    const ids = need.slice(i, i + BATCH);
    const arr = await api(`/events?id=${ids.join(",")}&fields=id,name,start,end,project_id,client_id,status`);
    for (const e of arr) eventCache[e.id] = e;
    fs.writeFileSync(EVENTS_CACHE, JSON.stringify(eventCache, null, 2));
    console.log(`  ${Math.min(i + BATCH, need.length)}/${need.length}`);
  }

  // build summary per employee
  const summary = [];
  for (const emp of employees) {
    const arr = perEmpAssignments.get(emp.id);
    // attach event date to each assignment
    const enriched = arr
      .map(a => ({
        ...a,
        event_start: eventCache[a.event_id]?.start ?? null,
        event_name: eventCache[a.event_id]?.name ?? null,
        event_project_id: eventCache[a.event_id]?.project_id ?? null,
      }))
      .filter(a => a.event_start); // drop entries without resolvable date
    enriched.sort((x, y) => x.event_start.localeCompare(y.event_start));

    const firstAny = enriched[0] ?? null;
    const firstWorked = enriched.find(a => a.is_approved === 1 || a.status === 6 || a.status === 7) ?? null;

    summary.push({
      employee_id: emp.id,
      name: emp.name,
      total_assignments: arr.length,
      resolvable_assignments: enriched.length,
      first_assignment_any_date: firstAny?.event_start ?? null,
      first_assignment_any_event_id: firstAny?.event_id ?? null,
      first_assignment_any_event_name: firstAny?.event_name ?? null,
      first_assignment_any_project_id: firstAny?.event_project_id ?? null,
      first_assignment_any_status: firstAny?.status ?? null,
      first_assignment_any_is_approved: firstAny?.is_approved ?? null,
      first_assignment_worked_date: firstWorked?.event_start ?? null,
      first_assignment_worked_event_id: firstWorked?.event_id ?? null,
      first_assignment_worked_event_name: firstWorked?.event_name ?? null,
      first_assignment_worked_project_id: firstWorked?.event_project_id ?? null,
      first_assignment_worked_status: firstWorked?.status ?? null,
    });
  }

  summary.sort((a, b) => (a.first_assignment_any_date ?? "9999").localeCompare(b.first_assignment_any_date ?? "9999"));

  fs.writeFileSync(path.join(HERE, "summary.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    note: "Erstes Assignment (any status) und erstes 'tatsächlich gearbeitetes' Assignment (status 6/7 oder is_approved=1) je IQOS-Promoter:in. Echte event.start-Daten, clientseitig sortiert.",
    employees: summary,
  }, null, 2));
  console.log("Wrote summary.json");

  const csv = [
    "employee_id,name,total,resolvable,first_any_date,first_any_status,first_any_approved,first_any_event,first_worked_date,first_worked_status,first_worked_event",
    ...summary.map(s => [
      s.employee_id,
      JSON.stringify(s.name),
      s.total_assignments,
      s.resolvable_assignments,
      s.first_assignment_any_date ?? "",
      s.first_assignment_any_status ?? "",
      s.first_assignment_any_is_approved ?? "",
      JSON.stringify(s.first_assignment_any_event_name ?? ""),
      s.first_assignment_worked_date ?? "",
      s.first_assignment_worked_status ?? "",
      JSON.stringify(s.first_assignment_worked_event_name ?? ""),
    ].join(",")),
  ].join("\n");
  fs.writeFileSync(path.join(HERE, "summary.csv"), csv);
  console.log("Wrote summary.csv");
}

main().catch(e => { console.error(e); process.exit(1); });
