import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("/tmp/xlsx-install/node_modules/xlsx");

const blocks = JSON.parse(readFileSync(new URL("./busy_blocks.json", import.meta.url), "utf8"));

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
  }[t] || t);

const rows = [["Mitarbeiter", "Von", "Bis", "Tage", "Grund"]];
for (const b of blocks) {
  rows.push([
    employees[b.employee_id] || `#${b.employee_id}`,
    new Date(b.from + "T00:00:00Z"),
    new Date(b.to + "T00:00:00Z"),
    b.days,
    b.reason ? `${typeLabel(b.type)} – ${b.reason}` : typeLabel(b.type),
  ]);
}

const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 30 }];
// Datumsformat
for (let r = 1; r < rows.length; r++) {
  for (const col of ["B", "C"]) {
    const cell = ws[`${col}${r + 1}`];
    if (cell) cell.z = "yyyy-mm-dd";
  }
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Abwesenheiten >3 Tage");

const outPath = join(homedir(), "Downloads", "Abwesenheiten_2026-05-04_bis_2026-11-04.xlsx");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(outPath, buf);
console.log("XLSX:", outPath);
