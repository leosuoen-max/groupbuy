/**
 * 一次性：为所有 projects 写入 deliveryDate / deliveryPeriod / deliveryTimeText。
 * 在 web/ 目录执行：node scripts/migrate-project-delivery-slot.mjs
 * 加 --dry-run 仅打印不写库。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  collection,
  getDocs,
  getFirestore,
  updateDoc,
  doc,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const dryRun = process.argv.includes('--dry-run');

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

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDeliveryDateLocal(dateStr) {
  const m = DATE_RE.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) {
    return null;
  }
  return dt;
}

function formatDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function deliveryPeriodLabel(period) {
  return period === 'midday' ? '中午' : '傍晚';
}

function formatDeliverySlotLabel(dateStr, period) {
  const dt = parseDeliveryDateLocal(dateStr);
  if (!dt) return '';
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const weekday = WEEKDAY_ZH[dt.getDay()];
  return `${m}/${day}（${weekday}）${deliveryPeriodLabel(period)}`;
}

function inferDeliveryPeriodFromText(text) {
  const t = text.trim();
  if (!t) return null;
  if (/傍晚|晚饭|晚餐时|晚餐(?![间时])/.test(t)) return 'evening';
  if (/中午|午间|午餐时/.test(t)) return 'midday';
  if (/晚餐|晚饭/.test(t)) return 'evening';
  if (/午餐/.test(t)) return 'midday';
  return null;
}

function inferDeliveryDateFromText(text, fallback) {
  const t = text.trim();
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (parseDeliveryDateLocal(candidate)) return candidate;
  }
  const slash = t.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const ref = fallback ?? new Date();
    const y = ref.getFullYear();
    const candidate = formatDateInputValue(
      new Date(y, Number(slash[1]) - 1, Number(slash[2]), 12, 0, 0, 0)
    );
    if (parseDeliveryDateLocal(candidate)) return candidate;
  }
  const cn = t.match(/(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const ref = fallback ?? new Date();
    const y = ref.getFullYear();
    const candidate = formatDateInputValue(
      new Date(y, Number(cn[1]) - 1, Number(cn[2]), 12, 0, 0, 0)
    );
    if (parseDeliveryDateLocal(candidate)) return candidate;
  }
  if (fallback) return formatDateInputValue(fallback);
  return null;
}

function inferSlot(data) {
  if (
    data.deliveryDate &&
    data.deliveryPeriod &&
    parseDeliveryDateLocal(data.deliveryDate)
  ) {
    return { date: data.deliveryDate, period: data.deliveryPeriod };
  }
  const closesAt = data.closesAt?.toDate?.() ?? null;
  const text = data.deliveryTimeText ?? '';
  const period = inferDeliveryPeriodFromText(text) ?? 'midday';
  const date = inferDeliveryDateFromText(text, closesAt);
  if (!date) return null;
  return { date, period };
}

const env = loadEnvLocal();
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const snap = await getDocs(collection(db, 'projects'));
let updated = 0;
let skipped = 0;

for (const d of snap.docs) {
  const data = d.data();
  const slot = inferSlot(data);
  if (!slot) {
    console.warn(`SKIP ${d.id} — 无法推断配送时间`);
    skipped += 1;
    continue;
  }
  const label = formatDeliverySlotLabel(slot.date, slot.period);
  const patch = {
    deliveryDate: slot.date,
    deliveryPeriod: slot.period,
    deliveryTimeText: label,
  };
  if (
    data.deliveryDate === patch.deliveryDate &&
    data.deliveryPeriod === patch.deliveryPeriod &&
    data.deliveryTimeText === patch.deliveryTimeText
  ) {
    skipped += 1;
    continue;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}${d.id} → ${label}`);
  if (!dryRun) {
    await updateDoc(doc(db, 'projects', d.id), patch);
  }
  updated += 1;
}

console.log(
  `Done. ${dryRun ? 'Would update' : 'Updated'}: ${updated}, skipped: ${skipped}, total: ${snap.size}`
);
