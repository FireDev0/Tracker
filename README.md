
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
  └─ firebase.ts         # inizializzazione Firebase (Auth + Firestore + App Check)
index.html               # entry Vite (titolo: Tracker)
firebase.json            # config Hosting (SPA) + riferimento alle rules
firestore.rules          # regole Firestore versionate nel repo
```

### Stack & Script
- **React + TypeScript**, **Vite**, **Tailwind CSS**
- **Firebase** (Auth + Firestore, **App Check reCAPTCHA v3**)
- **Framer Motion**, **Lucide React**
- Script (`package.json`):
  - `npm run dev` – avvio locale (Vite)
  - `npm run build` – build produzione
  - `npm run preview` – serve la build localmente
  - `npm run lint` – lint del progetto

---

## Configurazione Firebase

1. Crea/usa un progetto su https://console.firebase.google.com e abilita:
   - **Authentication → Google**
   - **Cloud Firestore**
   - (GCP) **Identity Toolkit API**, **Cloud Firestore API**, **Firebase Installations API**

2. **App Check (reCAPTCHA v3)**
   - Crea una **Site key** e una **Secret** reCAPTCHA v3 per i domini del progetto (es. `tracker-<id>.web.app`, `tracker-<id>.firebaseapp.com`, `localhost`).  
   - In **Firebase → App Check → Web app (Tracker Web v3)** incolla la **Secret** e salva.
   - Nell’app usa la **Site key** come variabile d’ambiente `VITE_APPCHECK_SITE_KEY`.
   - **Sviluppo locale (opzionale):** imposta `VITE_APPCHECK_DEBUG=1` nel `.env.local` per usare il **token debug** di App Check in dev (evita il throttling).

3. **Variabili d’ambiente (`.env.local`)** *(non committare questo file)*
   ```bash
   VITE_FIREBASE_API_KEY=<YOUR_WEB_API_KEY>
   VITE_FIREBASE_AUTH_DOMAIN=<YOUR_AUTH_DOMAIN>             # es. tracker-<id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<YOUR_PROJECT_ID>               # es. tracker-<id>
   VITE_FIREBASE_STORAGE_BUCKET=<YOUR_STORAGE_BUCKET>       # es. tracker-<id>.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=<YOUR_SENDER_ID>
   VITE_FIREBASE_APP_ID=<YOUR_WEB_APP_ID>                   # es. 1:...:web:...
   VITE_APPCHECK_SITE_KEY=<YOUR_RECAPTCHA_V3_SITE_KEY>      # prod
   # Solo DEV
   VITE_APPCHECK_DEBUG=1
   ```

4. **Restringi la API key** (consigliato) – Google Cloud → *Credentials* → la **Browser key** in uso:
   - **HTTP referrers**:
     ```
     https://<your-host>.web.app/*
     https://<your-host>.firebaseapp.com/*
     http://localhost:5173/*
     ```
   - **Restrict to APIs** (consigliate):  
     **Identity Toolkit API**, **Cloud Firestore API**, **Firebase Installations API**, **Firebase App Check API**.  
     *(Facoltativo ma utile: **Token Service API**)*

5. **Regole Firestore** – tieni le regole nel file `firestore.rules` del repo (non modificarle dalla console).  
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

### Note importanti (produzione & domini)
- In **src/firebase.ts** c’è una **allow‑list di host** (localhost/127.0.0.1, `*.web.app`, `*.firebaseapp.com`). Se usi un **custom domain**, aggiungilo sia lì che nella console reCAPTCHA.
- Dopo aver cambiato chiavi o domini, rifai **build + deploy**.
- In console vedrai log diagnostici tipo `"[AppCheck] token ok"` quando l’inizializzazione va a buon fine.

### Troubleshooting / problemi comuni
- **App Check 403 / throttled (24h)** dopo una configurazione errata: correggi chiavi/domìni, poi in DevTools elimina **solo per questo sito**:
  - **IndexedDB** → `firebase-app-check-database`, `firebase-heartbeat-database` (se necessario `firebaseLocalStorageDb` per resettare la sessione Auth);
  - **Local Storage** → `_grecaptcha` (se presente).  
  Ricarica la pagina (o apri in finestra InPrivate).
- **Serve il login di nuovo dopo un deploy**: è normale se è cambiato host o sono scaduti i token.
- Avvisi tipo **“Tracking Prevention blocked access to storage”** in Edge sono innocui.

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

### Checklist pre‑deploy
- [ ] `VITE_APPCHECK_SITE_KEY` impostata e domini inseriti nel pannello reCAPTCHA.
- [ ] API key ristretta a referrer corretti e alle API consigliate.
- [ ] Regole Firestore pronte (file `firestore.rules`) e `firebase deploy --only firestore` eseguito se cambiate.

### Import/Export
- **Export JSON**: scarica pagine/serie/impostazioni (backup consigliato).
- **Import JSON**: ripristina lo stato da un file di backup.
- **Import TXT**: incolla una lista (un titolo per riga) per generare voci automaticamente.

---

### Licenza
© 2025 FireDev0 — Tutti i diritti riservati.  
Questo progetto è pubblicato solo a scopo di consultazione.  
Vedi il file [LICENSE](LICENSE) per i dettagli.

---

## English

### Overview
Personal web app to track series (manga/manhwa/manhua/novel) with multiple pages, cloud sync and encrypted notes. Stack: React + TypeScript (Vite) and Tailwind CSS, with Firebase (Auth + Firestore).

### ✨ Features
- **Multiple pages**: create, rename, reorder, delete. Each page can be:
  - normal (series list)
  - text (notes editor)
  - optional **access confirm**
  - optional **per‑page PIN** (hashed; the PIN is never stored in plain)
- **Series list** with search, status filters and sorting: manual, title, last edited, chapters (asc/desc).
- **Encrypted text pages**:
  - **Global PIN** or **per‑page PIN**
  - **AES‑GCM** encryption with key derived via **PBKDF2** (entirely client‑side)
  - Up to **3 local encrypted backups** for quick restore
- **Cloud sync (optional)**: Google login + **Cloud Firestore** with **autosave**.
  - Main collection: **`tracker`**
  - **Automatic fallback/migration** from legacy `mangaTracker` on first access
- **Bilingual UI** and **date language** separate from UI language.
- **Export/Import** JSON; **Import TXT** (one title per line) to generate entries quickly.

> **Security**: encryption happens client‑side. If you lose the PIN it cannot be recovered. Back up via **Export JSON** regularly.

### Project structure
```
/src
  ├─ TrackerApp.tsx      # main component + UI/logic
  ├─ main.tsx            # React bootstrap (mounts <TrackerApp />)
  ├─ index.css           # styles (Tailwind)
  └─ firebase.ts         # Firebase init (Auth + Firestore + App Check)
index.html               # Vite entry (tab title: Tracker)
firebase.json            # Hosting config (SPA) + rules reference
firestore.rules          # Firestore rules under version control
```

### Stack & Scripts
- **React + TypeScript**, **Vite**, **Tailwind CSS**
- **Firebase** (Auth + Firestore, **App Check reCAPTCHA v3**)
- **Framer Motion**, **Lucide React**
- Scripts (from `package.json`):
  - `npm run dev` – local dev (Vite)
  - `npm run build` – production build
  - `npm run preview` – serve built app locally
  - `npm run lint` – project lint

---

## Firebase setup

1. Create/use a project at https://console.firebase.google.com and enable:
   - **Authentication → Google**
   - **Cloud Firestore**
   - (GCP) **Identity Toolkit API**, **Cloud Firestore API**, **Firebase Installations API**

2. **App Check (reCAPTCHA v3)**
   - Create a **Site key** and a **Secret** for your domains (e.g., `tracker-<id>.web.app`, `tracker-<id>.firebaseapp.com`, `localhost`).  
   - In **Firebase → App Check → Web app** paste the **Secret** and save.
   - Use the **Site key** in the app via `VITE_APPCHECK_SITE_KEY`.
   - **Local dev (optional):** set `VITE_APPCHECK_DEBUG=1` in `.env.local` to enable the **debug token** (avoid throttling).

3. **Environment variables (`.env.local`)** *(never commit this file)*
   ```bash
   VITE_FIREBASE_API_KEY=<YOUR_WEB_API_KEY>
   VITE_FIREBASE_AUTH_DOMAIN=<YOUR_AUTH_DOMAIN>
   VITE_FIREBASE_PROJECT_ID=<YOUR_PROJECT_ID>
   VITE_FIREBASE_STORAGE_BUCKET=<YOUR_STORAGE_BUCKET>
   VITE_FIREBASE_MESSAGING_SENDER_ID=<YOUR_SENDER_ID>
   VITE_FIREBASE_APP_ID=<YOUR_WEB_APP_ID>
   VITE_APPCHECK_SITE_KEY=<YOUR_RECAPTCHA_V3_SITE_KEY>      # prod
   # DEV only
   VITE_APPCHECK_DEBUG=1
   ```

4. **API key hardening** – Google Cloud → *Credentials* → your **Browser key**:
   - **HTTP referrers**:
     ```
     https://<your-host>.web.app/*
     https://<your-host>.firebaseapp.com/*
     http://localhost:5173/*
     ```
   - **Restrict to APIs** (recommended):  
     **Identity Toolkit API**, **Cloud Firestore API**, **Firebase Installations API**, **Firebase App Check API**.  
     *(Optional but helpful: **Token Service API**)*

5. **Firestore rules** – keep rules in `firestore.rules` (don’t edit in console).  
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

### Important notes (production & domains)
- **src/firebase.ts** contains an **allow‑list** of hosts (localhost/127.0.0.1, `*.web.app`, `*.firebaseapp.com`). If you use a **custom domain**, add it there and in the reCAPTCHA admin.
- After changing keys or domains, run **build + deploy** again.
- Console diagnostics like `"[AppCheck] token ok"` indicate App Check initialized successfully.

### Troubleshooting
- **App Check 403 / throttled (24h)** after a wrong config: fix keys/domains, then in DevTools remove **only for this origin**:
  - **IndexedDB** → `firebase-app-check-database`, `firebase-heartbeat-database` (and `firebaseLocalStorageDb` if you need to reset local Auth);
  - **Local Storage** → `_grecaptcha` (if present).  
  Reload the page (or open in Private window).
- **Re-login after deploy** is normal if host changed or tokens expired.
- Edge **“Tracking Prevention blocked access to storage”** warnings are harmless.

### Development, Build & Deploy
```bash
npm install
npm run dev
npm run build
firebase deploy --only hosting
firebase deploy --only firestore
firebase deploy
```

### Pre‑deploy checklist
- [ ] `VITE_APPCHECK_SITE_KEY` set and domains present in reCAPTCHA admin.
- [ ] API key restricted to proper referrers and recommended APIs.
- [ ] Firestore rules ready (`firestore.rules`) and `firebase deploy --only firestore` run if changed.

### Import/Export
- **Export JSON**: download pages/series/settings (recommended backup).
- **Import JSON**: restore state from a backup file.
- **Import TXT**: paste a list (one title per line) to generate entries automatically.

---

### License
© 2025 FireDev0 — All rights reserved.  
This project is published for viewing purposes only.  
See [LICENSE](LICENSE) for details.