import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// This securely pulls your passwords from the hidden .env file
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize the Firebase connection
const app = initializeApp(firebaseConfig);

// Initialize the Database and export it so your React app can use it
export const db = getFirestore(app);