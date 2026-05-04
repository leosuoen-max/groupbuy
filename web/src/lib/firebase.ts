import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const requiredEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

function readFirebaseConfig() {
  const values = Object.fromEntries(
    requiredEnv.map((key) => [key, import.meta.env[key] as string | undefined])
  ) as Record<(typeof requiredEnv)[number], string | undefined>;

  const missing = requiredEnv.filter((k) => !values[k]?.trim());
  if (missing.length) {
    throw new Error(
      `缺少 Firebase 环境变量：${missing.join(', ')}。请把 .env.local 放在 web/ 目录（与 package.json 同级），然后重启 npm run dev。`
    );
  }

  return {
    apiKey: values.VITE_FIREBASE_API_KEY,
    authDomain: values.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: values.VITE_FIREBASE_PROJECT_ID,
    storageBucket: values.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: values.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: values.VITE_FIREBASE_APP_ID,
  };
}

function createClients() {
  const app = initializeApp(readFirebaseConfig());
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
  };
}

type Clients = ReturnType<typeof createClients>;

let cache: Clients | undefined;

function getClients(): Clients {
  if (!cache) {
    cache = createClients();
  }
  return cache;
}

/** 懒初始化：避免在 import 阶段抛错导致整页白屏；首次调用时才读环境变量 */
export function getFirebaseApp(): FirebaseApp {
  return getClients().app;
}

export function getAuthClient(): Auth {
  return getClients().auth;
}

export function getDb(): Firestore {
  return getClients().db;
}

export function getStorageClient(): FirebaseStorage {
  return getClients().storage;
}
