# 📚 Jetzt lernen

## 👉 [karteikartents.github.io/KarteikartenInhalte](https://karteikartents.github.io/KarteikartenInhalte/)

**Einfach den Link antippen.** Funktioniert direkt im Browser auf iPhone, iPad, Android und PC, ohne Anmeldung.

| Gerät | So geht's |
|---|---|
| 📱 **iPhone / iPad** | Link in **Safari** öffnen → unten auf **Teilen** tippen → **„Zum Home-Bildschirm“**. Dann startet die Karteikarten-App wie eine richtige App. |
| 🤖 **Android** | Die App zum Installieren gibt es hier: **[Android-App herunterladen](https://github.com/KarteikartenTS/KarteikartenAndroid/releases/tag/v0.1.0-demo)** |

> Demo-Version: enthält das Modul **PTI 1**. Die Karten sind unvollständig und dienen nur dem Kennenlernen.

---

## Für Entwickler: Karteikarten-Inhalte (Demo)

Öffentliche Auslieferung der Karteikarten-Module für die Karteikarten-App der TÜV SÜD Akademie (Prototyp).

**Demo-Inhalte:** Die Karten sind unvollständig und dienen nur dem Überblick. Sie sind nicht für den Prüfungseinsatz
gedacht.

## Auslieferung

Die Dateien liegen als **Release-Assets** am jeweils neuesten Release. Die App liest sie über die feste Adresse

```
https://github.com/KarteikartenTS/KarteikartenInhalte/releases/latest/download/<datei>
```

| Datei | Inhalt |
|---|---|
| `PTI-1.apkg` | Modul PTI 1 (167 Karten, 8 Unterstapel), ohne Lernstand |

## Regeln für neue Releases

- Ein neues Release muss **alle** Dateien enthalten (Karten und später die APK). Die App fragt immer nur
  `latest` ab. Fehlt dort eine Datei, findet die App sie nicht mehr.
- Karten werden in der Content-Pipeline des App-Repos erzeugt. Vor jedem Release `verify_update.py` laufen lassen.
- Tag-Schema: `inhalte-JJJJ-MM-TT` (bei mehreren am Tag mit Suffix `-2`, `-3` usw.).

## Web-App (iPhone/iPad)

Die Web-App liegt im Wurzelordner dieses Repos (`index.html`, `app.js`, `app.css`, `sw.js`) und wird über
GitHub Pages ausgeliefert. Sie lädt die Module aus `content/` (gleiche Domain, kein CORS-Problem).

- Inhalte erzeugen: im App-Repo `tools/content-pipeline/export_web.py <modul.apkg> <dieses-repo>/content <id> "<Titel>"`,
  Modul in `content/modules.json` eintragen.
- Lernstand liegt im Browser (localStorage) je Karte unter `<Note-GUID>:<ord>` und bleibt bei Korrekturen erhalten.
- Nach Änderungen an `app.js`/`app.css` die Cache-Version in `sw.js` (`CACHE`) erhöhen.
