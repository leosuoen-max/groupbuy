/** 返回「还剩 X 小时 Y 分」类短文案；已过期返回 null */
export function formatRemainingShort(targetIso: string, now: Date = new Date()) {
  const end = new Date(targetIso).getTime();
  const diff = end - now.getTime();
  if (diff <= 0) return null;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0) return `${h} 小时 ${min} 分`;
  return `${min} 分`;
}
