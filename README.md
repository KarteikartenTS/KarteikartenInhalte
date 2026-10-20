# 📚 Jetzt lernen

## 👉 [karteikartents.github.io/KarteikartenInhalte](https://karteikartents.github.io/KarteikartenInhalte/)

[![Video ansehen: Karteikarten der TÜV SÜD Akademie (1 Minute)](video/vorschau.jpg)](https://karteikartents.github.io/KarteikartenInhalte/video/karteikarten.mp4)

▶ **[Video ansehen (1 Minute)](https://karteikartents.github.io/KarteikartenInhalte/video/karteikarten.mp4)**



**Einfach den Link antippen.** Funktioniert direkt im Browser auf iPhone, iPad, Android, Mac und PC, ohne Anmeldung.

| Gerät | So geht's |
|---|---|
| 📱 **iPhone / iPad** | Link in **Safari** öffnen → **Teilen** → **„Zum Home-Bildschirm“**. Dann startet die Karteikarten wie eine eigene App. |
| 🤖 **Android** | Link in **Chrome** öffnen → Menü ⋮ → **„App installieren“** (Firefox: Menü → „Installieren“). |
| 💻 **Mac (Safari)** | Menü **Ablage** → **„Zum Dock hinzufügen“**. |
| 🖥️ **PC (Chrome / Edge)** | Installieren-Symbol rechts in der Adressleiste. |

Die genaue Anleitung für dein Gerät zeigt die Seite selbst: Menü ⋮ → **„Zum Home-Bildschirm hinzufügen“**.

> Prototyp der TÜV SÜD Akademie. Öffentlich ist das Modul **PTI 1**; weitere Module werden mit einem Freischalt-Code
> aus dem Lehrgang sichtbar.

---

## Für Entwickler

Dieses Repo enthält nur noch die **Web-App** (`index.html`, `app.js`, `app.css`, `sw.js`, `manifest.webmanifest`,
`icons/`), ausgeliefert über GitHub Pages.

### Wo liegen die Inhalte?

Die Karteikarten werden **nicht mehr hier** gepflegt. Sie liegen auf dem Cloud-Server
**[karteikarten-admin.pages.dev](https://karteikarten-admin.pages.dev)** und werden dort im **Admin-Panel**
verwaltet: Module, Karten, Freischalt-Codes, Meldungen der Lernenden und Korrekturhistorie.
Die Web-App lädt sie beim Start von dort (`/api/modules`) und hält eine Kopie für den Offline-Betrieb.

| Projekt | Zweck |
|---|---|
| **KarteikartenInhalte** (dieses Repo) | Web-App für Lernende |
| **Admin-Panel** auf [karteikarten-admin.pages.dev](https://karteikarten-admin.pages.dev) | Inhalte pflegen und freischalten (Zugang nur für Redaktion und Admin) |
| **[KarteikartenMCP](https://github.com/KarteikartenTS/KarteikartenMCP)** | Karten mit Claude Code bearbeiten – Einrichtung mit einer Zeile |

Karten und Bilder werden **nicht** auf GitHub gespeichert. Änderungen an Karten ausschließlich im Admin-Panel
bzw. über den MCP-Server vornehmen.

### Hinweise zur Web-App

- Lernstand liegt im Browser (localStorage) je Karte unter ihrer ID und bleibt bei Korrekturen erhalten;
  Geräte lassen sich per Code/QR verbinden (Ende-zu-Ende-verschlüsselt).
- Nach Änderungen an `app.js`/`app.css`: `APP_VERSION` in `app.js`, `?v=` in `index.html` und `CACHE` in `sw.js` erhöhen.

Die älteren Releases mit `.apkg`-Dateien sind veraltet und werden nicht mehr gepflegt.
