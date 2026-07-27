#!/usr/bin/env node
// Update column "Erster Einsatz" in the existing Pensum xlsx with the
// historic first assignment date (from summary.json), preserving all other content.

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SUMMARY = path.join(HERE, "summary.json");
const SRC = "/Users/reon/Downloads/IQOS_Promoter_Pensum_2025-07_2026-04.xlsx";

const data = JSON.parse(fs.readFileSync(SUMMARY, "utf8"));
const firstWorkedById = new Map();
const firstAnyById = new Map();
for (const e of data.employees) {
  if (e.first_assignment_worked_date)
    firstWorkedById.set(e.employee_id, e.first_assignment_worked_date.slice(0, 10));
  if (e.first_assignment_any_date)
    firstAnyById.set(e.employee_id, e.first_assignment_any_date.slice(0, 10));
}

const wb = XLSX.readFile(SRC);
const ws = wb.Sheets["Pensum"];
const range = XLSX.utils.decode_range(ws["!ref"]);

// header row is row 6 (zero-indexed). Find columns.
const headerRow = 6;
const headers = {};
for (let c = range.s.c; c <= range.e.c; c++) {
  const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
  if (cell) headers[cell.v] = c;
}
const idCol = headers["MA-ID"];
const ersterCol = headers["Erster Einsatz"];
const letzterCol = headers["Letzter Einsatz"];
if (idCol === undefined || ersterCol === undefined) {
  throw new Error("required columns not found: " + JSON.stringify(headers));
}

// Insert one new column right after "Erster Einsatz" → "Erstes Assignment (any status)"
// Simpler: just replace the existing "Erster Einsatz" with historic worked-date,
// and add a parenthetical to the header to clarify.

let updated = 0;
let missing = [];
for (let r = headerRow + 1; r <= range.e.r; r++) {
  const idCell = ws[XLSX.utils.encode_cell({ r, c: idCol })];
  if (!idCell) continue;
  const id = idCell.v;
  const historic = firstWorkedById.get(id);
  if (!historic) { missing.push(id); continue; }
  const targetAddr = XLSX.utils.encode_cell({ r, c: ersterCol });
  ws[targetAddr] = { t: "s", v: historic };
  updated++;
}
// Update header to clarify it now contains historic data
ws[XLSX.utils.encode_cell({ r: headerRow, c: ersterCol })] = {
  t: "s",
  v: "Erster Einsatz (historisch)",
};

// Also normalise "Letzter Einsatz" column from Excel-serial numbers to ISO date strings
if (letzterCol !== undefined) {
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: letzterCol });
    const cell = ws[addr];
    if (cell && cell.t === "n" && typeof cell.v === "number") {
      // Excel serial → JS date
      const d = XLSX.SSF.parse_date_code(cell.v);
      if (d) {
        const iso = `${d.y.toString().padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        ws[addr] = { t: "s", v: iso };
      }
    }
  }
}

// Update an explanatory subtitle line. Row 4 has the Pensum-% explanation; let's amend row 3.
// Find a free metadata row close to header
// Safer: append a note row right above header (row 5 was empty) — fill column A with explanation.
ws["A6"] = { t: "s", v: "Hinweis: 'Erster Einsatz (historisch)' = erstes assigned/confirmed Assignment je MA über die GESAMTE Tenant-Historie (Quelle: 2026-05-13 Analyse aller Assignments)." };

// preserve the original column widths if present
console.log(`Updated ${updated} rows`);
if (missing.length) console.log("Missing historic data for IDs:", missing);

// Add new sheet with full first-assignment summary
const newRows = data.employees
  .slice()
  .sort((a, b) => (a.first_assignment_any_date ?? "9999").localeCompare(b.first_assignment_any_date ?? "9999"))
  .map(s => ({
    "MA-ID": s.employee_id,
    "Name": s.name,
    "Assignments total": s.total_assignments,
    "Erster Einsatz (worked)": (s.first_assignment_worked_date ?? "").slice(0, 10),
    "Erster Einsatz Zeit": (s.first_assignment_worked_date ?? "").slice(11, 16),
    "Erster Einsatz Event": s.first_assignment_worked_event_name,
    "Erstes Assignment (any)": (s.first_assignment_any_date ?? "").slice(0, 10),
    "Any Status": s.first_assignment_any_status,
    "Any Event": s.first_assignment_any_event_name,
  }));
const wsNew = XLSX.utils.json_to_sheet(newRows);
wsNew["!cols"] = [
  { wch: 8 }, { wch: 38 }, { wch: 14 },
  { wch: 18 }, { wch: 10 }, { wch: 30 },
  { wch: 18 }, { wch: 10 }, { wch: 30 },
];
// Remove sheet if it exists
if (wb.Sheets["Erstes Assignment"]) {
  wb.SheetNames = wb.SheetNames.filter(n => n !== "Erstes Assignment");
  delete wb.Sheets["Erstes Assignment"];
}
XLSX.utils.book_append_sheet(wb, wsNew, "Erstes Assignment");

XLSX.writeFile(wb, SRC);
console.log("Wrote", SRC);
