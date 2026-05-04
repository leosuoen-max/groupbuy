const KEY = 'groupbuy_customer_key_v1';

function randomPart(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createCustomerKey(): string {
  return `c_${Date.now().toString(36)}_${randomPart()}`;
}

/**
 * 顾客端弱身份：用 localStorage 固定一个 key，跨会话查看自己的订单。
 */
export function getOrCreateCustomerKey(): string {
  if (typeof localStorage === 'undefined') return 'c_server';
  const existing = localStorage.getItem(KEY)?.trim();
  if (existing) return existing;
  const next = createCustomerKey();
  localStorage.setItem(KEY, next);
  return next;
}
