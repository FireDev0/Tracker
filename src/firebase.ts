// src/firebase.ts
// Env-based Firebase init + domain guard + (optional) App Check
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// In produzione consenti solo questi host (modifica se aggiungi un custom domain)
const allowedHosts = new Set([
  "localhost",
  "127.0.0.1",
  "tracker-f3856.web.app",
  "tracker-f3856.firebaseapp.com",
]);

if (import.meta.env.PROD && !allowedHosts.has(location.hostname)) {
  throw new Error("Unauthorized domain");
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Basic presence checks to help in dev
const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.warn("[firebase.ts] Missing env vars:", missing.join(", "));
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// --- App Check ---
// Produzione: attiva se hai messo la site key in VITE_APPCHECK_SITE_KEY
// Dev: se imposti VITE_APPCHECK_DEBUG=1, abilita il token debug
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (!import.meta.env.DEV && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
} else if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === "1") {
  // @ts-ignore
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  console.info("[firebase.ts] App Check debug token enabled (dev only)");
}

export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();