import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // PASTE YOUR REALTIME DATABASE LINK HERE AGAIN:
  databaseURL: "https://sub-tracker-v3-default-rtdb.firebaseio.com/" 
};

// Initialize the Firebase connection
const app = initializeApp(firebaseConfig);

// Export the Database AND the Authentication tools
export const db = getDatabase(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();