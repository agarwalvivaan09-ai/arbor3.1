// One Firebase initialisation shared by every page (the web config is public by design;
// access is enforced by firestore.rules).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import * as authApi from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import * as fs from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-aNwo7FYCvoUuk39-Zhh7PlY5GXn_7QI",
  authDomain: "arbor-2f198.firebaseapp.com",
  projectId: "arbor-2f198",
  storageBucket: "arbor-2f198.firebasestorage.app",
  messagingSenderId: "737678584809",
  appId: "1:737678584809:web:e62efd7418b65396283978",
};

export const app = initializeApp(firebaseConfig);
export const auth = authApi.getAuth(app);
export const db = fs.getFirestore(app);
export const { onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } = authApi;
export const fb = {
  collection: fs.collection, addDoc: fs.addDoc, getDocs: fs.getDocs, query: fs.query, where: fs.where,
  doc: fs.doc, getDoc: fs.getDoc, setDoc: fs.setDoc, updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc, writeBatch: fs.writeBatch,
};
