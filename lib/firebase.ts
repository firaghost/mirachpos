/**
 * Firebase Cloud Messaging Configuration
 * 
 * Initializes Firebase app and provides messaging instance
 */

import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, isSupported } from 'firebase/messaging';

 const env = ((import.meta as any)?.env || {}) as Record<string, any>;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase only if config is present
export const initializeFirebase = () => {
  if (!firebaseConfig.apiKey) {
    console.log('[FCM] Firebase not configured - skipping initialization');
    return null;
  }

  if (getApps().length === 0) {
    try {
      const app = initializeApp(firebaseConfig);
      console.log('[FCM] Firebase initialized');
      return app;
    } catch (error) {
      console.error('[FCM] Firebase initialization failed:', error);
      return null;
    }
  }

  return getApps()[0];
};

// Get messaging instance (only if supported)
export const getFCMMessaging = async () => {
  const supported = await isSupported();
  if (!supported) {
    console.log('[FCM] Browser does not support Firebase Messaging');
    return null;
  }

  const app = initializeFirebase();
  if (!app) return null;

  try {
    return getMessaging(app);
  } catch (error) {
    console.error('[FCM] Failed to get messaging instance:', error);
    return null;
  }
};

// Check if FCM is available
export const isFCMAvailable = async () => {
  if (!firebaseConfig.apiKey) return false;
  const supported = await isSupported();
  return supported && 'serviceWorker' in navigator;
};

export const registerFcmServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return null;
  if (!firebaseConfig.apiKey) return null;

  const configParam = encodeURIComponent(JSON.stringify(firebaseConfig));
  const url = `/firebase-messaging-sw.js?config=${configParam}`;

  try {
    return await navigator.serviceWorker.register(url);
  } catch (error) {
    console.error('[FCM] Failed to register service worker:', error);
    return null;
  }
};
