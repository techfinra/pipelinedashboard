import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCfndFZ4zAabAJMop00-LHAaWzo7bde7K8",
  authDomain: "sales-dashboard-3cf7b.firebaseapp.com",
  projectId: "sales-dashboard-3cf7b",
  storageBucket: "sales-dashboard-3cf7b.firebasestorage.app",
  messagingSenderId: "254434887831",
  appId: "1:254434887831:web:169cc700bbdc06f84981d2",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const ALLOWED_DOMAIN = "techfinratings.com";

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: ALLOWED_DOMAIN });
