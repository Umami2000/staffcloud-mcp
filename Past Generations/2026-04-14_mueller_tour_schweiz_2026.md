# Merchandising Tour Müller Filialen Schweiz 2026

**Erstellt:** 2026-04-14
**Auftraggeber User:** Reon
**StaffCloud Tenant:** WeAreKyo
**Quell-Excel:** `~/Downloads/Tourenplanung_Schweiz.xlsx` (Sheet "Planung")

---

## Projekt-Struktur (3 Projekte nach Sprachregion)

| Projekt-ID | Name | Sprachregion (dyn_145) | Events | Zeitraum |
|---|---|---|---|---|
| **5976** | Merchandising Tour Müller Filialen D-CH 2026 | Deutsch (487) | 63 | 29.06 – 16.07.2026 |
| **5977** | Merchandising Tour Müller Filialen FR-CH 2026 | Français (488) | 10 | 13.07 – 16.07.2026 |
| **5978** | Merchandising Tour Müller Filialen IT-CH 2026 | Italiano (489) | 3 | 06.07 – 13.07.2026 |

Alle 3 Projekte:
- `client_id = 40` (Kiendl)
- `planner_id = 40` (Gustavo Goncalves, gustavo@wearekyo.ch)

---

## Stamm-IDs (StaffCloud Tenant)

| Entität | Name | ID |
|---|---|---|
| Client | Kiendl | 40 |
| Planner | Gustavo Goncalves | 40 |
| Function | Merchandiser/in | 8 |
| Wage Profile | GAV restl. Schweiz (20-49) 27.12 | 40 |
| Wage Profile | GAV Tessin (20-49) 25.00 | 39 |
| Wage Profile | GAV Genf (20-49) 27.49 | 38 (nicht genutzt) |
| Dynamic Field | Sprachregion (Projekt-Pflichtfeld) | `dynamic_field_145` |
| Collection | Sprachregion-Werte (D-CH/FR-CH/IT-CH) | 46 (IDs: 487, 488, 489) |
| Country | Schweiz | 223 |
| Country | Liechtenstein | 131 |

---

## ID-Bereiche (alle zusammenhängend)

| Typ | ID-Bereich | Count |
|---|---|---|
| Locations | `2070 – 2145` | 76 |
| Events | `58087 – 58162` | 76 |
| Event-Funktionen | `56615 – 56690` | 76 |

Zuordnungs-Logik:
- `location_id = 2070 + excel_row_index` (Excel-Zeilen 2–77, index 0-basiert)
- Events wurden in 3 Bulk-Calls angelegt (D-CH zuerst, dann FR-CH, dann IT-CH) — siehe `2026-04-14_mueller_tour_id_mapping.json` für vollständiges Mapping je Filiale.

---

## Setup-Entscheidungen

### Event-Status
- **Alle 76 Events `status=1` (DRAFT)** — wie vom User vorgegeben.
- Events ohne Assignments (Gustavo teilt im UI zu).

### Event-Name
- Leer gelassen (`name=""`) → StaffCloud generiert automatisch `"{Wochentag}. {DD}. {Monat}"` (z.B. "Mo. 29. Juni").

### Pausen (GAV Personalverleih, NICHT generisches ArG)
- **10:00 – 16:45** (6h45): **15 min Pause 13:15–13:30** → 55 Events
- **10:00 – 13:30** (3h30): **keine Pause** (skip_break=true) → 21 Events

### Lohnprofile pro Projekt
- D-CH (63) + FR-CH (10) = 73× `wage_profile_id=40`
- IT-CH (3) = 3× `wage_profile_id=39`
- `wage_profile_id` wird pro **Event-Funktion** gesetzt (API-Quirk: wurde bei `bulk_create_event_functions` NICHT persistiert, musste per `update_event_function` einzeln nachgezogen werden).

### Event-Funktion Description
- Pattern: `"Wunsch: {Excel-Name} (Fil. {Nr} · {Kanton})"`
- Dient Gustavo als Planungs-Hinweis welche MA Kiendl wünscht.

### Sprachregion-Zuordnung (VS/FR sind zweisprachig)
Excel markiert Orte teils mit `(CH-FR)`. Zuordnung nach diesem Tag + PLZ-Regel:
- Oberwallis (PLZ 39xx, Brig/Glis 3902) → **D-CH**
- Unterwallis (Monthey 1870, Conthey 1964, Sion 1950) → **FR-CH**
- Fribourg-Stadt-Region (Bulle, Matran) → **FR-CH**
- Tessin (TI) → **IT-CH**

---

## API-Quirks (wichtig für nächste Session!)

1. **`create_location` mit `county_id` gibt 500er** — Feld weglassen. Kanton leitet StaffCloud aus PLZ ab.
2. **`dynamic_field_145` Schreibformat**: Array mit Collection-IDs `[487]`, NICHT `{"D-CH": true}` (letzteres ist nur die Read-Response).
3. **`dynamic_field_145` ist Pflichtfeld** beim Projekt-Create (Validation: `_dyn_attr_145: Pflichtfeld`).
4. **`wage_profile_id` auf Event-Funktion wird beim Create NICHT persistiert** — muss per `update_event_function` nachgezogen werden. `bulk_update_event_functions` kennt `wage_profile_id` nicht im Schema, Single-Updates funktionieren aber.
5. **`client_id` auf Event NICHT automatisch vom Projekt geerbt** — muss pro Event explizit gesetzt werden (via `update_event`). Gilt auch für bereits existierende Events anderer Projekte vermutlich.
6. **Event-`status`** = `1=Draft, 2=Active, 3=Archived, 5=Aborted`.
7. **Projekte haben KEINEN eigenen Status und KEIN `wage_profile_id`** — das liegt alles auf Event/Event-Funktion-Ebene.

---

## Offene Punkte / TODO nächste Session

### 🔴 User-Feedback: Adresse fehlt in Location-Anzeige
Promotoren sehen in der Liste nur `"Müller Fil. 5157 · Dielsdorf, 8157 Dielsdorf"` — die **Strasse fehlt**. `line_1` ist zwar gespeichert (z.B. "Ruchwiesenstr. 2"), wird aber nicht in der Listenansicht gezeigt.

**Vorgeschlagene Lösungen** (User hat noch nicht entschieden):
1. **Location-Namen umbauen** auf `"Müller Fil. {Nr} · {Strasse} · {PLZ} {Ort}"` via 76× `update_location(name=...)`.
2. **Google Maps Coordinates setzen** per `update_location({coordinates: {lat, lng}})` — erfordert Google Maps API-Key (User hat erwartet dass Key im Holiday-Planner liegt, aber dort gibt es nur `google-flights` + `tavily`, KEIN Maps-MCP).

Empfehlung: Option 1 sofort machen, Option 2 optional wenn User API-Key bereitstellt.

### Gustavo-Workflow (nicht Claudes Aufgabe)
1. MA pro Event-Funktion im UI einteilen (Assignments — werden vom Planner gemacht, NICHT von Claude).
2. Events von DRAFT → Active schalten (`bulk_update_events` mit `status=2`).

---

## Referenz-Dateien

- **Mapping komplett:** `Past Generations/2026-04-14_mueller_tour_id_mapping.json` — jede Filiale mit allen IDs.
- **Excel-Quelldaten geparsed:** `/tmp/mueller_tour.json` (kann re-generiert werden aus `~/Downloads/Tourenplanung_Schweiz.xlsx`).

---

## Sanity-Check-Queries für nächste Session

```
# Projekt-Counts verifizieren
list_events(filter="project_id=5976", fields="id,status") → 63
list_events(filter="project_id=5977", fields="id,status") → 10
list_events(filter="project_id=5978", fields="id,status") → 3

# Eine Event-Funktion prüfen
get_event_function(id=56615) → wage_profile_id=40, description="Wunsch: Karime Manhães d. S. (Fil. 5140 · ZH)"
get_event_function(id=56688) → wage_profile_id=39 (Tessin)

# Ein Event prüfen
get_event(id=58087) → project_id=5976, client_id=40, status=1
```
