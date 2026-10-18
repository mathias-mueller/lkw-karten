# LKW-Karten 🚛🗺️

Interaktive Web-Karte zur Visualisierung und Prüfung von straßenbezogenen LKW-Restriktionen (Durchfahrtshöhen, Breiten, Gesamtgewichte und Achslasten) auf Basis von **OpenStreetMap (OSM)**.

Die Anwendung kombiniert **PMTiles-Vektorkacheln** für blitzschnelle Ladezeiten (< 25 ms, z. B. Bayern) mit einem automatischen Fallback auf die **OSM Overpass API** für alle übrigen Gebiete.

---

## 🚀 Features

- **Fahrzeugspezifische Filter:**
  - Höhe (z. B. bis 4,00 m Standardhöhe oder Schwertransport)
  - Breite (z. B. 2,55 m Standardbreite)
  - Gesamtgewicht (t)
  - Achslast (t)
- **Status-Ampelbewertung:**
  - 🔴 **Kritisch:** Fahrzeug überschreitet die Beschränkung (Durchfahrt verboten).
  - 🟡 **Knapp:** Weniger als 10 % Puffer zur Beschränkung.
  - 🟢 **Passierbar:** Ausreichend Spielraum vorhanden.
- **Hybrid-Datenarchitektur:**
  - **PMTiles (Offline / CDN):** Vorgerenderte Vektorkacheln werden per HTTP Range Requests gestreamt. Es werden nur die exakten Bytes für den sichtbaren Ausschnitt geladen.
  - **Live Overpass API:** Außerhalb vorgerenderter Regionen wird automatisch die Overpass API mit Multi-Server-Failover und robusten Fehlermeldungen abgefragt.
- **Responsive UI:** Filterleiste, detaillierte Marker-Popups mit OSM-Links, Schnellwahl von Städten und Status-Badges.

---

## 🛠️ Entwicklung

### Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 20 oder höher empfohlen)
- [npm](https://www.npmjs.com/)
- Optional für die PMTiles-Generierung: [Tippecanoe](https://github.com/felt/tippecanoe)

### Installation

```bash
git clone https://github.com/mathiasmuller/lkw-karten.git
cd lkw-karten
npm install
```

### Entwicklungs-Befehle

| Befehl | Beschreibung |
|---|---|
| `npm run dev` | Startet den Vite-Entwicklungsserver (inkl. HMR) unter `http://localhost:5173` |
| `npm test` | Führt die Test-Suite (Vitest) aus |
| `npm run lint` | Prüft den Code mit ESLint |
| `npm run build` | Erzeugt den TypeScript- und Vite-Produktions-Build im Ordner `dist/` |
| `npm run preview` | Startet einen lokalen Server zur Vorschau des `dist/`-Builds |

---

## 📦 PMTiles-Vektorkacheln generieren

Um LKW-Restriktionen in Millisekunden stufenlos darzustellen, werden OSM-Daten in Vektorkacheln im [PMTiles-Format](https://protomaps.com/docs/pmtiles) kompiliert.

### 1. Tippecanoe installieren

Tippecanoe wird benötigt, um GeoJSON in hochoptimierte Vektorkacheln zu konvertieren:

- **macOS (Homebrew):**
  ```bash
  brew install tippecanoe
  ```
- **Linux (Ubuntu/Debian):**
  ```bash
  sudo apt-get install build-essential libsqlite3-dev zlib1g-dev
  git clone https://github.com/felt/tippecanoe.git
  cd tippecanoe
  make -j
  sudo make install
  ```

### 2. Daten herunterladen & PMTiles erstellen (Beispiel: Bayern)

Im Projekt ist ein automatisiertes Skript vorhanden, das die OSM-Daten über Overpass abfragt, die Maßeinheiten normalisiert und direkt die PMTiles-Datei baut:

```bash
npm run download:bayern
```

**Was das Skript intern macht:**
1. Es sendet eine gezielte Overpass-Abfrage für ganz Bayern (`ISO3166-2: DE-BY`) nach Elementen mit `maxheight`, `maxwidth`, `maxweight` oder `maxaxleload`.
2. Es normalisiert Werte (z. B. Kommas, Meter, Fuß/Zoll wie `13'6"`, Tonnen, lbs) in numerische Werte.
3. Es speichert das Zwischenergebnis unter `data/bayern-restrictions.geojson`.
4. Wenn `tippecanoe` auf dem System installiert ist, generiert es automatisch die Datei:
   ```
   public/bayern.pmtiles
   ```

### 3. Manuelle Kachelung eines vorhandenen GeoJSON

Falls das GeoJSON bereits unter `data/bayern-restrictions.geojson` existiert, kann die Kacheldatei jederzeit neu erzeugt werden:

```bash
npm run build:pmtiles
```

Verwendete Tippecanoe-Parameter:
- `-o public/bayern.pmtiles`: Zielpfad im `public/`-Ordner (wird von Vite/Webserver statisch bereitgestellt).
- `-z16 -Z0`: Zoomlevel von 0 (Ganzansicht) bis 16 (Detail-Straßenebene).
- `--drop-densest-as-needed`: Reduziert Punkte auf niedrigen Zoom-Stufen automatisch, um Kacheln klein zu halten.
- `-l restrictions`: Name des Vektorlayers in der MVT-Kachel.
- `--force`: Überschreibt bestehende Zieldateien.

### 4. Ganze Bundesländer / Deutschland via Geofabrik PBF (Optional)

Für noch größere Datenmengen oder ganz Deutschland kann der vollständige PBF-Dump heruntergeladen werden:

```bash
node scripts/download-bayern.mjs --pbf
```

Die heruntergeladene Datei `data/bayern-latest.osm.pbf` kann anschließend mit Werkzeugen wie `osmium-tool` oder [Planetiler](https://github.com/onthegomap/planetiler) verarbeitet werden.

---

## 🏛️ Projektstruktur

```
lkw-karten/
├── public/
│   └── bayern.pmtiles         # Vektor-Kacheln für Bayern (HTTP Range Requests)
├── scripts/
│   └── download-bayern.mjs    # Extraktions- & Konvertierungsskript
├── src/
│   ├── App.tsx                # Hauptkomponente mit Hybrid-Lade-Logik & State
│   ├── MapView.tsx            # Leaflet-Karte & Marker-Rendering
│   ├── Controls.tsx           # Filter für LKW-Maße & Schnellnavigation
│   ├── pmtilesService.ts      # Clientseitiges Laden & Dekodieren der PMTiles
│   ├── osmService.ts          # Live-Abfrage Overpass API (Multi-Server-Failover)
│   ├── osmParser.ts           # Einheitliche Normalisierung von OSM-Tags
│   ├── types.ts               # TypeScript-Typdefinitionen & Interfaces
│   └── index.css / App.css    # Styling
└── .github/workflows/
    └── deploy.yml             # CI/CD: Automatische Bereitstellung auf GitHub Pages
```

---

## 🚢 Deployment (GitHub Pages)

Das Projekt wird per GitHub Actions automatisch bei jedem Push auf den `master`-Branch gebaut und auf GitHub Pages veröffentlicht:
1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. Deployment des `dist/`-Verzeichnisses auf GitHub Pages
