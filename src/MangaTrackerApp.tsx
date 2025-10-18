// CLEANED v12.1 – automated fixes applied on 2025-10-12
// src/MangaTrackerApp.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { auth, provider, db } from "./firebase";
import { doc, collection, getDoc, getDocs, writeBatch, deleteField } from "firebase/firestore";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Edit3,
  ImagePlus,
  Plus,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  CheckSquare,
  Square,
  Cloud,
  Check,
  Minus,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";



// --- Encrypted backups (local-only) ---
type EncSnapshot = { id: string; when: number; mode: "global" | "page"; payload: any };
function pushBackup(pageId: string, mode: "global" | "page", payload: any) {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const db: Record<string, EncSnapshot[]> = raw ? JSON.parse(raw) : {};
    const arr = db[pageId] || [];
    arr.unshift({ id: pageId, when: Date.now(), mode, payload });
    db[pageId] = arr.slice(0, 3); // keep last 3
    localStorage.setItem(BACKUP_KEY, JSON.stringify(db));
  } catch {}
}
function peekBackup(pageId: string): EncSnapshot | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const db: Record<string, EncSnapshot[]> = raw ? JSON.parse(raw) : {};
    const arr = db[pageId] || [];
    return arr.length ? arr[0] : null;
  } catch { return null; }
}
function popBackup(pageId: string): EncSnapshot | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const db: Record<string, EncSnapshot[]> = raw ? JSON.parse(raw) : {};
    const arr = db[pageId] || [];
    const item = arr.shift() || null;
    if (arr.length) db[pageId] = arr; else delete db[pageId];
    localStorage.setItem(BACKUP_KEY, JSON.stringify(db));
    return item;
  } catch { return null; }
}
/* ================= Utils ================= */
const now = () => Date.now();
const uid = () =>
  Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const LOCAL_KEY = "manga-store-v2";
const BACKUP_KEY = "MT_BACKUPS_V1";
const SESSION_PIN_KEY = "MT_SESSION_GLOBAL_PIN";
const PERSIST_PIN_KEY = "MT_PERSIST_GLOBAL_PIN";

// Hash SHA-256 helper (PIN)
async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ===== Encryption helpers (PBKDF2 + AES-GCM) =====
const KDF_ITERS = 200_000;
const b64 = {
  enc: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer,
};

async function deriveAesKeyFromPin(pin: string, saltB64: string, iters = KDF_ITERS, usages: KeyUsage[] = ["encrypt", "decrypt"]) {
  const salt = b64.dec(saltB64);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

function randomB64(len: number) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64.enc(bytes.buffer);
}

async function encryptWithPinMode(pin: string, plaintext: string, existing?: NotesEnc | null): Promise<NotesEnc> {
  const saltB64 = existing?.salt || randomB64(16);
  const ivB64 = randomB64(12);
  const key = await deriveAesKeyFromPin(pin, saltB64);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: b64.dec(ivB64) }, key, new TextEncoder().encode(plaintext));
  return { v: 1, mode: "pin", algo: "AES-GCM", iv: ivB64, ct: b64.enc(ctBuf), kdf: "PBKDF2", iters: KDF_ITERS, salt: saltB64 };
}

async function decryptWithPinMode(pin: string, enc: NotesEnc): Promise<string> {
  const key = await deriveAesKeyFromPin(pin, enc.salt!, enc.iters || KDF_ITERS, ["decrypt"]);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(enc.iv) }, key, b64.dec(enc.ct));
  return new TextDecoder().decode(ptBuf);
}

async function encryptWithGlobalMode(pin: string, plaintext: string, existing?: NotesEnc | null): Promise<NotesEnc> {
  const saltB64 = existing?.salt || randomB64(16);
  const ivB64 = randomB64(12);
  const key = await deriveAesKeyFromPin(pin, saltB64);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: b64.dec(ivB64) }, key, new TextEncoder().encode(plaintext));
  return { v: 1, mode: "global", algo: "AES-GCM", iv: ivB64, ct: b64.enc(ctBuf), kdf: "PBKDF2", iters: KDF_ITERS, salt: saltB64 };
}

async function decryptWithGlobalMode(pin: string, enc: NotesEnc): Promise<string> {
  const key = await deriveAesKeyFromPin(pin, enc.salt!, enc.iters || KDF_ITERS, ["decrypt"]);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(enc.iv) }, key, b64.dec(enc.ct));
  return new TextDecoder().decode(ptBuf);
}


// ---- Unicode fixer (repair mojibake like "Scrivi qui...", "più", "così") ----
function fixMojibake(s: string): string {
  if (!s) return s;
  // Quick check: if none of the typical bad patterns exist, leave it untouched
  if (!/[ÃÂ…’“—–]/.test(s)) return s;
  try {
    // Try to interpret the current 16-bit code units as bytes and re-decode as UTF-8
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    const decoded = new TextDecoder("utf-8").decode(bytes);
    // If decoding produced something sane (no Ã), use it
    if (!/Ã/.test(decoded)) return decoded;
  } catch {}
  // Fallback targeted replacements
  return s
    .replace(/Scrivi qui.../g, "Scrivi qui...")
    .replace(/…/g, "…")
    .replace(/—/g, "—")
    .replace(/–/g, "–")
    .replace(/’/g, "’")
    .replace(/“/g, "“")
    .replace(/”/g, "”")
    .replace(/→/g, "→")
    .replace(/à/g, "à")
    .replace(/è/g, "è")
    .replace(/é/g, "é")
    .replace(/ì/g, "ì")
    .replace(/ò/g, "ò")
    .replace(/ù/g, "ù");
}
// ---- Notes size guard (approx Firestore 1MiB per doc; keep soft-limit at ~800KB) ----
const MAX_NOTES_BYTES = 800 * 1024; // 800 KiB soft cap
const bytesOf = (s: string) => new TextEncoder().encode(s).length;


// Aggiornato: usa una lingua data separata da quella UI
const fmtDate = (ts: number, dateLang: "it" | "en") =>
  new Date(ts).toLocaleString(dateLang === "it" ? "it-IT" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // 12h in EN, 24h in IT
    hour12: dateLang === "en",
  });

/* ================= Types ================= */
type Kind = "manga" | "manhwa" | "manhua" | "novel";
type Status = "in-progress" | "finished";
type LangCode = "it" | "en";

type MangaItem = {
  id: string;
  title: string;
  kind: Kind;
  image?: string | null;
  imageFile?: string | null;
  chapters: number;
  volumes?: number;
  finished: Status;
  lastModified: number;
};

type NotesEnc = {
  v: 1;
  mode: "global" | "pin";
  algo: "AES-GCM";
  iv: string;
  ct: string;
  kdf?: "PBKDF2";
  iters?: number;
  salt?: string;
};


type Page = {
  id: string;
  name: string;
  items: MangaItem[];
  /** Se true, quando si apre la pagina viene mostrato un overlay di conferma (contenuti 18+) */
  requireConfirm?: boolean;
  /** Se true, richiede un PIN (hash) per aprire la pagina */
  requirePin?: boolean;
  /** Hash SHA-256 del PIN; mai salvato in chiaro */
  pinHash?: string | null;
  isTextPage?: boolean;
  notes?: string;
  notesEnc?: NotesEnc | null;
};;

type StoreShape = {
  pages: Page[];
  activePageId: string;
  lang: LangCode;       // lingua UI
  dateLang: LangCode;   // lingua/locale per formattazione date/ora
  updatedAt: number;
};

/* ================= i18n ================= */
const STRINGS: Record<LangCode, any> = {
  it: {
    appTitle: "Tracker",
    newSeries: "Nuova serie",
    newPage: "Nuova pagina",
    rename: "Modifica",
    delete: "Elimina",
    exportJSON: "Esporta JSON",
    importJSON: "Importa JSON",
    importTXT: "Importa TXT",
    select: "Seleziona",
    cancel: "Annulla",
    deleteSelected: "Elimina selezionati",
    selectAll: "Seleziona tutto",
    clear: "Pulisci",
    volumes: "Volumi",
    chapters: "Capitoli",
    login: "Login con Google",
    logout: "Logout",
    search: "Cerca...",
    language: "Lingua",
    dateLabel: "Data",
    italian: "Italiano",
    english: "English",
    manual: "Manuale",
    title: "Titolo",
    lastModified: "Ultima modifica",
    order: "Ordina",
    pageName: "Nuova pagina",
    kindLabel: "Manga",
    uploadImage: "Carica immagine",
    imageUrl: "URL immagine",
    status: "Stato",
    only: "Mostra",
    all: "Tutti",
    inprogress: "In-progress",
    finished: "Finished",
    confirmDeleteItem: "Eliminare questa serie?",
    confirmDeletePage: "Eliminare questa pagina?",
    edit: "Modifica",
    save: "Salva",
    cloudBadge: "Cloud",
    importDone: "Import completato: database aggiornato",
    cloudSaveError: "Errore nel salvataggio su Cloud. Controlla la connessione.",

    // Nuovi testi per editor pagina e gate
    pageEditTitle: "Modifica pagina",
    pageSensitiveFlag: "Richiedi conferma",
    pageSensitiveHint:
      "Se attivo, quando apri questa pagina dovrai confermare per proseguire.",
        pageTextFlag: "Pagina di testo",
    pageTextHint:
      "Se attivo, questa pagina mostrerà un editor di testo e nasconderà la lista.",
    notesLabel: "Note",
sensitiveOverlayTitle: "Contenuti nascosti",
    sensitiveOverlayBody:
      "Vuoi davvero procedere?",
    proceed: "Procedi",
    goBack: "Torna indietro",
  

    // PIN per pagina
    requirePinFlag: "Richiedi PIN",
    requirePinHint: "Chiede un PIN per aprire la pagina. Se è attiva anche la conferma, dopo il PIN appare la conferma.",
    pinPlaceholder: "PIN (min 4 cifre)",
    setPin: "Imposta/aggiorna PIN",
    removePin: "Rimuovi PIN",
    pinOverlayTitle: "Pagina protetta da PIN",
    pinOverlayBody: "Inserisci il PIN per continuare.",
    pinWrong: "PIN errato",
    notesTooLarge: "Il testo è troppo lungo: limite ~800 KB per pagina.",
},
  en: {
    appTitle: "Tracker",
    newSeries: "New series",
    newPage: "New page",
    rename: "Rename",
    delete: "Delete",
    exportJSON: "Export JSON",
    importJSON: "Import JSON",
    importTXT: "Import TXT",
    select: "Select",
    cancel: "Cancel",
    deleteSelected: "Delete selected",
    selectAll: "Select all",
    clear: "Clear",
    volumes: "Volumes",
    chapters: "Chapters",
    login: "Login with Google",
    logout: "Logout",
    search: "Search...",
    language: "Language",
    dateLabel: "Date",
    italian: "Italian",
    english: "English",
    manual: "Manual",
    title: "Title",
    lastModified: "Last modified",
    order: "Order",
    pageName: "New page",
    kindLabel: "Manga",
    uploadImage: "Upload image",
    imageUrl: "Image URL",
    status: "Status",
    only: "Show",
    all: "All",
    inprogress: "In-progress",
    finished: "Finished",
    confirmDeleteItem: "Delete this series?",
    confirmDeletePage: "Delete this page?",
    edit: "Edit",
    save: "Save",
    cloudBadge: "Cloud",
    importDone: "Import completed: database updated",
    cloudSaveError: "Cloud save failed. Check your connection.",

    // New strings for page editor and gate
    pageEditTitle: "Edit page",
    pageSensitiveFlag: "Require confirmation",
    pageSensitiveHint:
      "If enabled, opening this page will ask you to confirm before proceeding.",
        pageTextFlag: "Text page",
    pageTextHint:
      "If enabled, this page will show a text editor and hide the list.",
    notesLabel: "Notes",
sensitiveOverlayTitle: "Hidden contents",
    sensitiveOverlayBody:
      "Do you really want to proceed?",
    proceed: "Proceed",
    goBack: "Go back",
  

    // Page PIN
    requirePinFlag: "Require PIN",
    requirePinHint: "Ask for a PIN to open the page. If confirmation is active, it will show after the PIN.",
    pinPlaceholder: "PIN (min 4 digits)",
    setPin: "Set/Update PIN",
    removePin: "Remove PIN",
    pinOverlayTitle: "PIN-protected page",
    pinOverlayBody: "Enter the PIN to continue.",
    pinWrong: "Wrong PIN",
    notesTooLarge: "Text too long: ~800 KB per page limit.",
},
};

/* ========== default / normalize ========== */
function defaultStore(lang: LangCode = "it"): StoreShape {
  const first = uid();
  return {
    pages: [
      {
        id: first,
        name: STRINGS[lang].pageName,
        items: [],
        requireConfirm: false,
        requirePin: false,
        pinHash: null,
        isTextPage: false,
        notes: "",
        notesEnc: null,
      },
    ],
    activePageId: first,
    lang,
    dateLang: lang, // di default la data segue la lingua UI
    updatedAt: now(),
  };
}
function normalizeStore(x: any): StoreShape {
  try {
    const lang: LangCode = x?.lang === "en" ? "en" : "it";
    const dateLang: LangCode =
      x?.dateLang === "en" ? "en" : x?.dateLang === "it" ? "it" : lang;

    const pages: Page[] = Array.isArray(x?.pages)
      ? x.pages.map((p: any) => ({
          id: String(p?.id || uid()),
          name: String(p?.name || STRINGS[lang].pageName),
          items: Array.isArray(p?.items)
            ? p.items.map((it: any) => ({
                id: String(it?.id || uid()),
                title: String(it?.title || ""),
                kind: (it?.kind as Kind) || "manga",
                image: it?.image ?? null,
                imageFile: it?.imageFile ?? null,
                chapters: Number(it?.chapters ?? 0),
                volumes: it?.volumes != null ? Number(it.volumes) : 0,
                finished: (it?.finished as Status) || "in-progress",
                lastModified: Number(it?.lastModified || now()),
              }))
            : [],
          requireConfirm: Boolean(p?.requireConfirm),
          requirePin: Boolean(p?.requirePin),
          pinHash: typeof p?.pinHash === "string" ? p.pinHash : null,
          isTextPage: Boolean(p?.isTextPage),
          notes: typeof p?.notes === "string" ? p.notes : "",
          notesEnc: (p as any)?.notesEnc ?? null,
        }))
      : defaultStore(lang).pages;

    const activePageId: string =
      typeof x?.activePageId === "string" ? x.activePageId : pages[0]?.id || uid();

    return {
      pages,
      activePageId,
      lang,
      dateLang,
      updatedAt: Number(x?.updatedAt || now()),
    };
  } catch {
    return defaultStore();
  }
}


/* =========== Firestore doc/collection helpers =========== */
const userDocRef = (uid: string) => doc(db, "mangaTracker", uid);
const pagesColRef = (uid: string) => collection(db, "mangaTracker", uid, "pages");
const pageDocRef  = (uid: string, pageId: string) => doc(db, "mangaTracker", uid, "pages", pageId);
/* ============= CLOUD ONLY helpers ============= */

async function loadCloudStore(userId: string): Promise<StoreShape> {
  try {
    const uRef = userDocRef(userId);
    const uSnap = await getDoc(uRef);

    // Se non esiste ancora nulla, torna lo store di default
    if (!uSnap.exists()) {
      return defaultStore();
    }

    const meta: any = uSnap.data() || {};
    // Leggi le pagine dalla sottocollezione
    let pSnap = await getDocs(pagesColRef(userId));

    // MIGRAZIONE AUTOMATICA: se la subcollection è vuota ma il vecchio doc ha "pages" array
    if (pSnap.empty && Array.isArray(meta.pages)) {
      const batch = writeBatch(db);
      const pagesOrder: string[] = [];

      for (const p of meta.pages as any[]) {
        const pid = String(p.id || Math.random().toString(36).slice(2));
        pagesOrder.push(pid);
        batch.set(
          pageDocRef(userId, pid),
          {
            id: pid,
            name: String(p.name || "Page"),
            requireConfirm: Boolean(p.requireConfirm),
            requirePin: Boolean(p.requirePin),
            pinHash: typeof p.pinHash === "string" ? p.pinHash : null,
        isTextPage: Boolean(p.isTextPage),
        notes: typeof p.notes === "string" ? p.notes : "",
            notesEnc: (p as any).notesEnc ?? null,
            updatedAt: Number(meta.updatedAt || Date.now()),
            items: Array.isArray(p.items) ? p.items : [],
          },
          { merge: true }
        );
      }

      batch.update(uRef, {
        pagesOrder,
        updatedAt: Number(meta.updatedAt || Date.now()),
        pages: deleteField(), // rimuovi il campo grande
      });

      await batch.commit();
      // rileggi dopo la migrazione
      pSnap = await getDocs(pagesColRef(userId));
    }

    const pages = pSnap.docs.map((d) => {
      const p: any = d.data() || {};
      return {
        id: String(p.id || d.id),
        name: String(p.name || "Page"),
        requireConfirm: Boolean(p.requireConfirm),
        requirePin: Boolean(p.requirePin),
        pinHash: typeof p.pinHash === "string" ? p.pinHash : null,
        isTextPage: Boolean(p.isTextPage),
        notes: typeof p.notes === "string" ? p.notes : "",
        notesEnc: p.notesEnc ?? null,
        items: Array.isArray(p.items) ? p.items : [],
      };
    });

    // Ordine pagine se presente
    const ordered = Array.isArray(meta.pagesOrder)
      ? [...pages].sort(
          (a, b) =>
            meta.pagesOrder.indexOf(a.id) - meta.pagesOrder.indexOf(b.id)
        )
      : pages;

    // activePageId coerente
    const activePageId =
      typeof meta.activePageId === "string" && ordered.some(p => p.id === meta.activePageId)
        ? meta.activePageId
        : ordered[0]?.id || defaultStore().activePageId;

    return normalizeStore({
      pages: ordered,
      activePageId,
      lang: meta.lang === "en" ? "en" : "it",
      dateLang: meta.dateLang === "en" ? "en" : meta.dateLang === "it" ? "it" : (meta.lang === "en" ? "en" : "it"),
      updatedAt: Number(meta.updatedAt || Date.now()),
    });
  } catch {
    return defaultStore();
  }
}

async function saveStore(userId: string, store: StoreShape) {
  const stamped: StoreShape = { ...store, updatedAt: now() };

  // Mirror locale (come ora)
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(stamped)); } catch {}

  // Batch Firestore: meta + pagine
  const batch = writeBatch(db);

  // meta globali
  batch.set(
    userDocRef(userId),
    {
      lang: stamped.lang,
      dateLang: stamped.dateLang,
      activePageId: stamped.activePageId,
      updatedAt: stamped.updatedAt,
      pagesOrder: stamped.pages.map((p) => p.id),
    },
    { merge: true }
  );

  // pagine nella subcollection
  for (const p of stamped.pages) {
    batch.set(
      pageDocRef(userId, p.id),
      {
        id: p.id,
        name: p.name,
        requireConfirm: Boolean(p.requireConfirm),
        requirePin: Boolean(p.requirePin),
        pinHash: typeof p.pinHash === "string" ? p.pinHash : null,
        isTextPage: Boolean(p.isTextPage),
        notes: "",
        notesEnc: (p as any).notesEnc ?? null,
        updatedAt: stamped.updatedAt,
        items: Array.isArray(p.items) ? p.items : [],
      },
      { merge: true }
    );
  }

  // Pulizia pagine rimosse
  const existing = await getDocs(pagesColRef(userId));
  const keep = new Set(stamped.pages.map((p) => p.id));
  existing.forEach((d) => {
    if (!keep.has(d.id)) {
      batch.delete(d.ref);
    }
  });

  await batch.commit();
}


/* ================= Small UI: Counter ================= */
type CounterProps = {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
  sizeClass?: string;
  readOnly?: boolean;
};
const Counter: React.FC<CounterProps> = ({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  ariaLabel,
  sizeClass = "h-8",
  readOnly = false,
}) => {
  const clampToRange = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => onChange(clampToRange(n));
  return (
    <div
      className={`inline-flex items-stretch rounded-xl border border-neutral-700 bg-neutral-800 overflow-hidden ${sizeClass}`}
      style={{ minWidth: 144 }}
    >
      <button
        type="button"
        aria-label={ariaLabel ? `${ariaLabel} meno` : "meno"}
        className="px-2 hover:bg-neutral-700 disabled:opacity-50"
        onClick={() => !readOnly && set((value ?? 0) - 1)}
        disabled={readOnly || (value ?? 0) <= min}
      >
        <Minus className="w-4 h-4" />
      </button>

      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
              onChange={(e) => { if (readOnly) return; const n = Number(e.target.value); if (Number.isFinite(n)) set(n); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="bg-transparent px-2 text-center font-mono tabular-nums outline-none w-24"
        aria-label={ariaLabel}
        disabled={readOnly}
        onFocus={(e) => e.currentTarget.select()}
      />

      <button
        type="button"
        aria-label={ariaLabel ? `${ariaLabel} più` : "più"}
        className="px-2 hover:bg-neutral-700 disabled:opacity-50"
        onClick={() => !readOnly && set((value ?? 0) + 1)}
        disabled={readOnly || (value ?? 0) >= max}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};

/* ==================== Component ==================== */
export default function MangaTrackerApp() {
  const [user, setUser] = useState<User | null>(null);
  const [store, setStore] = useState<StoreShape>(defaultStore());
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);

  // UI
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] =
    useState<"manual" | "title" | "lastModified" | "chapters">("manual");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] =
    useState<"all" | "in-progress" | "finished">("all");
  const [toast, setToast] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<"success" | "error">("success");
  const [syncStatus, setSyncStatus] = useState<"ok" | "saving" | "error">("ok");

  // NEW: stato per pulsante "torna su"
  const [showScrollTop, setShowScrollTop] = useState(false);

  const t = STRINGS[store.lang];

  // editor serie
  const [editing, setEditing] = useState<any>(null);

  // editor pagina (nuovo)
  const [pageEditing, setPageEditing] = useState<any>(null);

  // gate 18+ per pagina (sblocco per sessione)
  const [unlockedPageId, setUnlockedPageId] = useState<string | null>(null);
  const lastSafePageIdRef = useRef<string | null>(null);

  // PIN gate state (non cambia pagina finché non sblocchi)
  const [pinGateOpen, setPinGateOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [gatePending, setGatePending] = useState<{ pageId: string | null; askConfirm: boolean }>({ pageId: null, askConfirm: false });

  // --- Session PINs (page + global) ---
  const pagePinRef = useRef<Record<string, string>>({});
  const globalPinRef = useRef<string | null>(null);

  // Global PIN overlay state
  const [globalPinOpen, setGlobalPinOpen] = useState(false);
  const [globalPinInput, setGlobalPinInput] = useState("");
  const [rememberGlobalPin, setRememberGlobalPin] = useState(false);
  const [rememberGlobalPinPersist, setRememberGlobalPinPersist] = useState(false);
  const [globalPinError, setGlobalPinError] = useState("");
  const [afterGlobalPin, setAfterGlobalPin] = useState<null | (() => Promise<void>)>(null);
  // --- Settings modal state ---
  const [settingsOpen, setSettingsOpen] = useState(false);

  // --- Change Global PIN state ---
  const [changeGlobalPinOpen, setChangeGlobalPinOpen] = useState(false);
  // --- Remove Global PIN state ---
  const [removeGlobalPinOpen, setRemoveGlobalPinOpen] = useState(false);
  const [removePinInput, setRemovePinInput] = useState("");
  const [removePinError, setRemovePinError] = useState("");

  const [oldGlobalPin, setOldGlobalPin] = useState("");
  const [newGlobalPin, setNewGlobalPin] = useState("");
  const [newGlobalPin2, setNewGlobalPin2] = useState("");
  const [changePinError, setChangePinError] = useState("");

  // Any page currently encrypted with GLOBAL PIN?
  const hasAnyGlobalEnc = store.pages.some(p => p.notesEnc && p.notesEnc.mode === "global");

// Decrypt all pages that use GLOBAL PIN (only if notes are empty)
async function decryptAllGlobals() {
  if (!globalPinRef.current) return;
  const pin = globalPinRef.current;
    const pages = await Promise.all(store.pages.map(async (pg) => {
      if (pg.isTextPage && pg.notesEnc && pg.notesEnc.mode === "global") {
        try {
          const plain = await decryptWithGlobalMode(pin, pg.notesEnc as any);
          return { ...pg, notes: fixMojibake(plain) };
        } catch {
          return pg;
        }
      }
      return pg;
    }));
  patchStore(s => ({ ...s, pages, updatedAt: now() }));
}


  // file inputs
  const fileJSONRef = useRef<HTMLInputElement | null>(null);
  const fileTXTRef = useRef<HTMLInputElement | null>(null);

  // Ref per la textarea "note" + auto-grow
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  

  // NEW: bozze input posizione
  const [posDraft, setPosDraft] = useState<Record<string, string>>({});

  /* -------- AUTH + BOOT -------- */
  
  // Restore global PIN from sessionStorage (optional convenience)
  

// Keep device persistence in sync with the checkbox, but don't clear on the first mount

// Keep device persistence in sync with the checkbox, but don't clear on the first mount
const rememberPersistPrev = useRef<boolean | null>(null);
useEffect(() => {
  if (rememberPersistPrev.current === null) {
    rememberPersistPrev.current = rememberGlobalPinPersist;
    return;
  }
  try {
    if (rememberGlobalPinPersist && globalPinRef.current) {
      localStorage.setItem(PERSIST_PIN_KEY, globalPinRef.current);
    } else if (!rememberGlobalPinPersist) {
      localStorage.removeItem(PERSIST_PIN_KEY);
    }
  } catch {}
  rememberPersistPrev.current = rememberGlobalPinPersist;
}, [rememberGlobalPinPersist]);
useEffect(() => {
    try {
      const cached = sessionStorage.getItem(SESSION_PIN_KEY);
      if (cached) {
        globalPinRef.current = cached;
      }
    } catch {}
  
      try {
        const persisted = localStorage.getItem(PERSIST_PIN_KEY);
        if (persisted) { globalPinRef.current = persisted; setRememberGlobalPinPersist(true); }
      } catch {}
}, []);
useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        setHydrated(false);
        return;
      }
      const cloud = await loadCloudStore(u.uid);
      setStore(cloud);
      setLoading(false);
      setHydrated(true);
      setSyncStatus("saving");
      try {
        await saveStore(u.uid, cloud);
        setSyncStatus("ok");
      } catch {
        setSyncStatus("error");
        setToastKind("error");
        setToast(t.cloudSaveError);
      }
    });
    return () => unsub();
  }, []);

// After login/hydration: if there are global-encrypted pages, either prompt for PIN or decrypt everything
useEffect(() => {
  if (!hydrated || !user) return;
  if (!hasAnyGlobalEnc) return;
  if (globalPinRef.current) { decryptAllGlobals(); return; }
  setAfterGlobalPin(() => async () => { await decryptAllGlobals(); });
  setGlobalPinInput("");
  setGlobalPinError("");
  setGlobalPinOpen(true);
}, [hydrated, user, hasAnyGlobalEnc]);

  useEffect(() => {
    if (!hydrated || !user) return;
    const timer = setTimeout(() => {
      setSyncStatus("saving");
      saveStore(user.uid, store)
        .then(() => setSyncStatus("ok"))
        .catch(() => {
          setSyncStatus("error");
          setToastKind("error");
          setToast(t.cloudSaveError);
        });
    }, 1500); // salva 1,5s dopo l’ultima modifica

    return () => clearTimeout(timer);
  }, [store, hydrated, user]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // NEW: mostra il pulsante "torna su" dopo un tot di scroll
  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ----------------- Derivati ----------------- */
  const activePage: Page = useMemo(
    () => store.pages.find((p) => p.id === store.activePageId) || store.pages[0],
    [store]
  );

  
// Draft text buffer to avoid re-render scroll jumps while typing
const [notesDraft, setNotesDraft] = useState<string>("");

// Font size for notes textarea (persisted)
const [notesFontPx, setNotesFontPx] = useState<number>(() => {
  const v = Number(localStorage.getItem("notesFontPx") || "18");
  return Number.isFinite(v) && v >= 10 && v <= 36 ? v : 18;
});
const incNotesFont = () => setNotesFontPx((v) => Math.min(36, v + 2));
const decNotesFont = () => setNotesFontPx((v) => Math.max(10, v - 2));
useEffect(() => { localStorage.setItem("notesFontPx", String(notesFontPx)); }, [notesFontPx]);


// Track active user scrolling to avoid fighting with wheel/touch interactions
useEffect(() => {
  let wheelTO: number | null = null;
  const onWheel = () => {
    (window as any).__userScrolling = true;
    if (wheelTO) window.clearTimeout(wheelTO);
    wheelTO = window.setTimeout(() => { (window as any).__userScrolling = false; }, 150);
  };
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('touchmove', onWheel, { passive: true });
  return () => {
    window.removeEventListener('wheel', onWheel as any);
    window.removeEventListener('touchmove', onWheel as any);
    if (wheelTO) window.clearTimeout(wheelTO);
  };
}, []);

const saveNotesTimerRef = useRef<number | null>(null);
function queueNotesSave(next: string) {
  if (saveNotesTimerRef.current) window.clearTimeout(saveNotesTimerRef.current);
  // small debounce so rapid typing doesn't trigger heavy re-renders
  saveNotesTimerRef.current = window.setTimeout(() => {
      (window as any).__scrollLock = true;
      try {
        void handleNotesChange(next);
      } finally {
        window.setTimeout(() => { (window as any).__scrollLock = false; }, 200);
      }
    }, 250);
}
useEffect(() => {
  return () => { if (saveNotesTimerRef.current) window.clearTimeout(saveNotesTimerRef.current); };
}, []);
// Keep draft in sync when switching page or when notes change externally (decrypt/import/load)
useEffect(() => {
  setNotesDraft(activePage?.notes ?? "");
}, [activePage?.id, activePage?.notes]);
// Scrollbar esterna in stile dark coerente col sito (scelta 2)
  useEffect(() => {
    const css = `
/* Firefox */
* {
  scrollbar-width: thin;
  scrollbar-color: #525252 #171717; /* thumb, track */
}
/* WebKit (Chrome/Edge/Safari) */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: #171717; /* ~ neutral-900 */
}
::-webkit-scrollbar-thumb {
  background: #404040; /* ~ neutral-700 */
  border-radius: 9999px;
  border: 2px solid #171717; /* effetto incassato */
}
::-webkit-scrollbar-thumb:hover {
  background: #525252; /* ~ neutral-600 */
}
/* Evita salti layout quando appare la scrollbar */
html { scrollbar-gutter: stable; }
`;
    const id = "custom-scrollbar-dark";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = css;
      document.head.appendChild(el);
    }
  }, []);


  const items = activePage?.items ?? [];

  // indice pagina attiva e possibilità di spostamento
  const activeIndex = useMemo(() => store.pages.findIndex(p => p.id === store.activePageId), [store]);
  const canMovePageLeft = activeIndex > 0;
  const canMovePageRight = activeIndex >= 0 && activeIndex < store.pages.length - 1;

  // Editabilità posizioni: SOLO quando (manuale) && (niente ricerca) && (stato = Tutti)
  const manualEditable =
    sortKey === "manual" && !query.trim() && statusFilter === "all";
  // Siamo in filtro stato (In-progress / Finished)?
  const filteredStatus = statusFilter !== "all";

  const displayed = useMemo(() => {
    let arr = [...items];
    if (statusFilter !== "all") arr = arr.filter((i) => i.finished === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter((i) => i.title.toLowerCase().includes(q));
    }
    if (!(sortKey === "manual" && !query.trim())) {
      arr.sort((a, b) => {
        let c = 0;
        if (sortKey === "title") c = a.title.localeCompare(b.title);
        else if (sortKey === "chapters") c = a.chapters - b.chapters;
        else if (sortKey === "lastModified") c = a.lastModified - b.lastModified;
        return sortDir === "asc" ? c : -c;
      });
    }
    return arr;
  }, [items, query, sortKey, sortDir, statusFilter]);

  // Posizione assoluta nella pagina (1-based), stabile con filtri/ricerca
  const absolutePos = (id: string) => items.findIndex((x) => x.id === id) + 1;

  // Ripulisci bozze posizioni se cambia l'elenco
  useEffect(() => {
    setPosDraft((d) => {
      const ids = new Set(items.map((i) => i.id));
      const next: Record<string, string> = {};
      for (const k of Object.keys(d)) if (ids.has(k)) next[k] = d[k];
      return next;
    });
  }, [items]);

  // Traccia ultimo id pagina "sicura" (ovvero: non richiede conferma o è già sbloccata)
  useEffect(() => {
    const needsConfirm = Boolean(activePage?.requireConfirm);
    if (!needsConfirm || unlockedPageId === activePage?.id) {
      lastSafePageIdRef.current = store.activePageId;
    }
    // reset sblocco quando si cambia pagina
    setUnlockedPageId((prev) => (prev === store.activePageId ? prev : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activePageId, activePage?.requireConfirm]);

  /* ----------------- Mutators ----------------- */
  function patchStore(fn: (s: StoreShape) => StoreShape, preserveWindowScroll?: boolean) {
    const x = window.scrollX;
    const y = window.scrollY;
    setStore((s) => fn(s));
    const w: any = window as any;
    const shouldPreserve = Boolean(preserveWindowScroll) || Boolean(w.__scrollLock);
    if (shouldPreserve && !w.__userScrolling) {
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - y) > 1 || Math.abs(window.scrollX - x) > 1) {
          window.scrollTo(x, y);
        }
      });
    }
}
  function patchItems(fn: (prev: MangaItem[]) => MangaItem[]) {
    patchStore((s) => ({
      ...s,
      pages: s.pages.map((p) =>
        p.id === s.activePageId ? { ...p, items: fn(p.items) } : p
      ),
      updatedAt: now(),
    }));
  }


  // --- One-time migration: repair mojibake in existing notes ---
  useEffect(() => {
    if (!hydrated) return;
    const bad = store.pages.some(p => typeof p.notes === "string" && /[ÃÂ…’“—–]/.test(p.notes));
    if (!bad) return;
    patchStore(s => ({
      ...s,
      pages: s.pages.map(p => typeof p.notes === "string" ? { ...p, notes: fixMojibake(p.notes) } : p),
      updatedAt: now(),
    }));
  }, [hydrated]);
  // MODIFICATO: non inserisco più subito l'item; apro solo l'editor in modalità creazione
  function addItem() {
    const it: MangaItem = {
      id: uid(),
      title: "",
      kind: "manga",
      image: null,
      imageFile: null,
      chapters: 0,
      volumes: 0,
      finished: "in-progress",
      lastModified: now(),
    };
    // NON patchItems qui: la serie verrà aggiunta solo su "Save"
    setEditing(it);
  }
  function updateItem(id: string, patch: Partial<MangaItem>) {
    patchItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, ...patch, lastModified: now() } : i
      )
    );
  }
  function removeItem(id: string) {
    if (!confirm(t.confirmDeleteItem)) return;
    patchItems((prev) => prev.filter((i) => i.id !== id));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setPosDraft((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  }
  function moveItem(id: string, newPos1: number) {
    patchItems((prev) => {
      const from = prev.findIndex((i) => i.id === id);
      if (from < 0) return prev;
      const to = clamp(Math.floor(newPos1) - 1, 0, prev.length - 1);
      if (to === from) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
    setPosDraft((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  }

  // pagine
  function addPage() {
    const p: Page = {
      id: uid(),
      name: t.pageName,
      items: [],
      requireConfirm: false,
      isTextPage: false,
      notes: "",
    };
    patchStore((s) => ({
      ...s,
      pages: [...s.pages, p],
      activePageId: p.id,
      updatedAt: now(),
    }));
  }

  // OPZIONE 1: riutilizzo renamePage per aprire il popup editor pagina
  function renamePage() {
    // FIX: include id and current name so Save actually updates the right page
    setPageEditing({
      id: activePage.id,
      name: activePage.name,
      requireConfirm: Boolean(activePage.requireConfirm),
      isTextPage: Boolean(activePage.isTextPage),
      requirePin: Boolean((activePage as any).requirePin),
      pinHash: typeof (activePage as any).pinHash === "string" ? (activePage as any).pinHash : null,
    });
  }

  function deletePage() {
    if (!confirm(t.confirmDeletePage)) return;
    patchStore((s) => {
      const filtered = s.pages.filter((p) => p.id !== s.activePageId);
      const next = filtered.length ? filtered : defaultStore(s.lang).pages;
      return {
        ...s,
        pages: next,
        activePageId: next[0].id,
        updatedAt: now(),
      };
    });
    setPosDraft({});
  }

  function movePage(direction: -1 | 1) {
    patchStore((s) => {
      const i = s.pages.findIndex((p) => p.id === s.activePageId);
      if (i < 0) return s;
      const j = Math.min(Math.max(i + direction, 0), s.pages.length - 1);
      if (i === j) return s;
      const next = [...s.pages];
      const [pg] = next.splice(i, 1);
      next.splice(j, 0, pg);
      return { ...s, pages: next, updatedAt: now() };
    });
  }

  // import/export
  function exportJSON() {
    const data = JSON.stringify(store, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manga-tracker-${new Date()
      .toISOString()
      .slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const parsed = normalizeStore(JSON.parse(String(r.result)));
        setStore(parsed);
        try {
          if (user) await saveStore(user.uid, parsed);
          setToastKind("success");
          setToast(t.importDone);
        } catch {
          setToastKind("error");
          setToast(t.cloudSaveError);
        }
        setPosDraft({});
      } catch {
        alert("File JSON non valido");
      }
    };
    r.readAsText(f);
    e.target.value = "";
  }
  function importTXT(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      const lines = String(r.result ?? "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!lines.length) return;
      const newItems: MangaItem[] = lines.map(
        (title): MangaItem => ({
          id: uid(),
          title,
          kind: "manga",
          image: null,
          imageFile: null,
          chapters: 0,
          volumes: 0,
          finished: "in-progress",
          lastModified: now(),
        })
      );
      const next = {
        ...store,
        pages: store.pages.map((p) =>
          p.id === store.activePageId
            ? { ...p, items: [...p.items, ...newItems] }
            : p
        ),
        updatedAt: now(),
      };
      setStore(next);
      try {
        if (user) await saveStore(user.uid, next);
        setToastKind("success");
        setToast(t.importDone);
      } catch {
        setToastKind("error");
        setToast(t.cloudSaveError);
      }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  function onImageChosen(files: FileList | null, itemId: string) {
    if (!files || !files[0]) return;
    const file = files[0];
    const r = new FileReader();
    r.onload = () => updateItem(itemId, { imageFile: String(r.result || "") });
    r.readAsDataURL(file);
  }


  // --- Handler with soft byte-limit for text pages (notes) ---
  
async function handleNotesChange(next: string) {
    const bytes = bytesOf(next);
    if (bytes > MAX_NOTES_BYTES) {
      setToastKind("error");
      setToast(t.notesTooLarge || (store.lang === "it" ? "Il testo è troppo lungo: limite ~800 KB per pagina." : "Text too long: ~800 KB per page limit."));
      return;
    }

    const pageId = store.activePageId;
    const pg = store.pages.find((p) => p.id === pageId);
    if (!pg) return;

    // choose mode
    try {
      if (pg.requirePin && pg.pinHash) {
        const pagePin = pagePinRef.current[pageId];
        if (!pagePin) {
          // chiedi PIN pagina tramite overlay già esistente
          lastSafePageIdRef.current = store.activePageId;
          setGatePending({ pageId, askConfirm: !!pg.requireConfirm });
          setPinInput("");
          setPinError("");
          setPinGateOpen(true);
          return;
        }
        const enc = await encryptWithPinMode(pagePin, next, pg.notesEnc);
        pushBackup(pageId, "page", enc);
      patchStore((s) => ({
          ...s,
          pages: s.pages.map((p) => p.id === pageId ? { ...p, notes: next, notesEnc: enc } : p),
          updatedAt: now(),
        }));
        return;
      } else {
        // global PIN required
        if (!globalPinRef.current) {
          setAfterGlobalPin(() => async () => {
            if (!globalPinRef.current) return;
            const enc2 = await encryptWithGlobalMode(globalPinRef.current, next, pg.notesEnc);
            patchStore((s) => ({
              ...s,
              pages: s.pages.map((p) => p.id === pageId ? { ...p, notes: next, notesEnc: enc2 } : p),
              updatedAt: now(),
            }));
          });
          setGlobalPinInput("");
          setGlobalPinError("");
          setGlobalPinOpen(true);
          return;
        }
        const enc = await encryptWithGlobalMode(globalPinRef.current, next, pg.notesEnc);
        pushBackup(pageId, "global", enc);
      patchStore((s) => ({
          ...s,
          pages: s.pages.map((p) => p.id === pageId ? { ...p, notes: next, notesEnc: enc } : p),
          updatedAt: now(),
        }));
        return;
      }
    } catch (e) {
      setToastKind("error");
      setToast("Errore cifratura note.");
    }
  }

  

// Offer restore when a page looks encrypted but notesEnc is missing
// DUPLICATE REMOVED: const activePage = store.pages.find(p => p.id === store.activePageId);
const lostEncryptedPayload =
  activePage?.isTextPage &&
  ((activePage?.requirePin && activePage?.pinHash) || (activePage?.notesEnc && activePage?.notesEnc.mode)) &&
  !activePage?.notesEnc &&
  (!activePage?.notes || activePage?.notes.length === 0) &&
  Boolean(peekBackup(store.activePageId || ""));

/* ================= Render ================= */

  
  

  
// Rehydrate global PIN from storage when switching page (if ref is empty)
useEffect(() => {
  if (!globalPinRef.current) {
    try {
      const persisted = localStorage.getItem(PERSIST_PIN_KEY) || sessionStorage.getItem(SESSION_PIN_KEY);
      if (persisted) globalPinRef.current = persisted;
    } catch {}
  }
}, [store.activePageId]);
// Auto-decrypt active text page (GLOBAL mode) when global PIN is available
  
  // If active page requires its own PIN and it's not cached yet, open the PIN gate automatically
  useEffect(() => {
    const pg = store.pages.find(p => p.id === store.activePageId);
    if (!pg) return;
    if (pg.requirePin && pg.pinHash && !pagePinRef.current[pg.id] && !pinGateOpen) {
      lastSafePageIdRef.current = store.activePageId;
      setGatePending({ pageId: pg.id, askConfirm: !!pg.requireConfirm });
      setPinInput("");
      setPinError("");
      setPinGateOpen(true);
    }
  }, [store.activePageId, store.pages, pinGateOpen]);
// Prompt for GLOBAL PIN on globally-encrypted text pages (when not cached)
useEffect(() => {
  const pg = store.pages.find(p => p.id === store.activePageId);
  if (!pg || !pg.isTextPage || !pg.notesEnc) return;
  if (pg.notesEnc.mode !== "global") return;
  if (globalPinRef.current) return;

  setAfterGlobalPin(() => async () => {
    if (!globalPinRef.current) return;
    try {
      const txt = await decryptWithGlobalMode(globalPinRef.current, pg.notesEnc!);
      patchStore(s => ({
        ...s,
        pages: s.pages.map(p => p.id === pg.id ? { ...p, notes: fixMojibake(txt) } : p),
        updatedAt: now(),
      }));
    } catch {}
  });
  setGlobalPinInput("");
  setGlobalPinError("");
  setGlobalPinOpen(true);
}, [store.activePageId, store.pages]);

// Silent auto-decrypt when GLOBAL PIN is available
useEffect(() => {
  const pg = store.pages.find(p => p.id === store.activePageId);
  if (!pg || !pg.isTextPage || !pg.notesEnc) return;
  if (pg.requirePin) return; // handled by page PIN flow
  if (pg.notes && pg.notes.length > 0) return;
  if (pg.notesEnc.mode === "global" && globalPinRef.current) {
    decryptWithGlobalMode(globalPinRef.current, pg.notesEnc).then((txt) => {
      patchStore(s => ({
        ...s,
        pages: s.pages.map(p => p.id === pg.id ? { ...p, notes: fixMojibake(txt) } : p),
        updatedAt: now(),
      }));
    }).catch(() => {});
  }
}, [store.activePageId, store.pages]);


  if (!user) {
    return (<>
      
{Boolean(lostEncryptedPayload) && (
  <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-black px-4 py-2 rounded-xl shadow">
    <div className="flex items-center gap-3">
      <span>{store.lang==="en" ? "Encrypted content seems missing. Restore last local backup?" : "Contenuto cifrato mancante. Ripristinare l'ultimo backup locale?"}</span>
      <button
        className="px-3 py-1 rounded-md bg-black/20 hover:bg-black/30"
        onClick={() => {
          const b = popBackup(store.activePageId);
          if (!b) return;
          patchStore(s => ({
            ...s,
            pages: s.pages.map(p => p.id === store.activePageId ? { ...p, notesEnc: b.payload, notes: "" } : p),
            updatedAt: now(),
          }));
        }}
      >
        {store.lang==="en" ? "Restore" : "Ripristina"}
      </button>
    </div>
  </div>
)}

<div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-6">
            {STRINGS.it.appTitle}
          </h1>
          <button
            onClick={() => signInWithPopup(auth, provider)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500"
          >
            {STRINGS.it.login}
          </button>
        </div>
      </div>
    </> );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-300 p-6">
        <div className="max-w-6xl mx-auto">Caricamento...</div>
      </div>
    );
  }

  const anySelected = selected.size > 0;
  const selectAllVisible = () =>
    setSelected(new Set(displayed.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());

  // mostra overlay di conferma se la pagina è contrassegnata e non è sbloccata
  const showPageGate =
    Boolean(activePage?.requireConfirm) && unlockedPageId !== activePage?.id;
    return (
      <div className="app-root">

  
  {/* Overlay PIN GLOBALE */}
  {globalPinOpen && (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="w-full max-w-sm p-6 rounded-2xl bg-neutral-950 text-neutral-100 border border-neutral-800 shadow-2xl z-10">
      {hasAnyGlobalEnc ? (
        <>
          <h3 className="text-xl font-semibold mb-2">
            {store.lang==="en" ? "Enter global PIN" : "Inserisci PIN globale"}
          </h3>
          <p className="opacity-80 mb-4">
            {store.lang==="en"
              ? "Enter the global PIN to unlock the encrypted notes of this account."
              : "Inserisci il PIN globale per sbloccare le note cifrate di questo account."}
          </p>
        </>
      ) : (
        <>
          <h3 className="text-xl font-semibold mb-2">
            {store.lang==="en" ? "Set global PIN" : "Imposta PIN globale"}
          </h3>
          <p className="opacity-80 mb-4">
            {store.lang==="en"
              ? "Create a global PIN now: it will be used to encrypt pages that do not have their own page PIN."
              : "Crea ora un PIN globale: verrà usato per cifrare automaticamente le pagine senza PIN personale."}
          </p>
        </>
      )}<input
          type="password"
          value={globalPinInput}
          onChange={(e) => { setGlobalPinInput(e.target.value); setGlobalPinError(""); }}
          placeholder={store.lang==="en" ? "PIN (min 4 digits)" : "PIN (min 4 cifre)"}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 mb-3"
        />
        
        

        <div className="mb-3 space-y-2 text-sm opacity-80">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rememberGlobalPin}
              onChange={(e) => setRememberGlobalPin(e.target.checked)}
            />
            {store.lang==="en" ? "Remember this PIN for this session" : "Ricorda questo PIN per questa sessione"}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rememberGlobalPinPersist}
              onChange={(e) => setRememberGlobalPinPersist(e.target.checked)}
            />
            {store.lang==="en" ? "Remember this PIN on this device" : "Ricorda questo PIN su questo dispositivo"}
          </label>
        </div>
{globalPinError && <div className="text-red-500 text-sm mb-3">{globalPinError}</div>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => {
              setGlobalPinOpen(false);
              setGlobalPinInput("");
              setGlobalPinError("");
              setAfterGlobalPin(null);
            }}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700"
          >
            {store.lang==="en" ? "Cancel" : (t.cancel ?? "Annulla")}
          </button>
          <button
            onClick={async () => {
              if (!globalPinInput) { setGlobalPinError(t.pinWrong); return; }
              globalPinRef.current = globalPinInput;
              if (afterGlobalPin) { try { await afterGlobalPin(); } catch {} }
              if (rememberGlobalPin) { try { sessionStorage.setItem("MT_SESSION_GLOBAL_PIN", globalPinRef.current!); } catch {} }
              if (rememberGlobalPin) { try { sessionStorage.setItem(SESSION_PIN_KEY, globalPinRef.current!); } catch {} }
              if (rememberGlobalPinPersist) { try { localStorage.setItem(PERSIST_PIN_KEY, globalPinRef.current!); } catch {} }
              setGlobalPinOpen(false);
              setAfterGlobalPin(null);
              setGlobalPinInput("");
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white"
          >
            {store.lang==="en" ? "Proceed" : (t.proceed ?? "Procedi")}
          </button>
        </div>
      </div>
    </div>
  )}


  
  {/* Modale: Impostazioni */}
  {settingsOpen && (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center">
      <div className="w-full max-w-lg p-6 rounded-2xl bg-neutral-950 text-neutral-100 border border-neutral-800 shadow-2xl">
        <h3 className="text-xl font-semibold mb-4">{store.lang==="en" ? "Settings" : (t.settings ?? "Impostazioni")}</h3>

        <div className="mb-4">
          <div className="text-sm opacity-80 mb-1">{store.lang==="en" ? "Language" : (t.language ?? "Lingua UI")}</div>
          <select
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2"
            value={store.lang}
            onChange={(e) => {
              const lang = (e.target.value === "en" ? "en" : "it") as LangCode;
              patchStore(s => ({ ...s, lang, updatedAt: now() }));
            }}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="mb-6">
          <div className="text-sm opacity-80 mb-1">{store.lang==="en" ? "Date" : (t.dateLang ?? "Data")}</div>
          <select
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2"
            value={store.dateLang ?? store.lang}
            onChange={(e) => {
              const dateLang = (e.target.value === "en" ? "en" : "it") as LangCode;
              patchStore(s => ({ ...s, dateLang, updatedAt: now() }));
            }}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="mb-6">
          <div className="text-sm opacity-80 mb-2">{store.lang==="en" ? "Global PIN" : "PIN globale"}</div>
          <div className="flex items-center justify-between gap-3">
            
          <div className="text-xs opacity-60 mb-1">
            {globalPinRef.current
              ? (store.lang==="en" ? "Status: PIN available on this device" : "Stato: PIN disponibile su questo dispositivo")
              : (store.lang==="en" ? "Status: PIN not entered yet" : "Stato: PIN non inserito")}
          </div>
<div className="text-sm opacity-70">
            {hasAnyGlobalEnc
              ? (store.lang==="en"
                  ? "Active (some pages use the global PIN)"
                  : "Attivo (ci sono pagine cifrate con PIN globale)")
              : (store.lang==="en" ? "Not set" : "Non impostato")}
          </div>
            <div className="flex gap-2">
              {!hasAnyGlobalEnc ? (
                <button
                  onClick={() => { setSettingsOpen(false); setGlobalPinOpen(true); }}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white"
                >
                  {store.lang==="en" ? "Set PIN" : (t.save ?? "Imposta PIN")}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setSettingsOpen(false); setChangeGlobalPinOpen(true); }}
                    className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800"
                  >
                    {store.lang==="en" ? "Change PIN" : "Cambia PIN"}
                  </button>
                  <button
                    onClick={() => { setSettingsOpen(false); setRemoveGlobalPinOpen(true); }}
                    className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800"
                  >
                    {store.lang==="en" ? "Remove PIN" : "Rimuovi PIN"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => setSettingsOpen(false)}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700"
          >
            {store.lang==="en" ? "Close" : (t.close ?? "Chiudi")}
          </button>
        </div>
      </div>
    </div>
  )}

  {/* Modale: Cambia PIN globale */}
  {changeGlobalPinOpen && (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="w-full max-w-sm p-6 rounded-2xl bg-neutral-950 text-neutral-100 border border-neutral-800 shadow-2xl z-10">
        <h3 className="text-xl font-semibold mb-2">Cambia PIN globale</h3>
        <p className="opacity-80 mb-4">Inserisci il PIN attuale e poi quello nuovo.</p>

        <input
          type="password"
          value={oldGlobalPin}
          onChange={(e) => { setOldGlobalPin(e.target.value); setChangePinError(""); }}
          placeholder={store.lang==="en" ? "Current PIN" : "PIN attuale"}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 mb-3 placeholder-neutral-500 text-neutral-100"
        />
        <input
          type="password"
          value={newGlobalPin}
          onChange={(e) => { setNewGlobalPin(e.target.value); setChangePinError(""); }}
          placeholder={store.lang==="en" ? "New PIN" : "Nuovo PIN"}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 mb-3 placeholder-neutral-500 text-neutral-100"
        />
        <input
          type="password"
          value={newGlobalPin2}
          onChange={(e) => { setNewGlobalPin2(e.target.value); setChangePinError(""); }}
          placeholder={store.lang==="en" ? "Confirm new PIN" : "Conferma nuovo PIN"}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 mb-3 placeholder-neutral-500 text-neutral-100"
        />

        {changePinError && <div className="text-red-500 text-sm mb-3">{changePinError}</div>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => { setChangeGlobalPinOpen(false); setOldGlobalPin(""); setNewGlobalPin(""); setNewGlobalPin2(""); setChangePinError(""); }}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700"
          >
            {store.lang==="en" ? "Cancel" : (t.cancel ?? "Annulla")}
          </button>
          <button
            onClick={async () => {
              if (!newGlobalPin || newGlobalPin !== newGlobalPin2) { setChangePinError("I PIN non coincidono."); return; }

              const sample = store.pages.find(p => p.notesEnc && p.notesEnc.mode === "global");
              if (sample) {
                try { await decryptWithGlobalMode(oldGlobalPin, sample.notesEnc as any); }
                catch { setChangePinError("PIN attuale errato."); return; }
              }

              const pages = await Promise.all(store.pages.map(async (pg) => {
                if (pg.notesEnc && pg.notesEnc.mode === "global") {
                  let plain = "";
                  try { plain = await decryptWithGlobalMode(oldGlobalPin, pg.notesEnc as any); }
                  catch { plain = typeof pg.notes === "string" ? pg.notes : ""; }
                  const enc = await encryptWithGlobalMode(newGlobalPin, plain, pg.notesEnc as any);
                  return { ...pg, notes: fixMojibake(plain), notesEnc: enc };
                }
                return pg;
              }));
              patchStore(s => ({ ...s, pages, updatedAt: now() }));
              globalPinRef.current = newGlobalPin;
              setChangeGlobalPinOpen(false);
              setOldGlobalPin(""); setNewGlobalPin(""); setNewGlobalPin2(""); setChangePinError("");
              setToastKind("success"); setToast(t.done || "Fatto");
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white"
          >
            Cambia PIN
          </button>
        </div>
      </div>
    </div>
  )}
  {/* Modale: Rimuovi PIN globale */}
  {removeGlobalPinOpen && (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="w-full max-w-sm p-6 rounded-2xl bg-neutral-950 text-neutral-100 border border-neutral-800 shadow-2xl z-10">
        <h3 className="text-xl font-semibold mb-2">{store.lang==="en" ? "Remove Global PIN" : "Rimuovi PIN globale"}</h3>
        <p className="opacity-80 mb-4">
          {store.lang==="en"
            ? "All notes protected with the global PIN will be decrypted and saved unencrypted. Enter the current PIN to continue."
            : "Tutte le note protette con il PIN globale verranno decriptate e salvate in chiaro. Inserisci il PIN attuale per continuare."}
        </p>
        <input
          type="password"
          value={removePinInput}
          onChange={(e) => { setRemovePinInput(e.target.value); setRemovePinError(""); }}
          placeholder={store.lang==="en" ? "Current PIN" : "PIN attuale"}
          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 mb-3 placeholder-neutral-500 text-neutral-100"
        />
        {removePinError && <div className="text-red-500 text-sm mb-3">{removePinError}</div>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => { setRemoveGlobalPinOpen(false); setRemovePinInput(""); setRemovePinError(""); }}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700"
          >
            {store.lang==="en" ? "Cancel" : (t.cancel ?? "Annulla")}
          </button>
          <button
            onClick={async () => {
              const sample = store.pages.find(p => p.notesEnc && p.notesEnc.mode === "global");
              if (sample) {
                try { await decryptWithGlobalMode(removePinInput, sample.notesEnc as any); }
                catch { setRemovePinError(store.lang==="en" ? "Wrong PIN." : "PIN errato."); return; }
              }
              const pages = await Promise.all(store.pages.map(async (pg) => {
                if (pg.notesEnc && pg.notesEnc.mode === "global") {
                  let plain = "";
                  try { plain = await decryptWithGlobalMode(removePinInput, pg.notesEnc as any); }
                  catch { plain = typeof pg.notes === "string" ? pg.notes : ""; }
                  return { ...pg, notes: fixMojibake(plain), notesEnc: null };
                }
                return pg;
              }));
              patchStore(s => ({ ...s, pages, updatedAt: now() }));
              globalPinRef.current = null;
              setRemoveGlobalPinOpen(false);
              setSettingsOpen(false);
              setRemovePinInput("");
              setRemovePinError("");
              setToast(store.lang==="en" ? "Global PIN removed." : "PIN globale rimosso.");
              setToastKind("success");
            }}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
          >
            {store.lang==="en" ? "Remove" : "Rimuovi"}
          </button>
        </div>
      </div>
    </div>
  )}

{/* Overlay PIN (dark, same style as edit modal) */}
  {pinGateOpen && gatePending.pageId && (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="w-full max-w-sm p-6 rounded-2xl bg-neutral-950 text-neutral-100 border border-neutral-800 shadow-2xl z-10">
        <h3 className="text-xl font-semibold mb-2">{t.pinOverlayTitle}</h3>
        <p className="opacity-80 mb-4">{t.pinOverlayBody}</p>
        <input
          type="password"
          value={pinInput}
          onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
          placeholder={t.pinPlaceholder}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 mb-3"
        />
        {pinError && <div className="text-red-500 text-sm mb-3">{pinError}</div>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => {
              setPinGateOpen(false);
              setGatePending({ pageId: null, askConfirm: false });
              setPinInput("");
              setPinError("");
            }}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700"
          >
            {store.lang==="en" ? "Cancel" : (t.cancel ?? "Annulla")}
          </button>
          <button
            onClick={async () => {
              const pending = store.pages.find((pp) => pp.id === gatePending.pageId);
              if (!pending) {
                setPinGateOpen(false);
                setGatePending({ pageId: null, askConfirm: false });
                return;
              }
              const ok = typeof pending.pinHash === "string" && pending.pinHash.length > 0
                ? (await sha256(pinInput)) === pending.pinHash
                : false;
              if (!ok) {
                setPinError(t.pinWrong);
                return;
              }
              // PIN ok
              // cache PIN for session and decrypt notes if present
              try {
                pagePinRef.current[pending.id] = pinInput;
                if ((pending as any).notesEnc && (pending as any).notesEnc.mode === "pin") {
                  const plain = await decryptWithPinMode(pinInput, (pending as any).notesEnc as NotesEnc);
                  patchStore(s => ({
                    ...s,
                    pages: s.pages.map(pg => pg.id === pending.id ? { ...pg, notes: fixMojibake(plain) } : pg),
                    updatedAt: now(),
                  }));
                }
              } catch {}

              if (gatePending.askConfirm) {
                patchStore((s) => ({ ...s, activePageId: pending.id, updatedAt: now() }));
                // reset PIN overlay and trigger conferma 18+ dopo
                setPinGateOpen(false);
                setGatePending({ pageId: null, askConfirm: false });
                setPinInput("");
                setPinError("");
                setUnlockedPageId(null); // così la conferma 18+ scatta
              } else {
                patchStore((s) => ({ ...s, activePageId: pending.id, updatedAt: now() }));
                setPinGateOpen(false);
                setGatePending({ pageId: null, askConfirm: false });
                setPinInput("");
                setPinError("");
              }
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white"
          >
            {store.lang==="en" ? "Proceed" : (t.proceed ?? "Procedi")}
          </button>
        </div>
      </div>
    </div>
  )}

      {toast && (
        <div className={`fixed bottom-6 right-6 ${toastKind === "error" ? "bg-red-600" : "bg-green-600"} text-white px-4 py-2 rounded-xl shadow-lg z-50`}>
          {toast}
        </div>
      )}

      {/* NEW: pulsante "torna su" */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={`fixed ${toast ? "bottom-24" : "bottom-6"} right-6 z-50 w-12 h-12 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-neutral-600 flex items-center justify-center`}
          aria-label="Torna in cima"
          title="Torna in cima"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap gap-3 items-center justify-between mb-4">
          <h1 className="text-3xl md:text-5xl font-extrabold">{t.appTitle}</h1>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm ${syncStatus === "error" ? "bg-red-700/40" : "bg-green-700/40"}`}>
              <Cloud className="w-4 h-4" /> {t.cloudBadge} {syncStatus === "error" ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            </span>
            
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-2 bg-neutral-800 rounded-2xl"
            >
              {store.lang==="en" ? "Settings" : (t.settings ?? "Impostazioni")}
            </button>
<button
              onClick={() => signOut(auth)}
              className="px-3 py-2 bg-neutral-800 rounded-2xl"
            >
              {t.logout}
            </button>
          </div>
        </header>

        {/* TOOLBAR — riga 1: pagine */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button
            onClick={addPage}
            className="px-3 py-2 bg-neutral-800 rounded-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> {t.newPage}
          </button>

          {/* NUOVO: pulsante Edit pagina (usa renamePage → apre popup tipo editor manga) */}
          <button
            onClick={renamePage}
            className="px-3 py-2 bg-neutral-800 rounded-xl flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" /> {t.edit}
          </button>

          
          {/* Sposta pagina a sinistra/destra */}
          <button
            onClick={() => movePage(-1)}
            disabled={!canMovePageLeft}
            className="px-2 py-2 bg-neutral-800 rounded-xl disabled:opacity-50"
            title="Move left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => movePage(1)}
            disabled={!canMovePageRight}
            className="px-2 py-2 bg-neutral-800 rounded-xl disabled:opacity-50"
            title="Move right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={deletePage}
            className="px-3 py-2 bg-red-700/90 rounded-xl flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> {t.delete}
          </button>
        </div>

        {/* TOOLBAR — riga 2 */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={addItem}
            className="px-3 py-2 bg-blue-600 rounded-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> {t.newSeries}
          </button>

          <button
            onClick={exportJSON}
            className="px-3 py-2 bg-neutral-800 rounded-xl flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> {t.exportJSON}
          </button>

          <input
            ref={fileJSONRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={importJSON}
          />
          <button
            onClick={() => fileJSONRef.current?.click()}
            className="px-3 py-2 bg-neutral-800 rounded-xl flex items-center gap-2"
          >
            <UploadCloud className="w-4 h-4" /> {t.importJSON}
          </button>

          <input
            ref={fileTXTRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={importTXT}
          />
          <button
            onClick={() => fileTXTRef.current?.click()}
            className="px-3 py-2 bg-neutral-800 rounded-xl flex items-center gap-2"
          >
            <Upload className="w-4 h-4" /> {t.importTXT}
          </button>

          {/* Selezione multipla */}
          <button
            onClick={() => setSelectMode((m) => !m)}
            className="px-3 py-2 bg-neutral-800 rounded-xl"
          >
            {selectMode ? t.cancel : t.select}
          </button>

          {selectMode && (
            <>
              <button
                onClick={selectAllVisible}
                className="px-3 py-2 bg-neutral-800 rounded-xl"
              >
                {t.selectAll}
              </button>
              <button
                onClick={clearSelection}
                disabled={!anySelected}
                className="px-3 py-2 bg-neutral-800 rounded-xl disabled:opacity-50"
              >
                {t.clear}
              </button>
              <button
                onClick={() => {
                  if (!anySelected) return;
                  if (!confirm(t.deleteSelected)) return;
                  patchItems((prev) => prev.filter((i) => !selected.has(i.id)));
                  setSelected(new Set());
                  setSelectMode(false);
                  setPosDraft({});
                }}
                disabled={!anySelected}
                className="px-3 py-2 bg-red-700/90 rounded-xl disabled:opacity-50"
              >
                {t.deleteSelected}
              </button>
              <span className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">
                {selected.size}
              </span>
            </>
          )}

          {/* Ricerca */}
          <div className="relative ml-auto">
            <Search className="w-4 h-4 opacity-60 absolute left-2 top-2.5" />
            <input
              placeholder={t.search}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl pl-7 pr-2 py-2"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Ordina */}
          <label className="hidden md:block text-sm opacity-70">{t.order}:</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as any)}
            className="bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1"
          >
            <option value="manual">{t.manual}</option>
            <option value="title">{t.title}</option>
            <option value="chapters">{t.chapters}</option>
            <option value="lastModified">{t.lastModified}</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1"
            title={sortDir === "asc" ? "Asc" : "Desc"}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="w-4 h-4" />
            ) : (
              <ArrowDown className="w-4 h-4" />
            )}
          </button>

          {/* Filtro stato */}
          <label className="hidden md:block text-sm opacity-70">{t.only}:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1"
          >
            <option value="all">{t.all}</option>
            <option value="in-progress">{t.inprogress}</option>
            <option value="finished">{t.finished}</option>
          </select>


          </div>  {/* END: TOOLBAR — riga 2 */}
        {/* Tabs pagine */}
        <nav className="flex flex-wrap gap-2 mb-4">
          {store.pages.map((p) => (
            <button
              key={p.id}
              onClick={async () => {
                if (p.requirePin) {
                  // non cambiare pagina: apri gate PIN
                  lastSafePageIdRef.current = store.activePageId;
                  setGatePending({ pageId: p.id, askConfirm: !!p.requireConfirm });
                  setPinInput("");
                  setPinError("");
                  setPinGateOpen(true);
                  return;
                }
                patchStore((s) => ({
                  ...s,
                  activePageId: p.id,
                  updatedAt: now(),
                }));
              }}
              className={`px-3 py-1 rounded-xl border ${
                p.id === store.activePageId
                  ? "bg-blue-600 border-blue-500"
                  : "bg-neutral-900 border-neutral-800"
              }`}
              title={p.requireConfirm ? "18+ confirm" : ""}
            >
              {p.name}
            </button>
          ))}
        </nav>

        {/* Lista / Text page */}
        {activePage?.isTextPage ? (
          <section className="w-full px-4">
            <div className="flex items-center justify-between mb-2">
  <label className="block opacity-70 text-sm">{t.notesLabel}</label>
  <div className="flex items-center gap-2 text-xs">
    <button type="button" className="px-2 py-1 rounded-md border border-neutral-700 hover:bg-neutral-800" onClick={decNotesFont}>A-</button>
    <span className="opacity-70">{notesFontPx}px</span>
    <button type="button" className="px-2 py-1 rounded-md border border-neutral-700 hover:bg-neutral-800" onClick={incNotesFont}>A+</button>
  </div>
</div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden h-[75vh]">
              <textarea lang="it"
                ref={notesRef}
                value={notesDraft}
                onChange={(e) => { const v = e.target.value; setNotesDraft(v); queueNotesSave(v); }}
                disabled={Boolean(activePage?.requirePin) && !pagePinRef.current[activePage?.id || ""]}
                style={{ fontSize: notesFontPx, lineHeight: 1.6 as number }}
                className="w-full h-full bg-transparent p-4 font-mono resize-none overflow-y-auto custom-scroll"
                placeholder={Boolean(activePage?.requirePin) && !pagePinRef.current[activePage?.id || ""] ? (store.lang==="en" ? "This page is locked. Enter the page PIN to edit." : "Questa pagina è bloccata. Inserisci il PIN per modificare.") : "Scrivi qui..."}
              />
            </div>
          </section>
        ) : (
        <section className="grid grid-cols-1 gap-3">
          {displayed.map((item, idx) => {
            // input posizione editabile SOLO in All+Manuale senza ricerca
            const posEditable = manualEditable;
            // Posizione mostrata:
            // - Filtri (in-progress/finished): numeri da 1..N nell'ordine visibile
            // - All+Manuale (senza ricerca): indice visibile (editabile)
            // - Altri casi (All con sort, o ricerca): posizione assoluta della pagina
            const posShown = filteredStatus
              ? idx + 1
              : posEditable
              ? idx + 1
              : absolutePos(item.id);

            const checked = selected.has(item.id);
            const isFinished = item.finished === "finished";
            const draftValue = posDraft[item.id] ?? String(posShown);

            return (
              <div
                key={item.id}
                className={`bg-neutral-900 border border-neutral-800 rounded-2xl p-3 ${
                  checked ? "ring-2 ring-orange-500" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {selectMode && (
                    <button
                      onClick={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          n.has(item.id) ? n.delete(item.id) : n.add(item.id);
                          return n;
                        })
                      }
                      className="p-1"
                      aria-label="select"
                    >
                      {checked ? (
                        <CheckSquare className="w-5 h-5" />
                      ) : (
                        <Square className="w-5 h-5" />
                      )}
                    </button>
                  )}

                  {/* posizione */}
                  <div className="min-w-[4rem] w-[4rem] text-center">
                    {posEditable ? (
                      <input
                        type="number"
                        min={1}
                        value={draftValue}
                        onChange={(e) =>
                          setPosDraft((d) => ({
                            ...d,
                            [item.id]: e.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const n = Number(
                              (e.target as HTMLInputElement).value
                            );
                            moveItem(
                              item.id,
                              Number.isFinite(n) ? n : posShown
                            );
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          const n = Number(
                            (e.target as HTMLInputElement).value
                          );
                          moveItem(item.id, Number.isFinite(n) ? n : posShown);
                        }}
                        className="w-[4rem] bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-center font-mono tabular-nums"
                        title="Cambia posizione e premi Invio"
                      />
                    ) : (
                      <span className="inline-block w-full font-mono tabular-nums">
                        {posShown}
                      </span>
                    )}
                  </div>

                  {/* cover */}
                  <div className="w-28 h-40 overflow-hidden rounded-xl bg-neutral-800 flex items-center justify-center">
                    {item.imageFile ? (
                      <img
                        src={item.imageFile}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImagePlus className="w-6 h-6 opacity-40" />
                    )}
                  </div>

                  {/* contenuto */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={item.title}
                        onChange={(e) =>
                          updateItem(item.id, { title: e.target.value })
                        }
                        className="bg-neutral-800 border border-neutral-700 rounded-xl px-2 py-1 flex-1 min-w-[180px]"
                        placeholder="Titolo"
                      />
                      <select
                        value={item.kind}
                        onChange={(e) =>
                          updateItem(item.id, {
                            kind: e.target.value as Kind,
                          })
                        }
                        className="bg-neutral-800 border border-neutral-700 rounded-xl px-2 py-1"
                      >
                        <option value="manga">{t.kindLabel}</option>
                        <option value="manhwa">Manhwa</option>
                        <option value="manhua">Manhua</option>
                        <option value="novel">Novel</option>
                      </select>

                      {/* Stato */}
                      <select
                        value={item.finished}
                        onChange={(e) =>
                          updateItem(item.id, {
                            finished: e.target.value as Status,
                          })
                        }
                        className="bg-neutral-800 border border-neutral-700 rounded-xl px-2 py-1"
                        title={t.status}
                      >
                        <option value="in-progress">{t.inprogress}</option>
                        <option value="finished">{t.finished}</option>
                      </select>
                    </div>

                    {/* Volumi / Capitoli: nascosti se Finished; Volumi mostrati solo se >0 in lista */}
                    {!isFinished && (
                      <div className="flex flex-col gap-2 mt-2">
                        {(item.kind === "manga" || item.kind === "novel") && (item.volumes ?? 0) > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="opacity-70 text-sm">
                              {t.volumes}:
                            </span>
                            <Counter
                              value={
                                Number.isFinite(item.volumes as number)
                                  ? (item.volumes as number)
                                  : 0
                              }
                              onChange={(n) =>
                                updateItem(item.id, { volumes: n })
                              }
                              min={0}
                              ariaLabel="volumi"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="opacity-70 text-sm">
                            {t.chapters}:
                          </span>
                          <Counter
                            value={item.chapters ?? 0}
                            onChange={(n) =>
                              updateItem(item.id, { chapters: n })
                            }
                            min={0}
                            ariaLabel="capitoli"
                          />
                        </div>
                      </div>
                    )}

                    {/* azioni */}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => setEditing(item)}
                        className="px-3 py-1 rounded-xl bg-neutral-800"
                      >
                        {t.edit}
                      </button>

                      <label className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-1 cursor-pointer flex items-center gap-2">
                        <Upload className="w-4 h-4" /> {t.uploadImage}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => onImageChosen(e.target.files, item.id)}
                        />
                      </label>

                      <button
                        onClick={() => removeItem(item.id)}
                        disabled={selectMode}
                        className="px-3 py-1 rounded-xl bg-red-700/80 flex items-center gap-2 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" /> {t.delete}
                      </button>

                      {/* Ultima modifica */}
                      <span className="ml-2 text-xs opacity-70 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {t.lastModified}: {fmtDate(item.lastModified, store.dateLang)}
                      </span>

                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => moveItem(item.id, posShown - 1)}
                          disabled={!posEditable || idx === 0}
                          className="px-2 py-1 rounded-lg bg-neutral-800 disabled:opacity-40"
                          title="Su"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveItem(item.id, posShown + 1)}
                          disabled={
                            !posEditable || idx === displayed.length - 1
                          }
                          className="px-2 py-1 rounded-lg bg-neutral-800 disabled:opacity-40"
                          title="Giù"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
        )}
      </div>

      {/* Editor serie */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-[min(94vw,760px)]">
            <div className="flex items-start gap-4">
              <div className="w-32 h-48 rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center">
                {editing.imageFile ? (
                  <img
                    src={editing.imageFile}
                    alt={editing.title}
                    className="w-full h-full object-cover"
                  />
                ) : editing.image ? (
                  <img
                    src={editing.image}
                    alt={editing.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImagePlus className="w-7 h-7 opacity-40" />
                )}
              </div>
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="opacity-70 text-sm">{t.title}</label>
                  <input
                    value={editing.title}
                    onChange={(e) =>
                      setEditing({ ...editing, title: e.target.value })
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="opacity-70 text-sm">{t.status}</label>
                  <select
                    value={editing.finished}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        finished: e.target.value as Status,
                      })
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2"
                  >
                    <option value="in-progress">{t.inprogress}</option>
                    <option value="finished">{t.finished}</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="opacity-70 text-sm">{t.imageUrl}</label>
                  <input
                    value={editing.image || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, image: e.target.value })
                    }
                    placeholder="https://..."
                    className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2"
                  />
                </div>

                {/* MODIFICATO: qui al posto di 'Upload image' metto la scelta del genere */}
                <div className="flex flex-col gap-1">
                  <label className="opacity-70 text-sm">Genere</label>
                  <select
                    value={editing.kind}
                    onChange={(e) =>
                      setEditing({ ...editing, kind: e.target.value as Kind })
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2"
                  >
                    <option value="manga">Manga</option>
                    <option value="manhwa">Manhwa</option>
                    <option value="manhua">Manhua</option>
                    <option value="novel">Novel</option>
                  </select>
                </div>

                {/* Volumi/Capitoli in editor: visibili se NON finished; Volumi sempre editabili per manga/novel */}
                {editing.finished !== "finished" && (
                  <>
                    {(editing.kind === "manga" || editing.kind === "novel") && (
                      <div className="flex flex-col gap-1">
                        <label className="opacity-70 text-sm">
                          {t.volumes}
                        </label>
                        <Counter
                          value={
                            Number.isFinite(editing.volumes as number)
                              ? (editing.volumes as number)
                              : 0
                          }
                          onChange={(n) =>
                            setEditing({ ...editing, volumes: n })
                          }
                          min={0}
                          ariaLabel="volumi"
                          sizeClass="h-10"
                        />
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="opacity-70 text-sm">
                        {t.chapters}
                      </label>
                      <Counter
                        value={editing.chapters ?? 0}
                        onChange={(n) =>
                          setEditing({ ...editing, chapters: n })
                        }
                        min={0}
                        ariaLabel="capitoli"
                        sizeClass="h-10"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-between items-center gap-2">
              <span className="text-xs opacity-70 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {t.lastModified}: {fmtDate(editing.lastModified, store.dateLang)}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="px-3 py-2 bg-neutral-800 rounded-xl"
                >
                  {store.lang==="en" ? "Cancel" : (t.cancel ?? "Annulla")}
                </button>
                <button
                  onClick={() => {
                    if (!editing) return;
                    const exists = items.some((i) => i.id === editing.id);
                    if (exists) {
                      // update esistente
                      updateItem(editing.id, editing);
                    } else {
                      // aggiunta nuova SOLO ora
                      patchItems((prev) => [
                        ...prev,
                        { ...editing, lastModified: now() },
                      ]);
                    }
                    setEditing(null);
                  }}
                  className="px-3 py-2 bg-blue-600 rounded-xl"
                >
                  {t.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editor pagina — popup in stile manga editor */}
      {pageEditing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-[min(94vw,640px)]">
            <h2 className="text-xl font-semibold mb-4">{t.pageEditTitle}</h2>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex flex-col gap-1">
                <label className="opacity-70 text-sm">{t.title}</label>
                <input
                  value={pageEditing.name}
                  onChange={(e) =>
                    setPageEditing({ ...pageEditing, name: e.target.value })
                  }
                  placeholder={t.pageName}
                  className="bg-neutral-900 border border-neutral-700 rounded-2xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-600"
                />
              </div>

              <div className="flex items-start gap-3 mt-2">
                <button
                  onClick={() =>
                    setPageEditing({ ...pageEditing!, requireConfirm: !pageEditing!.requireConfirm } as any)
                  }
                  className="p-1 rounded-lg bg-neutral-800 border border-neutral-700"
                  aria-label={t.pageSensitiveFlag}
                  title={t.pageSensitiveFlag}
                >
                  {pageEditing.requireConfirm ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="font-medium">{t.pageSensitiveFlag}</div>
                  <div className="text-sm opacity-70">{t.pageSensitiveHint}</div>
                </div>
              </div>

              {/* Spunta: Richiedi PIN */}
              <div className="flex items-start gap-3 mt-2">
                <button
                  onClick={() =>
                    setPageEditing({ ...pageEditing!, requirePin: !pageEditing!.requirePin } as any)
                  }
                  className="w-9 h-9 rounded-xl border border-neutral-700 flex items-center justify-center bg-neutral-900"
                  title={t.requirePinFlag}
                >
                  {pageEditing.requirePin ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="font-medium">{t.requirePinFlag}</div>
                  <div className="text-sm opacity-70">{t.requirePinHint}</div>
                  <div className="flex gap-2 mt-2">
                    <input
                      type="password"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      placeholder={t.pinPlaceholder}
                      className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2"
                    />
                    <button
                      onClick={async () => {
                        if (pinInput.length < 4) {
                          setToast(t.pinWrong);
                          setToastKind("error");
                          return;
                        }
                        const h = await sha256(pinInput);
                        patchStore((s) => ({
                          ...s,
                          pages: s.pages.map((pg) =>
                            pg.id === pageEditing!.id
                              ? { ...pg, pinHash: h, requirePin: true }
                              : pg
                          ),
                          updatedAt: now(),
                        }));
                        setPageEditing({ ...pageEditing!, requirePin: true } as any);
                        setToastKind("success");
                      }}
                      className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700"
                    >
                      {t.setPin}
                    </button>
                    <button
                      onClick={() => {
                        patchStore((s) => ({
                          ...s,
                          pages: s.pages.map((pg) =>
                            pg.id === pageEditing!.id
                              ? { ...pg, pinHash: null, requirePin: false }
                              : pg
                          ),
                          updatedAt: now(),
                        }));
                        setPageEditing({ ...pageEditing!, requirePin: false } as any);;
                      }}
                      className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700"
                    >
                      {t.removePin}
                    </button>
                  </div>
                </div>
              </div>


              {/* Spunta: Pagina di testo */}
              <div className="flex items-start gap-3 mt-2">
                <button
                  onClick={() =>
                    setPageEditing({ ...pageEditing!, isTextPage: !pageEditing!.isTextPage } as any)
                  }
                  className="p-1 rounded-lg bg-neutral-800 border border-neutral-700"
                  aria-label={t.pageTextFlag}
                  title={t.pageTextFlag}
                >
                  {pageEditing!.isTextPage ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="font-medium">{t.pageTextFlag}</div>
                  <div className="text-sm opacity-70">{t.pageTextHint}</div>
                </div>
              </div>

            </div>

            <div className="mt-6 flex justify-end items-center gap-2">
              <button
                onClick={() => setPageEditing(null)}
                className="px-3 py-2 bg-neutral-800 rounded-xl"
              >
                {store.lang==="en" ? "Cancel" : (t.cancel ?? "Annulla")}
              </button>
              <button
                onClick={() => {
                  const payload = pageEditing;
                  patchStore((s) => ({
                    ...s,
                    pages: s.pages.map((p) =>
                      p.id === payload!.id
                        ? (() => {
                            const wantRequirePin = Boolean((payload as any)?.requirePin);
                            const hasPin = typeof p.pinHash === "string" && p.pinHash.length > 0;
                            return {
                              ...p,
                              name: payload!.name || p.name,
                              requireConfirm: Boolean(payload!.requireConfirm),
                              // only enable requirePin if a pinHash exists
                              requirePin: wantRequirePin && hasPin,
                              isTextPage: Boolean(payload!.isTextPage),
                            };
                          })()
                        : p
                    ),updatedAt: now(),
                  }));
                  setPageEditing(null);
                }}
                className="px-3 py-2 bg-blue-600 rounded-xl"
              >
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay di conferma per la pagina attiva */}
      {showPageGate && (
        <div className="fixed inset-0 z-40">
          {/* layer scuro che oscura TUTTO */}
          <div className="absolute inset-0 bg-black/95 backdrop-blur-[2px] z-0" />
          {/* dialog */}
          <div className="absolute inset-0 flex items-center justify-center p-4 z-10">
            <div className="w-[min(92vw,560px)] bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center shadow-2xl">
              <h3 className="text-xl font-semibold mb-2">
                {t.sensitiveOverlayTitle}
              </h3>
              <p className="opacity-80 mb-6">{t.sensitiveOverlayBody}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => {
                    // torna all'ultima pagina "sicura" nota, altrimenti alla prima disponibile
                    const fallback =
                      lastSafePageIdRef.current ??
                      store.pages.find((p) => !p.requireConfirm)?.id ??
                      store.pages[0]?.id;
                    if (fallback) {
                      patchStore((s) => ({
                        ...s,
                        activePageId: fallback,
                        updatedAt: now(),
                      }));
                    }
                    setUnlockedPageId(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700"
                >
                  {t.goBack}
                </button>
                <button
                  onClick={() => activePage && activePage && setUnlockedPageId(activePage.id)}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white"
                >
                  {store.lang==="en" ? "Proceed" : (t.proceed ?? "Procedi")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .custom-scroll {
          scrollbar-gutter: stable both-edges;
          scrollbar-width: thin;
          scrollbar-color: #6b7280 #111827; /* thumb, track */
        }
        .custom-scroll::-webkit-scrollbar { width: 10px; }
        .custom-scroll::-webkit-scrollbar-track { background: #111827; border-left: 1px solid #374151; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 8px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: #6b7280; }
      `}</style>
      </div>
  );
}