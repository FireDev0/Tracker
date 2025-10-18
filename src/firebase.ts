// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// La tua configurazione (copiata dal sito Firebase)
const firebaseConfig = {
  apiKey: "AIzaSyBua6IDpPNKtf_BY4LWMTCNNYPW1rxSuI8",
  authDomain: "tracker-f3856.firebaseapp.com",
  projectId: "tracker-f3856",
  storageBucket: "tracker-f3856.appspot.com",
  messagingSenderId: "750619479203",
  appId: "1:750619479203:web:eb577f1e74e9a9f35c316",
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);

// Inizializza Firestore (il database)
export const db = getFirestore(app);

// Inizializza Auth (login Google)
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();