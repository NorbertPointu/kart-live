import {initializeApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';
const config={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
export const configured=Boolean(config.apiKey&&config.projectId&&config.appId);
const app=configured?initializeApp(config):null;
export const auth=app?getAuth(app):null;
export const db=app?getFirestore(app):null;
export const eventId=import.meta.env.VITE_EVENT_ID||'lille-endurance-2026';
