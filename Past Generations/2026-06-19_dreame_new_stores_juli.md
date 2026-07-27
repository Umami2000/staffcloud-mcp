# Dreame — 6 neue Stores (Juli 2026)

**Datum:** 2026-06-19
**Quelle:** `Einsatzorte und Zeiten Dreame Standorte Juli 2026.xlsx` (8 Stores; 2 davon — Collombey F650/Projekt 3417, Haag F718/Projekt 3413 — existierten bereits → übersprungen)
**ID-Mapping:** siehe `2026-06-19_dreame_new_stores_juli.json`

## Was wurde angelegt (StaffCloud, Tenant wearekyo)

Pro Store ein **eigenes Projekt** (Muster wie bestehende 10 Store-Projekte 3408–3417), Client 53 (Dreame), Planer **44 = Marlene Brunner**, Tag `Sophia`, `dynamic_field_37` = Standard-Dreame-Beschrieb (inkl. Pausen-Tabelle), `dynamic_field_177` = Code, `dynamic_field_145` = Sprachregion, `dynamic_field_180` = `kyo`, `dynamic_field_181` = `https://app.kyox.ch/wearekyo` (Pflichtfeld bei create_project!).

| Code | Store | Projekt | Location | StoreID | Sprache | Sa-Zeit |
|---|---|---|---|---|---|---|
| C012 | MEDIA MARKT BASEL | 6049 | 2200 | CXY26010011 | D-CH | 09:30–18:00 |
| C013 | MEDIA MARKT GENÈVE CAROUGE | 6050 | 2201 | CXY26010012 | FR-CH | 09:30–18:00 |
| C014 | MEDIA MARKT MEYRIN | 6051 | 2202 | CXY26010013 | FR-CH | 09:30–18:00 |
| F901 | INTERDISCOUNT AARAU | 6052 | 2203 | CXY26010014 | D-CH | 08:30–17:00 |
| F902 | INTERDISCOUNT HEIMBERG CF XXL | 6053 | 2204 | CXY26010015 | D-CH | 08:30–17:00 |
| F903 | INTERDISCOUNT LENZBURG | 6054 | 2205 | CXY26010016 | D-CH | 09:30–18:00 |

**Events:** 474 total (79/Store). Thu/Fri/Sat, **2026-07-02 … 2026-12-31**. Namen `Do. 02. Juli` etc. Status 2 (aktiv), `client_id=53` gesetzt.
- Do/Fr: 14:30–18:30 (kein Break)
- Sa 08:30–17:00 → Break 12:30–13:00 ; Sa 09:30–18:00 → Break 13:43–14:13
**Event Functions:** 474 (1/Event), `function_id=19` (Dreame), `wage_profile_id=5` (28 CHF/h + Spesen), `quantity=1`, **UNBESETZT** (Planer besetzt im UI).

## Codes = PLATZHALTER
C012–C014 / F901–F903 sind **frei erfundene Platzhalter** (keine echten MediaMarkt-/Interdiscount-Filialnummern vorhanden). In Projekt `dynamic_field_177` und in der Excel-Spalte `Code` identisch gesetzt. Bei Bedarf später durch echte Nummern ersetzen (Projekt-Feld + Excel).

## Bekannte Einschränkung — EF-Planer
Die 474 Event Functions haben intern noch `planner_id=25` (Dominik Mayr, deleted); die API liefert 500 beim EF-Planer-Update. **Nicht UI-sichtbar** — der sichtbare „Planer" steht auf Event + Projekt und ist überall **44 Marlene Brunner**.

## Excel `PLANNING_Dreame_2026-NEU.xlsx`
Chirurgische XML-Bearbeitung (openpyxl zerstört SharePoint-CustomXML/Comments → nicht verwendet). Original gesichert als `PLANNING_Dreame_2026-NEU__BACKUP-original.xlsx`.
- **PLANNING-Sheet:** 474 Zeilen (1642–2115) angefügt; Tabelle1-Ref A1:S1641 → **A1:S2115** (inkl. autoFilter-Ref); Formeln (ISOWEEKNUM/XLOOKUP/Kombi) + Cache-Werte gesetzt; Status „Not Staffed".
- **Locations-Sheet:** 6 Zeilen (12–17) mit Adressen/Zeiten/StoreID; Montag leer (kein Mo-Einsatz).
- `calcChain.xml` entfernt (Excel baut neu auf). Alle anderen Parts (Pivot/Reporting, Comments, CustomXML) **byte-genau erhalten**.
- ⚠️ **Aktiver Filter** (Tabelle1: „Interdiscount COLLOMBEY XXL" + Juni 2026) aus der letzten Session blieb erhalten → die neuen Zeilen sind durch diesen Filter **ausgeblendet**. Filter löschen, um alle 6 neuen Stores zu sehen.
- Validiert: Zip-Integrität OK, XML well-formed, openpyxl liest 2114 Datenzeilen, LibreOffice öffnet ohne Reparatur.

## Nicht gemacht (bewusst)
- Keine Assignments (Besetzung im UI durch Planer).
- Keine Mo-Einsätze (Quelldatei nennt nur Do/Fr/Sa).
- Supervison-Sheet nicht ergänzt (manuelles Tracking-Grid).
