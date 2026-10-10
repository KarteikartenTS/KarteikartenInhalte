# Karteikarten-Inhalte (Demo)

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
