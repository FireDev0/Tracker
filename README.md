# Manga Tracker (React + Firebase)

> Un’app web **personale** per tracciare manga/manhwa/manhua/novel, con pagine multiple, sincronizzazione su cloud e **note testuali cifrate** con PIN. Stack: React + TypeScript, Vite e Tailwind CSS.

**Languages:** Italiano • English

---

## 🇮🇹 Panoramica (IT)

### ✨ Caratteristiche principali
- **Pagine multiple**: crea, rinomina, riordina e cancella pagine.
  - Pagina **Normale** (lista serie) oppure **Pagina di testo** (editor note).
  - **Access confirm** (opzionale): prima di entrare nella pagina viene mostrato un semplice `confirm` (non è più legato a 18+).
  - **PIN di pagina** (opzionale): blocca accesso/modifica finché non inserisci il PIN.
- **Lista serie comoda**:
  - Campi: titolo, tipo (manga/manhwa/manhua/novel), capitoli, volumi, stato.
  - **Ricerca**, **filtri** per stato e **ordinamenti**: manuale, per titolo, per ultima modifica, per capitoli (asc/desc).
  - **Ordinamento manuale** con posizioni; puoi anche inserire direttamente il numero di posizione.
  - **Selezione multipla** con azioni rapide (es. elimina).
  - **Immagini**: URL esterno o upload locale.
  - **Import TXT**: incolla una lista (uno per riga) e genera le voci automaticamente.
- **Pagine di testo con note cifrate**:
  - **PIN globale**: cifra/decifra le note delle pagine che non hanno un loro PIN.
  - **PIN per pagina**: cifra/decifra solo quella pagina.
  - Cifratura **AES‑GCM** con chiave derivata via **PBKDF2** (~200k iterazioni). Il PIN **non** è mai salvato in chiaro.
  - Opzione “**Ricorda PIN**” per sessione o per dispositivo.
  - **Backup locali** cifrati (rotazione fino a 3) per ripristinare facilmente.
- **Cloud sync** (opzionale): login con Google e sincronizzazione su **Firebase Firestore**. **Autosave** dopo ogni modifica.
- **UI bilingue**: Italiano/English e **formato data** configurabile (IT o EN).
- **Performance**: Vite + React + Tailwind; nessun backend personale da mantenere.

> ⚠️ **Sicurezza**: la cifratura avviene lato client. Se perdi il PIN **non è recuperabile**. Esegui periodicamente **Export JSON** come backup.

### 🧭 Struttura del progetto
```
/public
/src
  ├─ MangaTrackerApp.tsx   # componente principale + logica UI
  ├─ main.tsx              # bootstrap React
  ├─ index.css             # stili (Tailwind)
  └─ firebase.ts           # inizializzazione Firebase (Auth + Firestore)
index.html                 # entry Vite
firebase.json              # config Hosting (SPA)
tailwind.config.js         # Tailwind
vite.config.ts             # Vite
```

### 🚀 Avvio rapido (dev)
Prerequisiti: **Node.js 20+**, npm/yarn/pnpm.

```bash
npm install
npm run dev    # http://localhost:5173
# opzionale
npm run lint
```

### ⚙️ Configurazione Firebase
1. Crea un progetto su https://console.firebase.google.com
2. Abilita **Authentication → Google** e **Cloud Firestore**.
3. Copia le credenziali Web e inseriscile in `src/firebase.ts` (oppure usa variabili d’ambiente `VITE_*`).
4. Avvia l’app, fai login: i dati saranno salvati nel tuo Firestore.

### 🛫 Build & Deploy (Firebase Hosting)
```bash
npm run build                 # genera /dist
firebase deploy --only hosting
```
Il `firebase.json` è già impostato per **single-page app** (rewrite su `index.html`).

### 💾 Import/Export
- **Export JSON**: scarica tutte le pagine/serie/impostazioni (backup consigliato).
- **Import JSON**: sovrascrive lo stato corrente.
- **Import TXT**: genera voci da una lista di titoli (uno per riga).

### 🧩 Stack & Script
- **React 19 + TypeScript**, **Vite 7**, **Tailwind 3**, **Firebase 12**, **Lucide Icons**.
- Script:
  - `npm run dev` – avvio locale
  - `npm run build` – build produzione
  - `npm run preview` – serve la build localmente
  - `npm run lint` – ESLint

### 🗺️ Roadmap (idee)
- Drag & drop per riordinare le serie
- Tema chiaro/scuro
- Storage immagini su Firebase Storage (opzionale)
- Miglior gestione conflitti offline/online

### 📄 Licenza
Progetto personale. Nessuna licenza open source (repo privata).

---

## 🇬🇧 Overview (EN)

### ✨ Key features
- **Multiple pages**: create, rename, reorder and delete pages.
  - **Normal page** (series list) or **Text page** (note editor).
  - **Access confirm** (optional): a simple confirm dialog before entering a page (no longer “18+” specific).
  - **Per‑page PIN** (optional): locks reading/editing until the PIN is provided.
- **Comfortable series list**:
  - Fields: title, type (manga/manhwa/manhua/novel), chapters, volumes, status.
  - **Search**, **status filters** and **sorting**: manual, by title, last edited, chapters (asc/desc).
  - **Manual ordering** with positions (you can also type the index directly).
  - **Multi‑select** actions (e.g., delete).
  - **Images**: external URL or local upload.
  - **TXT import**: paste one title per line to generate entries.
- **Encrypted text pages**:
  - **Global PIN**: encrypt/decrypt text pages that have no own PIN.
  - **Per‑page PIN**: encrypts/decrypts only that page.
  - **AES‑GCM** encryption + **PBKDF2** key derivation (~200k iterations). The PIN is **never** stored in plain text.
  - “**Remember PIN**” for the current session or the device.
  - **Local encrypted backups** (up to 3) to quickly restore content.
- **Cloud sync** (optional): Google login + **Firebase Firestore**. **Autosave** after each change.
- **Bilingual UI**: Italian/English and separate **date language**.
- **Performance**: Vite + React + Tailwind; no custom backend required.

> ⚠️ **Security**: encryption happens on the client. If you lose the PIN, it **cannot** be recovered. Run regular **JSON exports** as backups.

### 🧭 Project layout
See the code tree above.

### 🚀 Quick start
```bash
npm install
npm run dev
# optional
npm run lint
```

### ⚙️ Firebase setup
Enable **Google sign‑in** and **Cloud Firestore**, then paste your web credentials into `src/firebase.ts` (or use `VITE_*` env vars).

### 🛫 Build & deploy (Firebase Hosting)
```bash
npm run build
firebase deploy --only hosting
```

### 💾 Import/Export
- **Export JSON** (backup), **Import JSON**, and **TXT import** (one title per line).

### 🧩 Stack & Scripts
React + TypeScript, Vite, Tailwind, Firebase. Scripts: `dev`, `build`, `preview`, `lint`.

### 📄 License
Personal project. No open‑source license (private repository).

---

> Suggerimenti e fix sono benvenuti tramite Pull Request (se il repo è reso pubblico in futuro).