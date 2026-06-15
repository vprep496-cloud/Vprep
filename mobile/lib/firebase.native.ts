// Native target (Android/iOS) — Metro prefers this file over firebase.ts
// for all non-web platform builds.
import { getApps, getApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  type Auth,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Guard against re-initialization on Fast Refresh / hot reload.
// Capture the flag BEFORE initializeApp so we use the same condition for Auth.
const isNewApp = getApps().length === 0;
const firebaseApp: FirebaseApp = isNewApp ? initializeApp(firebaseConfig) : getApp();

// Use AsyncStorage-backed persistence so the user stays logged in across
// app restarts.  getReactNativePersistence is only exported by the RN build
// of @firebase/auth (dist/rn/index.js), which Metro selects via the
// "react-native" field in @firebase/auth/package.json.
export const firebaseAuth: Auth = isNewApp
  ? initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    })
  : getAuth(firebaseApp);

export default firebaseApp;
