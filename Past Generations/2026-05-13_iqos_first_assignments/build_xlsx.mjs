#!/usr/bin/env node
// Build XLSX from summary.json
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const data = JSON.parse(fs.readFileSync(path.join(HERE, "summary.json"), "utf8"));

const rows = data.employees.map(s => ({
  Mitarbeiter_ID: s.employee_id,
  Name: s.name,
  Assignments_Total: s.total_assignments,
  Erstes_Assignment_Datum: (s.first_assignment_any_date ?? "").slice(0, 10),
  Erstes_Assignment_Zeit: (s.first_assignment_any_date ?? "").slice(11, 16),
  Erstes_Assignment_Status: s.first_assignment_any_status,
  Erstes_Assignment_Approved: s.first_assignment_any_is_approved,
  Erstes_Assignment_Event: s.first_assignment_any_event_name,
  Erster_Echter_Einsatz_Datum: (s.first_assignment_worked_date ?? "").slice(0, 10),
  Erster_Echter_Einsatz_Zeit: (s.first_assignment_worked_date ?? "").slice(11, 16),
  Erster_Echter_Einsatz_Status: s.first_assignment_worked_status,
  Erster_Echter_Einsatz_Event: s.first_assignment_worked_event_name,
}));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);
// column widths
ws["!cols"] = [
  { wch: 12 }, { wch: 38 }, { wch: 14 },
  { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 32 },
  { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 32 },
];
XLSX.utils.book_append_sheet(wb, ws, "Erste Einsätze");

// legend sheet
const legend = [
  ["Status-Code", "Bedeutung"],
  [1, "invited"],
  [2, "ignored"],
  [3, "applied"],
  [4, "applied_maybe"],
  [5, "assigned_provisional"],
  [6, "assigned"],
  [7, "confirmed"],
  [8, "denied"],
  [],
  ["Spalten-Logik", ""],
  ["Erstes Assignment", "Frühester Eintrag in /assignments für diese:n MA (egal welcher Status)"],
  ["Erster Echter Einsatz", "Frühester Eintrag mit status=6/7 ODER is_approved=1"],
];
const ws2 = XLSX.utils.aoa_to_sheet(legend);
ws2["!cols"] = [{ wch: 22 }, { wch: 60 }];
XLSX.utils.book_append_sheet(wb, ws2, "Legende");

const out = path.join(HERE, "..", "..", "IQOS_Erstes_Assignment_pro_MA.xlsx");
XLSX.writeFile(wb, out);
console.log("Wrote", out);
