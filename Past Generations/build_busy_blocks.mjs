import { readFileSync, writeFileSync } from "node:fs";

const RANGE_FROM = "2026-05-04";
const RANGE_TO = "2026-11-04";
const MIN_DAYS = 4; // > 3 Tage

const raw = JSON.parse(readFileSync(new URL("./busy_in_range.json", import.meta.url), "utf8"));

const employees = {
  1432: "Aldian Bibuljica",
  1749: "Chiara Ruepp",
  2921: "Nancy Marie Metzner",
  7721: "Jan Maurin Utiger",
  7813: "Elif Boy",
  7833: "Belinda Hotz",
  8360: "Azem Asani",
  8639: "Severina Coric",
  8727: "Almedin Taraboshi",
  8883: "Arly Mae Agassis",
  8955: "Asya Türkan Maria Yolcu",
  9045: "Noelani Graf",
};

const typeLabel = (t) =>
  ({
    vacation: "Ferien",
    sick_leave: "Krank",
    day_off: "Frei",
    no_show: "Nicht erschienen",
    other: "Anderes",
    ill: "Krank",
    school: "Schule",
    military: "Militär",
  }[t] || t);

const addDays = (d, n) => {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const dayDiff = (a, b) =>
  (new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000;

raw.sort((a, b) =>
  a.employee_id - b.employee_id ||
  a.type.localeCompare(b.type) ||
  (a.reason || "").localeCompare(b.reason || "") ||
  a.from.localeCompare(b.from)
);

const blocks = [];
let cur = null;
for (const e of raw) {
  const key = `${e.employee_id}|${e.type}|${e.reason || ""}`;
  if (
    cur &&
    cur.key === key &&
    dayDiff(cur.to, e.from) <= 1
  ) {
    cur.to = e.to > cur.to ? e.to : cur.to;
  } else {
    if (cur) blocks.push(cur);
    cur = { key, employee_id: e.employee_id, type: e.type, reason: e.reason || "", from: e.from, to: e.to };
  }
}
if (cur) blocks.push(cur);

const result = blocks
  .map((b) => ({
    ...b,
    days: dayDiff(b.from, b.to) + 1,
  }))
  .filter((b) => b.days >= MIN_DAYS && b.from <= RANGE_TO && b.to >= RANGE_FROM)
  .sort((a, b) => a.from.localeCompare(b.from) || a.employee_id - b.employee_id);

const rows = [["Mitarbeiter", "Von", "Bis", "Tage", "Grund"]];
for (const b of result) {
  const name = employees[b.employee_id] || `#${b.employee_id}`;
  const reason = b.reason ? `${typeLabel(b.type)} – ${b.reason}` : typeLabel(b.type);
  rows.push([name, b.from, b.to, String(b.days), reason]);
}

const csvEsc = (v) => {
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = "﻿" + rows.map((r) => r.map(csvEsc).join(";")).join("\r\n") + "\r\n";

writeFileSync(new URL("./Abwesenheiten_2026-05-04_bis_2026-11-04.csv", import.meta.url), csv);
writeFileSync(new URL("./busy_blocks.json", import.meta.url), JSON.stringify(result, null, 2));

console.log(`Blöcke ≥ ${MIN_DAYS} Tage: ${result.length}`);
console.table(result.map((b) => ({
  Mitarbeiter: employees[b.employee_id] || `#${b.employee_id}`,
  Von: b.from,
  Bis: b.to,
  Tage: b.days,
  Grund: b.reason ? `${typeLabel(b.type)} – ${b.reason}` : typeLabel(b.type),
})));
