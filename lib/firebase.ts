import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyA5wlLyFguhM0vbfFG21zuzgpaUSiyZq88",
  authDomain: "barbearia-c76c0.firebaseapp.com",
  projectId: "barbearia-c76c0",
  // Use the appspot.com bucket for Firebase Storage SDK compatibility
  storageBucket: "barbearia-c76c0.appspot.com",
  messagingSenderId: "267807399393",
  appId: "1:267807399393:web:aa0f82e61a3d11463dc6a0",
  measurementId: "G-90W7WWZPGT"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
