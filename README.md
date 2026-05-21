# Local OPDS Server (TypeScript)

Ein einfacher OPDS-Server, der eine lokale Verzeichnisstruktur als OPDS (Atom) Feed bereitstellt und Dateien unter `/files/` serviert.

Schnellstart:

1. Ebooks in `./ebooks/` legen (oder `EBOOK_DIR` setzen).
2. Abhängigkeiten installieren:

```bash
npm install
```

3. Projekt bauen und starten:

```bash
npm run build
npm start
```

Der OPDS-Feed ist verfügbar unter `http://localhost:3000/opds`.
