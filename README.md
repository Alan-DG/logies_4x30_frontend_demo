# Controlesysteem Logiesdecreet — 4×30-regel

**Proof of concept** — monitoringtool voor de mogelijke implementatie van de 4×30-dagenregel ivm het Vlaams logiesdecreet in de stad Leuven.  
Gebouwd voor **Stad Leuven**, in context van een stage bij de dienst Visit Leuven.

🔗 **Live demo:** [controlesysteem-logies-4x30.vercel.app](https://controlesysteem-logies-4x30.vercel.app/)

---

## Wat doet dit systeem?

Het Vlaams logiesdecreet bepaalt dat een logies voor verhuur een specifieke omgevingsvergunning nodig heeft. Via de **4×30-regel** zou een kortetermijnverhuurder maximaal **4 perioden van 30 dagen** per kalenderjaar mogen verhuren zonder omgevingsvergunning. 

Dit systeem laat een medewerker toe om een Excel-export van boekingsplatformdata (data zoals intern aangeleverd) te uploaden en automatisch te controleren tegenover het basisregister Logies van Toersime Vlaanderen op vijf vlagtypen:

| Vlag | Beschrijving |
|------|-------------|
| **4×30** | Meer dan 4 verhuurperioden van 30 dagen — vergunning mogelijk vereist |
| **Units** | Gelijktijdige boekingen overschrijden het geregistreerde aantal units |
| **Cap.** | Gelijktijdige gasten overschrijden de maximumcapaciteit |
| **Onbek.** | Registratienummer niet gevonden in het Vlaams basisregister |
| **Adres** | Adres in de boekingsdata wijkt af van het basisregister |

Vlaggen zijn **signalen voor menselijk nazicht**, geen juridische conclusies.

---

## Architectuur

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│                                                     │
│  ┌─────────────┐   uploads .xlsx   ┌─────────────┐  │
│  │  Dashboard  │ ◄───────────────  │   Upload    │  │
│  │  + kaart    │                   │   scherm    │  │
│  └──────┬──────┘                   └─────────────┘  │
│         │ runAnalysis() — volledig in de browser    │
│         │ (geen data verstuurd naar server)         │
└─────────┼───────────────────────────────────────────┘
          │ GET /api/basisregister (1×/uur, gecached)
          ▼
┌─────────────────────────────────────────────────────┐
│  Vercel Serverless Function (api/basisregister.js)  │
│                                                     │
│  1. Scrapt linked.toerismevlaanderen.be/datasets    │
│  2. Downloadt actuele CSV (~10 MB)                  │
│  3. Filtert op Leuven (postcodes 3000/3001/3010/    │
│     3012/3018) + product_type BASE                  │
│  4. Retourneert genormaliseerde JSON                │
└─────────────────────────────────────────────────────┘
```

De **analyse-engine** (`runAnalysis` in `App.js`) spiegelt de algoritmen van wat origineel een Python-script (`logies_4x30_controle.py`) was.

---

## Features

- **Upload** van `.xlsx`-reservatiedata (drag-and-drop of bestandsselectie)
- **Live basisregister**: de actuele versie van het Vlaams basisregister logies wordt bij elke sessie opgehaald (gecached 1 uur via Vercel CDN)
- **Dashboard** met statistieken, filterbare tabel en detailpaneel per accommodatie
  - Periodeanalyse met visuele tijdlijn
  - Gelijktijdigheidsdetails per dag
  - Adresvergelijking basisregister ↔ boekingsdata
- **Kaartoverzicht** (Leaflet) met alle Leuvense logies uit het basisregister
  - Drie lagen: basisregister-only, platformdata zonder vlaggen, platformdata met vlaggen
  - Filters op logiestype, grootte (aantal eenheden) en specifieke vlagtypen
  - Zoeken op registratienummer met fly-to animatie
- Volledig **privacyvriendelijk**: geüploade bestanden worden enkel in de browser verwerkt en nooit naar een server verstuurd

---

## Vereist Excel-formaat

Het te uploaden bestand moet een `.xlsx`-bestand zijn waarvan het **eerste tabblad** de volgende kolomnamen bevat (exacte spelling):

| Kolomnaam | Beschrijving |
|-----------|-------------|
| `Registratienummer logies` | Numeriek ID uit het Vlaams basisregister |
| `Listing URL` | URL van de listing op het platform |
| `Adres STR-unit` | Adres zoals opgegeven op het platform |
| `Begindatum boeking` | DD/MM/YYYY of ISO-formaat |
| `Einddatum boeking` | DD/MM/YYYY of ISO-formaat |
| `Totaal aantal gasten` | Numeriek |
| `Boekingsplatform` | Bijv. Airbnb, Booking.com, VRBO |

Bij het testen dient een dummydata bestand gebruikt te worden die geen private gegevens bevat.

---

## Lokaal draaien

**Vereisten:** Node.js ≥ 16, npm

```bash
# 1. Afhankelijkheden installeren
npm install

# 2. Ontwikkelserver starten
npm start
```

> **Let op:** `/api/basisregister` is een Vercel serverless function en draait niet lokaal via `npm start`. Gebruik de Vercel CLI voor een volledige lokale omgeving:
> ```bash
> npm install -g vercel
> vercel dev
> ```

---

## Deployment

Het project is geïmporteerd in **Vercel** vanuit deze GitHub-repository. Elke push naar de `main`-branch triggert automatisch een nieuwe build en deployment.

Configuratie staat in `vercel.json`: alle routes worden doorgestuurd naar `index.html` (SPA-routing), uitgezonderd `/api/*` dat naar de serverless functions gaat.

---

## Projectstructuur

```
├── App.js                    # React-applicatie (dashboard + kaart)
├── index.js                  # Entrypoint
├── index.html                # HTML-shell
├── style.css                 # Globale CSS (variabelen, hover-klassen)
├── api/
│   └── basisregister.js      # Vercel serverless function
├── vercel.json               # Vercel routing-configuratie
├── package.json
├── logies_4x30_controle.py   # Referentie Python-script (analyse-engine), niet opgenomen in repo
└── reservaties_dummy_2026.xlsx  # Testdata (9 scenario's), niet opgenomen in repo
```

---

## Technische stack

| Laag | Technologie |
|------|-------------|
| Frontend | React 18 (Create React App) |
| Kaart | Leaflet 1.9 (imperatief, zonder react-leaflet) |
| Iconen | lucide-react |
| Excel parsing | SheetJS (xlsx 0.18) |
| Serverless | Vercel (Node.js runtime) |
| Hosting | Vercel (CDN + edge caching) |

---

## Beperkingen (POC)

- `ANALYSIS_YEAR` is vastgelegd op `2026` in de broncode. Bij gebruik in een volgend jaar dient dit aangepast te worden
- De gemeentegrens van Leuven (GeoJSON) is hardcoded in `App.js`
- De CSV-parser in `basisregister.js` gaat ervan uit dat velden geen puntkomma's bevatten
- De HTML-scraping van `linked.toerismevlaanderen.be/datasets` is gevoelig voor wijzigingen in de paginastructuur

---

*Ontwikkeld als intern proof of concept. Geen juridisch instrument.*
