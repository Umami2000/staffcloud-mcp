# IQOS Promotor:innen — Erstes Assignment je MA

**Generiert:** 2026-05-13
**Quelle MA-Liste:** `../2026-05-08_iqos_pensum_2025-07_2026-04.json` (62 IQOS-Promotor:innen mit Pensum-Daten Juli 2025 – April 2026)

## Frage
> Wann hatte jede:r dieser 62 Mitarbeiter:innen den allerersten Einsatz in StaffCloud — soweit zurück wie es Daten gibt.

## Ergebnis
- **Älteste:r Start:** Hakim Nessar (id 257) — **2024-01-03**
- **Neueste:r Start (in dieser Liste):** 6× ab 2026-01-19
- Im wearekyo-Tenant existieren echte Events ab **2023-09-14** (IQOS Training September) — aber **keine:r der 62 aktuellen Promotor:innen** war an Events 2023 beteiligt. Sie wurden alle erst ab Januar 2024 oder später als IQOS-Personal aktiv.
- Es gibt im Tenant viele "Platzhalter-Events" mit Start-Datum `2000-02-17` (MC-Incentives etc.) — die sind ausgeklammert, sortiert wird nach echtem `event.start`.

## Dateien
- `raw_per_employee/<id>_<name>.json` — vollständige Roh-Assignments pro MA (62 Files, 21–613 Einträge je MA)
- `events_bulk_cache.json` — Cache der 8919 unique Events (mit start/end/name/project_id)
- `summary.json` — Maschinenlesbare Zusammenfassung mit "first any" und "first worked" pro MA
- `summary.csv` — Excel-freundliche Version
- `../../IQOS_Erstes_Assignment_pro_MA.xlsx` — Endkunden-XLSX (Sheet "Erste Einsätze" + Legende)
- `fetch_assignments.mjs` / `resolve_events.mjs` / `build_xlsx.mjs` — Reproduktions-Scripts

## Logik
- **"Erstes Assignment"** = frühester Eintrag in `/assignments` für diese:n MA (egal welcher Status)
- **"Erster Echter Einsatz"** = frühester Eintrag mit `status ∈ {6=assigned, 7=confirmed}` ODER `is_approved=1`
- Sortierung clientseitig nach echtem `event.start` (API-`sort=event_start:asc` ist NICHT zuverlässig — gibt teilweise spätere Events zuerst zurück).

## API-Quirks (für Fortsetzung)
- `/events?id=A,B,C&fields=…` funktioniert für 200er-Batches → 8919 Events in 45 Calls.
- `/assignments?employee_id=X` gibt **alle** Assignments für diesen MA zurück (kein Limit/Pagination beobachtet), inkl. status 1/2/3 (invited/ignored/applied).
- Status-Werte: 1=invited, 2=ignored, 3=applied, 4=applied_maybe, 5=assigned_provisional, 6=assigned, 7=confirmed, 8=denied.
