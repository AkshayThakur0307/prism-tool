/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyB8NxCmg8sgZ5TLhpOF29uQIPbii1GBlXw",
    authDomain: "discovery-accelerator.firebaseapp.com",
    projectId: "discovery-accelerator",
    storageBucket: "discovery-accelerator.firebasestorage.app",
    messagingSenderId: "771416428046",
    appId: "1:771416428046:web:c2f32a5a99e7dd3e65765f",
    measurementId: "G-43N8YQEC29"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
