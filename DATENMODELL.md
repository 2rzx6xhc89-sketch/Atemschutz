# Atemschutzüberwachung – Übergabe an die Fahrzeugverwaltung

Stand: 24.09.2026 · Schema `asue.status/1`

Die App sendet der übergeordneten Fahrzeugverwaltung nur den **Status der Trupps**, jeweils als Anzahl Trupps und Anzahl Personen.

## Statusdefinition

| Status | Bedeutung in der App |
|---|---|
| `bereit` | Trupp angelegt, „Beginn“ noch nicht bestätigt |
| `imEinsatz` | „Beginn“ bestätigt, „Ende“ noch nicht (auch während des Rückzugs) |
| `warenImEinsatz` | „Ende“ bestätigt |
| `gesamt` | Summe aller angelegten Trupps / Personen |

## Nachricht

HTTP `POST` an die im Reiter „Einsatzdaten“ eingetragene Adresse, `Content-Type: application/json`:

```json
{
  "schema": "asue.status/1",
  "zeitpunkt": "2026-09-24T16:32:47.000Z",
  "einsatz": {
    "id": "k3f9a1bc",
    "art": "Einsatz",
    "einsatzstelle": "Lagerhalle, Industriestr. 4",
    "datum": "2026-09-24",
    "abgeschlossen": false
  },
  "status": {
    "bereit":         { "trupps": 1, "personen": 2 },
    "imEinsatz":      { "trupps": 2, "personen": 4 },
    "warenImEinsatz": { "trupps": 0, "personen": 0 },
    "gesamt":         { "trupps": 3, "personen": 6 }
  }
}
```

## Wann gesendet wird

- bei jeder Statusänderung (Trupp angelegt oder gelöscht, Beginn oder Ende bestätigt bzw. korrigiert)
- alle 5 Minuten als Lebenszeichen
- nach einem Fehler alle 30 Sekunden erneut
- einmal bei „Einsatzende“ mit `"abgeschlossen": true`, danach eine Nachricht mit Nullwerten für den neuen, leeren Einsatz

Jede Nachricht enthält den vollständigen aktuellen Stand. Die Fahrzeugverwaltung kann also immer die letzte Nachricht je `einsatz.id` anzeigen.

## Anforderungen an den Empfänger

- HTTPS-Adresse, vom Tablet aus erreichbar (bei internem Netz: Tablet im selben Netz/VPN)
- Antwort mit HTTP-Status 2xx, sonst gilt die Übertragung als fehlgeschlagen
- CORS erlauben: `Access-Control-Allow-Origin` (Adresse der App), `Access-Control-Allow-Headers: Content-Type`, `OPTIONS`-Anfrage beantworten
- Gesendet wird nur aus der installierten Tablet-App, nicht aus der Vorschau-Seite

## Weitere Regeln der App

- Maximaler Flaschendruck: 330 bar; Druckauswahl per Dropdown 0–330 bar in 10er-Schritten.
- Druck bei Beginn je Person; ab „Einsatzort an“ (Abfragen, Rückzug, Ende) wahlweise nur der niedrigste Druck des Trupps (Standard) oder jede Person einzeln – einstellbar unter Einstellungen. Rückzugsdruck dann konservativ: max(50 bar, 2 × (höchster Beginndruck − niedrigster Druck am Einsatzort)).
- Druckabfragen (Einstellungen): Standard „⅓ + ⅔“ – nach ⅓ und ⅔ der Zeit von Beginn bis Rückzug soll; vor „Einsatzort an“ geschätzt aus dem niedrigsten Beginndruck ((Druck − 50 bar) ÷ 8,3 bar/min), danach aus Rückzug soll neu berechnet; erste Abfrage spätestens nach 10 min (einstellbar). Alternativ feste Minuten (z. B. 10/20/30/40). Fällige Abfragen und erreichte Rückzugszeit öffnen automatisch eine Meldung. Gespeichert als ev.q1 / ev.q2 bzw. ev.k<Minuten>.
- Optional Sprachansage der Warnungen; Sicherheitstrupp-Prüfung; Warnung bei hohem Luftverbrauch (Standard ab 12 bar/min je Person).
- MAYDAY-Checkliste mit Zeitstempeln; Einträge erscheinen im Protokoll.
- Übungsmodus mit Zeitraffer (×2/×5/×10) für die Ausbildung.
- Rückzugsdruck = max(50 bar, 2 × (Druck Beginn − Druck am Einsatzort)); Rückzugszeit = Einsatzort-an + (Druck am Einsatzort − Rückzugsdruck) ÷ 8,3 bar/min (entspricht der Richtwerttabelle des Papierbogens).

## Trupp-Übergabe zwischen Geräten (QR-Code)

Ein Gerät (z. B. Handy) erfasst den Trupp und zeigt ihn als QR-Code; das Überwachungs-Tablet scannt ihn („QR übernehmen“). Ohne Server und Internet.
Inhalt: `ASUE1:` + JSON `{v, id, r: Rufgruppe, a: Auftrag, s: Sicherheitstrupp, b: Bemerkung, m: [[Name, Geräte-Nr, LA-Nr, Flaschen-Nr, Masken-Nr, Flaschendruck], …], e: [Beginn-Zeit, [Drücke]]}` (nur ASCII, Umlaute als \uXXXX). Erneutes Scannen desselben Trupps aktualisiert ihn statt ihn doppelt anzulegen.

## Mehrere Geräte über Server (Raspberry Pi)

Unter Einsatzdaten → „Mehrere Geräte“: Server-Adresse und Wehr-Schlüssel eintragen, am Tablet „Diesen Einsatz freigeben“, an den Handys mit Code oder Beitritts-QR beitreten. Schnittstelle: siehe SERVER_API.md (im Server-Paket).

## Offen

- Name/Hersteller der Fahrzeugverwaltung und deren Empfangsadresse
- Ob eine Anmeldung (API-Schlüssel) nötig ist – kann als zusätzliche Kopfzeile ergänzt werden

## QR-Codes für die Geräteerfassung (optional)

Beim Einlesen erkennt die App QR-Codes und Strichcodes (Code 128, Code 39, EAN, DataMatrix u. a.).
Ein einfacher Strichcode füllt das gerade gewählte Feld. Ein QR-Code kann mehrere Felder auf einmal füllen, wenn er so aufgebaut ist:

```
Name: Müller, Jan
Gerät: PA-114
LA: LA-2031
Flasche: F-0587
Maske: M-341
```

oder als JSON: `{"name":"Müller, Jan","geraetNr":"PA-114","laNr":"LA-2031","flascheNr":"F-0587","maskeNr":"M-341"}`
