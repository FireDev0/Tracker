import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken,
  onTokenChanged,
} from "firebase/app-check";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);

// Inizializza Firestore, Auth e Storage
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const storage = getStorage(app);

// Inizializza App Check solo in produzione e su domini autorizzati
if (import.meta.env.PROD) {
  const host = location.hostname;
  const allowedHosts = [
    "localhost",
    "127.0.0.1",
    "tracker-f3856.web.app",
    "tracker-f3856.firebaseapp.com",
  ];

  if (allowedHosts.includes(host) && import.meta.env.VITE_APPCHECK_SITE_KEY) {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });

    // Log diagnostico per App Check
    onTokenChanged(appCheck, (token) => {
      console.info("[AppCheck] token ok ✅", !!token);
    });

    getToken(appCheck)
      .then(() => console.info("[AppCheck] first token retrieved"))
      .catch((err) => console.error("[AppCheck] getToken failed:", err));
  } else {
    console.warn("[AppCheck] Dominio non autorizzato o site key mancante, App Check disattivato");
  }
}

export { app, db, auth, provider, storage };