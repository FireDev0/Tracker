# Tracker (React + Firebase)

> App web personale per tracciare serie (manga/manhwa/manhua/novel) con pagine multiple, sincronizzazione su cloud e note cifrate. Stack: React + TypeScript (Vite) e Tailwind CSS, integrazione Firebase (Auth + Firestore).

**Languages:** Italiano • English

---

## 🇮🇹 Panoramica

### ✨ Funzionalità principali
- **Pagine multiple**: crea, rinomina, riordina e cancella. Ogni pagina può essere:
  - normale (lista serie)
  - di testo (editor note)
  - con **conferma d’accesso** opzionale
  - con **PIN per pagina** opzionale (solo hash, non il PIN in chiaro)
- **Lista serie** con ricerca, filtri per stato e vari ordinamenti: manuale, per titolo, per ultima modifica, per capitoli (asc/desc).
- **Pagine di testo cifrate**:
  - **PIN globale** o **PIN per pagina**
  - Cifratura **AES‑GCM** con chiave derivata via **PBKDF2** (tutto lato client)
  - Fino a **3 backup locali cifrati** per il ripristino rapido
- **Cloud sync (opzionale)**: Login Google + **Cloud Firestore** con **autosave** dopo ogni modifica.
  - Collezione principale: **`tracker`**
  - **Fallback/migrazione automatica** dalla vecchia collezione `mangaTracker` al primo accesso
- **UI bilingue**: Italiano/English, con lingua della data separata dalla lingua UI.
- **Export/Import** JSON dell’intero stato; **Import TXT** (un titolo per riga) per generare rapidamente voci.

> Sicurezza: la cifratura avviene lato client. Se perdi il PIN non è recuperabile. Effettua periodicamente un **Export JSON** come backup.

---

### 🧭 Struttura progetto (essenziale)
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

---

### 🧩 Stack & Script
- **React + TypeScript**, **Vite**, **Tailwind CSS**
- **Firebase** (Auth + Firestore)
- **Framer Motion**, **Lucide React**
- Script (`package.json`):
  - `npm run dev` – avvio locale (Vite)
  - `npm run build` – build produzione (`tsc -b && vite build`)
  - `npm run preview` – serve la build localmente
  - `npm run lint` – lint del progetto

---

### ⚙️ Configurazione Firebase
1. Crea/usa un progetto su https://console.firebase.google.com e abilita:
   - **Authentication → Google**
   - **Cloud Firestore**
2. Inserisci le credenziali Web in `src/firebase.ts` (config del tuo progetto Firebase).
3. Tieni **le regole Firestore nel file `firestore.rules`** del repo (non modificarle dalla console).  
   `firebase.json` punta già a questo file tramite `"firestore": { "rules": "firestore.rules" }`.

#### Regole consigliate (esempio)
```
// Consenti lettura/scrittura su `tracker` solo al proprietario (uid) e sola lettura su `mangaTracker` per migrare.
rules_version = '2';
service cloud.firestore {
  function isOwner(uid) {
    return request.auth != null && request.auth.uid == uid;
  }
  match /databases/{database}/documents {
    match /tracker/{uid} {
      allow read, write: if isOwner(uid);
      match /pages/{pageId} {
        allow read, write: if isOwner(uid);
      }
    }
    match /mangaTracker/{uid} {
      allow read: if isOwner(uid);
      match /pages/{pageId} {
        allow read: if isOwner(uid);
      }
    }
  }
}
```

---

### 🚀 Sviluppo, Build & Deploy
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

---

### 💾 Import/Export
- **Export JSON**: scarica pagine/serie/impostazioni (backup consigliato).
- **Import JSON**: ripristina lo stato da un file di backup.
- **Import TXT**: incolla una lista (un titolo per riga) per generare voci automaticamente.

---

## 🇬🇧 Overview

### ✨ Key features
- **Multiple pages**: normal or text pages; optional **access confirm** and **per‑page PIN** (hashed, not stored in plain text).
- **Series list** with search, status filters and sorting (manual, title, last edited, chapters asc/desc).
- **Encrypted text pages**: **AES‑GCM** + **PBKDF2** (client‑side), up to **3 local encrypted backups**.
- **Cloud sync** (optional): Google login + **Firestore**, autosave on every change. Collection: **`tracker`** with legacy migration from `mangaTracker`.
- **Bilingual UI** (IT/EN) and separate date language.
- **Export/Import** JSON; **Import TXT** for quick list creation.

### 🛠 Project setup & scripts
See `package.json` for scripts:
- `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`.

### 🛫 Build & Deploy
Typical flow:
```bash
npm run build
firebase deploy         # or: --only hosting / --only firestore
```

---

### 📄 License
Personal project. No open-source license.
