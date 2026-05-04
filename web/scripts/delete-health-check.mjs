/**
 * 一次性脚本：删除 Firestore 集合 _health_check 下的所有文档（开发联调用）。
 * 在 web/ 目录执行：node scripts/delete-health-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');

function loadEnvLocal() {
  const raw = readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnvLocal();
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

for (const [k, v] of Object.entries(firebaseConfig)) {
  if (!v) {
    console.error(`缺少环境变量: ${k}（请检查 web/.env.local）`);
    process.exit(1);
  }
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const col = collection(db, '_health_check');
const snap = await getDocs(col);

if (snap.empty) {
  console.log('集合 _health_check 已是空的，无需删除。');
  process.exit(0);
}

let n = 0;
for (const d of snap.docs) {
  await deleteDoc(doc(db, '_health_check', d.id));
  n += 1;
  console.log('已删除文档:', d.id);
}

console.log(`完成：共删除 ${n} 条。`);
