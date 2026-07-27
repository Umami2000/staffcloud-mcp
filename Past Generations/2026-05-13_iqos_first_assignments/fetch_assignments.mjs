#!/usr/bin/env node
// Fetch ALL historical assignments per IQOS-Promoter and save individually,
// then resolve first event start_date per employee.

import fs from "node:fs";
import path from "node:path";

const API = "https://wearekyo.staff.cloud/api/v1";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJuYmYiOjE3NTgwMjIwMDksImlhdCI6MTc1ODAyMjAwOSwiZXhwIjo0OTEzNjk1NjA5LCJ0eXBlIjoiZXh0ZXJuYWxfdXNlcnMiLCJpZCI6MjY5LCJ0ZW5hbnRfaWQiOjExNTF9.g9O12iD0TthaI5-4Kvqtft1goB6_TRSsP-6egbhvD-o";
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const RAW_DIR = path.join(HERE, "raw_per_employee");
const EMPLOYEES_SRC = path.join(HERE, "..", "2026-05-08_iqos_pensum_2025-07_2026-04.json");

async function api(pathStr) {
  const url = `${API}${pathStr}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`API ${res.status} on ${pathStr}: ${await res.text()}`);
  return res.json();
}

async function listAssignmentsForEmployee(empId) {
  const fields = "id,employee_id,event_id,event_function_id,status,is_approved,created_at";
  return api(`/assignments?employee_id=${empId}&fields=${fields}&sort=event_start:asc`);
}

async function getEvent(eventId) {
  return api(`/events/${eventId}?fields=id,name,start,end,project_id,status,client_id`);
}

async function main() {
  const src = JSON.parse(fs.readFileSync(EMPLOYEES_SRC, "utf8"));
  const employees = src.employees;
  console.log(`Processing ${employees.length} employees…`);

  // ---- pass 1: fetch + save raw assignments per employee ----
  const summary = [];
  let i = 0;
  for (const emp of employees) {
    i++;
    const outFile = path.join(RAW_DIR, `${emp.id}_${emp.name.replace(/[^\w]+/g, "_")}.json`);
    let assignments;
    if (fs.existsSync(outFile)) {
      assignments = JSON.parse(fs.readFileSync(outFile, "utf8"));
      console.log(`[${i}/${employees.length}] cached: emp ${emp.id} ${emp.name} (${assignments.length})`);
    } else {
      try {
        assignments = await listAssignmentsForEmployee(emp.id);
      } catch (err) {
        console.error(`  ✗ failed emp ${emp.id}:`, err.message);
        continue;
      }
      fs.writeFileSync(outFile, JSON.stringify(assignments, null, 2));
      console.log(`[${i}/${employees.length}] fetched: emp ${emp.id} ${emp.name} (${assignments.length})`);
    }

    // sort defensively asc by id (proxy if event_start:asc not honored, we re-sort after event lookup)
    const all = [...assignments];
    const firstAny = all[0] ?? null;
    const firstWorked = all.find(a => a.is_approved === 1 || a.status === 6 || a.status === 7) ?? null;

    summary.push({
      employee_id: emp.id,
      name: emp.name,
      total_assignments: all.length,
      first_assignment_any_event_id: firstAny?.event_id ?? null,
      first_assignment_any_id: firstAny?.id ?? null,
      first_assignment_any_status: firstAny?.status ?? null,
      first_assignment_any_is_approved: firstAny?.is_approved ?? null,
      first_assignment_worked_event_id: firstWorked?.event_id ?? null,
      first_assignment_worked_id: firstWorked?.id ?? null,
      first_assignment_worked_status: firstWorked?.status ?? null,
    });
  }

  // ---- pass 2: collect unique event ids & resolve event start ----
  const eventIds = new Set();
  for (const s of summary) {
    if (s.first_assignment_any_event_id) eventIds.add(s.first_assignment_any_event_id);
    if (s.first_assignment_worked_event_id) eventIds.add(s.first_assignment_worked_event_id);
  }
  console.log(`Resolving ${eventIds.size} unique events…`);

  const eventCacheFile = path.join(HERE, "events_cache.json");
  let eventCache = fs.existsSync(eventCacheFile) ? JSON.parse(fs.readFileSync(eventCacheFile, "utf8")) : {};
  let j = 0;
  for (const id of eventIds) {
    j++;
    if (eventCache[id]) continue;
    try {
      eventCache[id] = await getEvent(id);
    } catch (err) {
      console.error(`  ✗ event ${id}: ${err.message}`);
      eventCache[id] = { id, error: err.message };
    }
    if (j % 10 === 0) {
      fs.writeFileSync(eventCacheFile, JSON.stringify(eventCache, null, 2));
      console.log(`  …${j}/${eventIds.size} events`);
    }
  }
  fs.writeFileSync(eventCacheFile, JSON.stringify(eventCache, null, 2));

  // ---- pass 3: enrich summary ----
  for (const s of summary) {
    const any = s.first_assignment_any_event_id ? eventCache[s.first_assignment_any_event_id] : null;
    const worked = s.first_assignment_worked_event_id ? eventCache[s.first_assignment_worked_event_id] : null;
    s.first_assignment_any_start = any?.start ?? null;
    s.first_assignment_any_event_name = any?.name ?? null;
    s.first_assignment_any_project_id = any?.project_id ?? null;
    s.first_assignment_worked_start = worked?.start ?? null;
    s.first_assignment_worked_event_name = worked?.name ?? null;
    s.first_assignment_worked_project_id = worked?.project_id ?? null;
  }

  // sort by first_assignment_any_start asc (oldest first)
  summary.sort((a, b) => {
    const da = a.first_assignment_any_start ?? "9999";
    const db = b.first_assignment_any_start ?? "9999";
    return da.localeCompare(db);
  });

  const outSummary = path.join(HERE, "summary.json");
  fs.writeFileSync(outSummary, JSON.stringify({
    generated_at: new Date().toISOString(),
    note: "Erstes Assignment (any status) und erstes 'tatsächlich gearbeitetes' Assignment (status 6/7 oder is_approved=1) je IQOS-Promoter:in.",
    employees: summary,
  }, null, 2));
  console.log(`\nWrote ${outSummary}`);

  // also CSV for quick scanning
  const csv = [
    "employee_id,name,total_assignments,first_any_date,first_any_event,first_any_status,first_worked_date,first_worked_event,first_worked_status",
    ...summary.map(s => [
      s.employee_id,
      JSON.stringify(s.name),
      s.total_assignments,
      s.first_assignment_any_start ?? "",
      JSON.stringify(s.first_assignment_any_event_name ?? ""),
      s.first_assignment_any_status ?? "",
      s.first_assignment_worked_start ?? "",
      JSON.stringify(s.first_assignment_worked_event_name ?? ""),
      s.first_assignment_worked_status ?? "",
    ].join(",")),
  ].join("\n");
  fs.writeFileSync(path.join(HERE, "summary.csv"), csv);
  console.log("Wrote summary.csv");
}

main().catch(e => { console.error(e); process.exit(1); });
