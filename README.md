# Tracker (React + Firebase)

**Languages:** [Italiano](#italiano) • [English](#english)

---

## Italiano

### Panoramica
App web personale per tracciare serie (manga/manhwa/manhua/novel) con pagine multiple, sincronizzazione su cloud e note cifrate. Stack: React + TypeScript (Vite) e Tailwind CSS, integrazione Firebase (Auth + Firestore).

### ✨ Funzionalità
- **Pagine multiple**: crea, rinomina, riordina e cancella. Ogni pagina può essere:
  - normale (lista serie)
  - di testo (editor note)
  - con **conferma d’accesso** opzionale
  - con **PIN per pagina** opzionale (solo hash, non il PIN in chiaro)
- **Lista serie** con ricerca, filtri per stato e ordinamenti: manuale, titolo, ultima modifica, capitoli (asc/desc).
- **Pagine di testo cifrate**:
  - **PIN globale** o **PIN per pagina**
  - Cifratura **AES‑GCM** con chiave derivata via **PBKDF2** (tutto lato client)
  - Fino a **3 backup locali cifrati** per ripristino rapido
- **Cloud sync (opzionale)**: login Google + **Cloud Firestore** con **autosave**.
  - Collezione principale: **`tracker`**
  - **Fallback/migrazione automatica** dalla legacy `mangaTracker` al primo accesso
- **UI bilingue** (IT/EN) e **lingua della data** separata dalla lingua UI.
- **Export/Import** JSON dell’intero stato; **Import TXT** (un titolo per riga) per generare voci rapidamente.

> **Sicurezza**: la cifratura avviene lato client. Se perdi il PIN non è recuperabile. Esegui periodicamente **Export JSON** come backup.

### Struttura del progetto
```
/src
  ├─ TrackerApp.tsx      # componente principale + UI/logic
  ├─ main.tsx            # bootstrap React (monta <TrackerApp />)
  ├─ index.css           # stili (Tailwind)
  └─ firebase.ts         # inizializzazione Firebase (Auth + Firestore)
index.html               # entry Vite (titolo: Tracker)
firebase.json            # config Hosting (SPA) + riferimento alle rules
firestore.rules          # regole Firestore versionate nel repo
```

### Stack & Script
- **React + TypeScript**, **Vite**, **Tailwind CSS**
- **Firebase** (Auth + Firestore)
- **Framer Motion**, **Lucide React**
- Script (`package.json`):
  - `npm run dev` – avvio locale (Vite)
  - `npm run build` – build produzione
  - `npm run preview` – serve la build localmente
  - `npm run lint` – lint del progetto

### Configurazione Firebase
1. Crea/usa un progetto su https://console.firebase.google.com e abilita:
   - **Authentication → Google**
   - **Cloud Firestore**
2. Inserisci le credenziali Web in `src/firebase.ts`.
3. Tieni **le regole Firestore nel file `firestore.rules`** del repo (non modificarle dalla console).
   `firebase.json` punta già a questo file tramite `"firestore": { "rules": "firestore.rules" }`.

#### Regole Firestore (esempio)
```
rules_version = '2';
service cloud.firestore {
  function isOwner(uid) {
    return request.auth != null && request.auth.uid == uid;
  }
  match /databases/{database}/documents {
    // nuova collezione
    match /tracker/{uid} {
      allow read, write: if isOwner(uid);
      match /pages/{pageId} {
        allow read, write: if isOwner(uid);
      }
    }
    // legacy, sola lettura per migrazione
    match /mangaTracker/{uid} {
      allow read: if isOwner(uid);
      match /pages/{pageId} {
        allow read: if isOwner(uid);
      }
    }
  }
}
```

### Sviluppo, Build & Deploy
```bash
# sviluppo
npm install
npm run dev

# build produzione
npm run build

# deploy solo hosting (sito)
firebase deploy --only hosting

# deploy regole firestore
firebase deploy --only firestore

# deploy completo (hosting + firestore rules)
firebase deploy
```

### Import/Export
- **Export JSON**: scarica pagine/serie/impostazioni (backup consigliato).
- **Import JSON**: ripristina lo stato da un file di backup.
- **Import TXT**: incolla una lista (un titolo per riga) per generare voci automaticamente.

---

## English

### Overview
Personal web app to track series (manga/manhwa/manhua/novel) with multiple pages, cloud sync and encrypted notes. Stack: React + TypeScript (Vite) and Tailwind CSS, with Firebase (Auth + Firestore).

### ✨ Features
- **Multiple pages**: create, rename, reorder, delete. Each page can be:
  - normal (series list)
  - text (notes editor)
  - with optional **access confirm**
  - with optional **per‑page PIN** (hashed; the PIN is never stored in plain)
- **Series list** with search, status filters and sorting: manual, title, last edited, chapters (asc/desc).
- **Encrypted text pages**:
  - **Global PIN** or **per‑page PIN**
  - **AES‑GCM** encryption with key derived via **PBKDF2** (entirely client‑side)
  - Up to **3 local encrypted backups** for quick restore
- **Cloud sync (optional)**: Google login + **Cloud Firestore** with **autosave**.
  - Main collection: **`tracker`**
  - **Automatic fallback/migration** from legacy `mangaTracker` on first access
- **Bilingual UI** (IT/EN) and **date language** separate from UI language.
- **Export/Import** JSON for the whole state; **Import TXT** (one title per line) to quickly generate entries.

> **Security**: encryption happens client‑side. If you lose the PIN it cannot be recovered. Regularly run **Export JSON** as a backup.

### Project structure
```
/src
  ├─ TrackerApp.tsx      # main component + UI/logic
  ├─ main.tsx            # React bootstrap (mounts <TrackerApp />)
  ├─ index.css           # styles (Tailwind)
  └─ firebase.ts         # Firebase init (Auth + Firestore)
index.html               # Vite entry (tab title: Tracker)
firebase.json            # Hosting config (SPA) + rules reference
firestore.rules          # Firestore rules under version control
```

### Stack & Scripts
- **React + TypeScript**, **Vite**, **Tailwind CSS**
- **Firebase** (Auth + Firestore)
- **Framer Motion**, **Lucide React**
- Scripts (from `package.json`):
  - `npm run dev` – local dev (Vite)
  - `npm run build` – production build
  - `npm run preview` – serve built app locally
  - `npm run lint` – project lint

### Firebase setup
1. Create/use a project at https://console.firebase.google.com and enable:
   - **Authentication → Google**
   - **Cloud Firestore**
2. Put your Web credentials into `src/firebase.ts`.
3. Keep **Firestore rules in `firestore.rules`** (don’t edit them in console).
   `firebase.json` already points to it via `"firestore": { "rules": "firestore.rules" }`.

#### Firestore rules (example)
```
rules_version = '2';
service cloud.firestore {
  function isOwner(uid) {
    return request.auth != null && request.auth.uid == uid;
  }
  match /databases/{database}/documents {
    // new collection
    match /tracker/{uid} {
      allow read, write: if isOwner(uid);
      match /pages/{pageId} {
        allow read, write: if isOwner(uid);
      }
    }
    // legacy, read-only for migration
    match /mangaTracker/{uid} {
      allow read: if isOwner(uid);
      match /pages/{pageId} {
        allow read: if isOwner(uid);
      }
    }
  }
}
```

### Development, Build & Deploy
```bash
# development
npm install
npm run dev

# production build
npm run build

# deploy hosting only
firebase deploy --only hosting

# deploy firestore rules
firebase deploy --only firestore

# full deploy (hosting + firestore rules)
firebase deploy
```

### Import/Export
- **Export JSON**: download pages/series/settings (recommended backup).
- **Import JSON**: restore state from a backup file.
- **Import TXT**: paste a list (one title per line) to generate entries automatically.

---

### License
© 2025 FireDev0 — All rights reserved.  
This project is published for viewing purposes only.  
See [LICENSE](LICENSE) for details.