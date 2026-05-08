/**
 * 开发用：清空本应用用到的 Firestore 顶层集合（商户/项目/订单/权限/配送/邀请/次卡相关等）。
 * 不会删除 Firebase Auth 用户；匿名账号 UID 不变，但名下 Firestore 数据会空，可重新走初始化页。
 *
 * 用法（在 web/ 目录）：
 *   node scripts/dev-wipe-firestore.mjs --yes
 *
 * 依赖 web/.env.local 中的 VITE_FIREBASE_*（与 delete-health-check.mjs 相同）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  writeBatch,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');

/** 与 docs/06 及 web/src/lib 中集合名保持一致 */
const COLLECTIONS_TO_WIPE = [
  'orders',
  'projects',
  'permissions',
  'delivery_points',
  'invitations',
  'shops',
  'card_templates',
  'customer_cards',
  'card_purchase_requests',
  'card_ledger',
  'card_payment_proof_hashes',
  '_health_check',
];

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

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.error(
    '危险：将删除以下集合中的全部文档：\n  ' +
      COLLECTIONS_TO_WIPE.join('\n  ') +
      '\n\n追加参数 --yes 后执行。'
  );
  process.exit(1);
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

async function wipeCollection(name) {
  const colRef = collection(db, name);
  let total = 0;
  while (true) {
    const snap = await getDocs(query(colRef, limit(500)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    for (const d of snap.docs) {
      batch.delete(doc(db, name, d.id));
    }
    await batch.commit();
    total += snap.size;
    if (snap.size < 500) break;
  }
  if (total > 0) {
    console.log(`✓ ${name}: 已删除 ${total} 条文档`);
  } else {
    console.log(`· ${name}: 已是空的`);
  }
}

console.log('项目:', firebaseConfig.projectId);
console.log('开始清空…\n');

for (const name of COLLECTIONS_TO_WIPE) {
  try {
    await wipeCollection(name);
  } catch (e) {
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

console.log('\n完成。请刷新商户后台，应出现「完成初始化」页面。');
