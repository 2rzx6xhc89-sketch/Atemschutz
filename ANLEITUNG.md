# Fahrzeugverwaltung auf dem Raspberry Pi einrichten

Diese Anleitung richtet die App so ein, dass sie dauerhaft auf einem Raspberry Pi läuft.
Alle Geräte im selben WLAN (Gerätehaus, Leitstelle) sehen dann dieselben Live-Daten –
Änderungen erscheinen bei allen praktisch sofort. Für Besatzungen auf ihrem eigenen
Handy, unterwegs, gibt es zusätzlich einen eigenen, streng eingeschränkten Melde-Link
pro Fahrzeug (Status + Mannschaft), der sich gefahrlos auch von außerhalb des WLANs
freigeben lässt (Schritt 8) – ganz ohne dass jemand eine VPN-App einrichten muss.

**Was du brauchst:**
- Einen Raspberry Pi (Modell 3B+ oder neuer reicht locker) mit Raspberry Pi OS
- Eine Fritz!Box, an der der Pi per Kabel oder WLAN hängt
- Die drei Dateien aus diesem Projekt: `server.js`, `package.json`, den Ordner `public/` (enthält `index.html`)

---

## 1. Node.js auf dem Pi installieren

Am Pi anmelden (per Bildschirm/Tastatur oder per SSH von einem anderen Rechner) und im Terminal:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Prüfen, ob es geklappt hat:

```bash
node -v
npm -v
```

Beides sollte eine Versionsnummer anzeigen (z. B. `v20.x.x`).

---

## 2. Projekt auf den Pi übertragen

Auf dem Pi ein Verzeichnis anlegen:

```bash
mkdir -p ~/fahrzeugverwaltung
cd ~/fahrzeugverwaltung
```

Jetzt die drei Dateien/Ordner (`server.js`, `package.json`, `public/`) in genau dieses Verzeichnis kopieren. Wie du das machst, ist egal – z. B.:

- **USB-Stick:** Dateien auf einen Stick kopieren, am Pi einstecken, ins Verzeichnis kopieren.
- **Per SCP von deinem PC/Mac aus** (Terminal auf deinem Rechner, nicht auf dem Pi):
  ```bash
  scp -r server.js package.json public pi@<IP-des-Pi>:~/fahrzeugverwaltung/
  ```
- **Per USB/Netzlaufwerk**, wie es bei euch sonst üblich ist.

Am Ende sollte die Struktur so aussehen:

```
~/fahrzeugverwaltung/
  server.js
  package.json
  public/
    index.html
```

---

## 3. Abhängigkeiten installieren

Im Projektverzeichnis auf dem Pi:

```bash
cd ~/fahrzeugverwaltung
npm install
```

Das lädt `express` und `ws` herunter (braucht Internetzugang, nur einmalig).

---

## 4. Server testweise starten

```bash
node server.js
```

Im Terminal sollte erscheinen:

```
Fahrzeugverwaltung läuft auf Port 8080
Lokal auf diesem Gerät:  http://localhost:8080
Im Netzwerk erreichbar unter http://<IP-Adresse-des-Rechners>:8080
Isolierter Meldeserver läuft auf Port 8081 (nur Status + Mannschaft, pro Fahrzeug per Token).
```

Die eigene IP-Adresse des Pi herausfinden:

```bash
hostname -I
```

Das gibt z. B. `192.168.178.50` aus. Jetzt auf einem **anderen** Gerät im selben WLAN
(Handy, Laptop) im Browser öffnen:

```
http://192.168.178.50:8080
```

Wenn die App lädt und oben „🟢 Verbunden" anzeigt, funktioniert alles. Mit `Strg + C`
im Terminal beenden, um zu Schritt 5 überzugehen.

---

## 5. Server dauerhaft laufen lassen (Autostart)

Damit der Server auch nach einem Neustart des Pi automatisch wieder läuft, richten wir
ihn als **systemd-Dienst** ein.

Datei anlegen:

```bash
sudo nano /etc/systemd/system/fahrzeugverwaltung.service
```

Folgenden Inhalt einfügen (den Pfad in `WorkingDirectory` ggf. anpassen, falls dein
Benutzername nicht `pi` ist – mit `whoami` prüfen):

```ini
[Unit]
Description=Fahrzeugverwaltung Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/fahrzeugverwaltung
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
User=pi
Environment=PORT=8080
# Environment=MELDE_PORT=8081   # optional, Standard ist ohnehin PORT+1
# Environment=BACKUP_RETENTION_DAYS=60   # optional, Standard ist 30 Tage

[Install]
WantedBy=multi-user.target
```

Speichern (`Strg+O`, dann `Enter`) und schließen (`Strg+X`).

Dienst aktivieren und starten:

```bash
sudo systemctl daemon-reload
sudo systemctl enable fahrzeugverwaltung
sudo systemctl start fahrzeugverwaltung
```

Status prüfen:

```bash
sudo systemctl status fahrzeugverwaltung
```

Sollte „active (running)" zeigen. Ab jetzt startet der Server automatisch bei jedem
Neustart des Pi mit.

**Nützliche Befehle:**

```bash
sudo systemctl restart fahrzeugverwaltung   # neu starten (z. B. nach einem Update)
sudo systemctl stop fahrzeugverwaltung      # anhalten
journalctl -u fahrzeugverwaltung -f         # Live-Log ansehen (zum Fehlersuchen)
```

---

## 6. Feste IP-Adresse für den Pi in der Fritz!Box vergeben

Damit sich die Adresse des Pi nicht ändert (sonst müsstet ihr die URL immer wieder neu
suchen), in der Fritz!Box:

1. `http://fritz.box` im Browser öffnen, anmelden.
2. **Heimnetz → Netzwerk → Netzwerkverbindungen** öffnen.
3. Den Raspberry Pi in der Liste suchen (Name z. B. „raspberrypi").
4. Bearbeiten-Stift anklicken → Haken bei **„Diesem Netzwerkgerät immer die gleiche
   IPv4-Adresse zuweisen"** setzen → Speichern.

Danach bleibt die Adresse (z. B. `192.168.178.50`) dauerhaft gleich.

---

## 7. Von den Geräten im Gerätehaus/Fahrzeugen zugreifen

Auf jedem Gerät im selben WLAN im Browser aufrufen:

```
http://192.168.178.50:8080
```

(mit eurer tatsächlichen Pi-IP-Adresse aus Schritt 6). Am besten als Lesezeichen/App-Icon
auf den Startbildschirmen speichern, damit niemand die Adresse eintippen muss.

**Atemschutzüberwachung:** Unter `http://192.168.178.50:8080/asue` läuft eine eigene,
separate Seite dafür — eignet sich gut für ein zusätzliches Tablet/Bildschirm, das
während des gesamten Einsatzes vom ASÜ-Führer im Blick behalten wird. Aus der
Haupt-App heraus erreicht ihr sie auch über „Einsatz → 🅰️⏱️ ASÜ öffnen" (öffnet in
einem neuen Tab). Änderungen dort erscheinen live in der Haupt-App und umgekehrt.

---

## 8. Fahrzeuge „von außen" — der isolierte Meldeserver

Für Besatzungen auf ihrem **privaten Handy, ohne App/VPN-Einrichtung** gibt es einen
**zweiten, komplett getrennten Server auf einem eigenen Port** (Standard: **8081**, also
Haupt-Port + 1). Er läuft automatisch mit, sobald ihr `node server.js` startet — im
Terminal seht ihr dafür eine eigene Zeile:

```
Isolierter Meldeserver läuft auf Port 8081 (nur Status + Mannschaft, pro Fahrzeug per Token).
Nur diesen Port nach außen freigeben, NICHT Port 8080.
```

**Warum das sicher genug ist, um es ins Internet zu hängen (anders als die Haupt-App):**
Dieser zweite Port kennt **nichts** von der übrigen App — keine Fahrzeugliste, keine
Benutzer, keine Verwaltung, keine Lagekarte. Er kann für ein einzelnes Fahrzeug
ausschließlich drei Dinge: dessen Funkrufname + Status **anzeigen**, den Status
**ändern** (Frei/Alarmiert/Einsatz) und Mannschaft/PA-Träger **melden**. Welches
Fahrzeug gemeint ist, ergibt sich allein aus einem langen, zufälligen Code in der
Adresse (**Token**) — ohne den passenden, euch bekannten Link kommt niemand an irgendein
Fahrzeug heran, geraten werden kann er praktisch nicht.

### Melde-Link für ein Fahrzeug erzeugen

In der App: **Einsatz → 👥 Mannschaftsstärke → Fahrzeug antippen → „🔗 Melde-Link für
dieses Fahrzeug kopieren"**. Der kopierte Link sieht z. B. so aus:

```
http://192.168.178.50:8081/melden/7f3a9c1e...
```

Diesen Link an die Besatzung schicken (WhatsApp, SMS — völlig egal, es ist ein
gewöhnlicher Link). Jedes Fahrzeug hat einen eigenen, festen Link, den ihr einmal
erzeugt und danach immer wieder verschicken/als Lesezeichen speichern könnt.

### Nur diesen einen Port nach außen freigeben

Die Haupt-App (Port 8080) bleibt bewusst **nur im Gerätehaus-WLAN** erreichbar — dafür
ist keine weitere Einrichtung nötig. Damit der Meldeserver (Port 8081) auch von unterwegs
erreichbar ist, in der Fritz!Box:

**Über MyFRITZ! (empfohlen, mit HTTPS):**
1. **Internet → MyFRITZ!-Konto** einrichten (falls noch nicht vorhanden).
2. **Internet → Freigaben → MyFRITZ!-Freigaben → Freigabe hinzufügen**.
3. Gerät „Raspberry Pi" wählen, Port **8081**, Protokoll HTTP.
4. AVM vergibt eine feste, HTTPS-verschlüsselte Adresse wie
   `https://xxxxxxxx.myfritz.net:8081/melden/<token>` — das ist der Link, den ihr statt
   der lokalen `192.168.178.50`-Adresse an die Besatzungen verschickt, wenn sie von
   unterwegs melden sollen.

**Alternativ per klassischer Portfreigabe:** **Internet → Freigaben → Portfreigaben**,
Port **8081** auf die feste Pi-IP weiterleiten (Port 8080 **nicht** freigeben!). Ohne
MyFRITZ! gibt es dann aber kein automatisches HTTPS.

**Wichtig:** Gebt wirklich nur Port 8081 frei, niemals 8080 — nur so bleibt die
eigentliche App und alle Daten sicher im eigenen Netz.

---

## 9. Daten sichern (Backup)

**Läuft jetzt automatisch mit** — der Server legt täglich (beim ersten Start des Tages,
danach stündlich geprüft) selbstständig eine Kopie an:

```
~/fahrzeugverwaltung/backups/data-2026-09-24.json
~/fahrzeugverwaltung/backups/data-2026-09-25.json
...
```

Ältere Backups als **30 Tage** werden automatisch gelöscht. Die Anzahl der aufbewahrten
Tage lässt sich über die Umgebungsvariable `BACKUP_RETENTION_DAYS` anpassen (z. B. in der
systemd-Datei aus Schritt 5: `Environment=BACKUP_RETENTION_DAYS=60`).

**Falls ihr mal auf ein Backup zurückgreifen müsst:**

```bash
sudo systemctl stop fahrzeugverwaltung
cp ~/fahrzeugverwaltung/backups/data-2026-09-24.json ~/fahrzeugverwaltung/data.json
sudo systemctl start fahrzeugverwaltung
```

**Zusätzlich empfohlen:** Der Ordner `backups/` liegt weiterhin auf derselben SD-Karte —
bei einem Totalausfall der Karte sind auch die Backups weg. Wer zusätzliche Sicherheit
möchte, kopiert den `backups/`-Ordner gelegentlich auf einen USB-Stick oder ein anderes
Gerät im Netzwerk, z. B.:

```bash
scp -r ~/fahrzeugverwaltung/backups/ nutzer@anderer-rechner:/pfad/zum/sicherungsort/
```

---

## 10. App aktualisieren

Bekommt ihr später eine neue Version von `index.html` (z. B. mit neuen Funktionen), reicht
es, die Datei in `~/fahrzeugverwaltung/public/index.html` zu ersetzen und den Dienst neu
zu starten:

```bash
sudo systemctl restart fahrzeugverwaltung
```

`server.js`/`package.json` müssen dafür nicht angefasst werden, solange sich an der
Server-Logik nichts ändert.

---

## Fehlersuche

| Problem | Prüfen |
|---|---|
| Seite lädt nicht | Läuft der Dienst? `sudo systemctl status fahrzeugverwaltung` |
| „🔴 Getrennt" in der App | Ist der Pi im selben Netzwerk erreichbar? `ping 192.168.178.50` |
| Nach Neustart des Pi nichts erreichbar | `sudo systemctl enable fahrzeugverwaltung` ausgeführt? |
| Änderungen anderer Geräte kommen nicht an | Alle Geräte auf **derselben** Adresse (`http://<Pi-IP>:8080`), nicht `localhost`? |
| `npm install` schlägt fehl | Hat der Pi Internetzugang? (Nur für die Installation nötig, danach nicht mehr) |
| Melde-Link zeigt „Nicht gefunden" | Wurde der Link über „🔗 Melde-Link kopieren" in der App erzeugt (nicht selbst getippt)? Läuft der Meldeserver (Port 8081) noch? |
| Melde-Link von unterwegs nicht erreichbar | MyFRITZ!-Freigabe/Portfreigabe für Port **8081** eingerichtet (siehe Schritt 8)? |
