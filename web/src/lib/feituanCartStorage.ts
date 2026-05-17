import type { FeituanCart, FeituanCartProject } from '../types/feituanCart';

export const FEITUAN_CART_STORAGE_KEY = 'feituanCart';

function emptyCart(): FeituanCart {
  return { projects: [], lastUpdated: Date.now() };
}

export function getFeituanCart(): FeituanCart {
  if (typeof window === 'undefined') return emptyCart();
  try {
    const raw = localStorage.getItem(FEITUAN_CART_STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw) as Partial<FeituanCart>;
    if (!Array.isArray(parsed.projects)) return emptyCart();
    return {
      projects: parsed.projects.filter(
        (p): p is FeituanCartProject =>
          Boolean(p?.projectId && p?.shopId && Array.isArray(p.lines))
      ),
      lastUpdated: Number(parsed.lastUpdated) || Date.now(),
    };
  } catch {
    return emptyCart();
  }
}

export function setFeituanCart(cart: FeituanCart): void {
  if (typeof window === 'undefined') return;
  const next: FeituanCart = {
    ...cart,
    lastUpdated: Date.now(),
  };
  localStorage.setItem(FEITUAN_CART_STORAGE_KEY, JSON.stringify(next));
}

export function clearFeituanCart(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FEITUAN_CART_STORAGE_KEY);
}

/** 同 projectId 覆盖，不累加 */
export function upsertFeituanCartProject(
  item: Omit<FeituanCartProject, 'addedAt'> & { addedAt?: number }
): FeituanCart {
  const cart = getFeituanCart();
  const rest = cart.projects.filter((p) => p.projectId !== item.projectId);
  const next: FeituanCart = {
    projects: [
      ...rest,
      { ...item, addedAt: item.addedAt ?? Date.now() } satisfies FeituanCartProject,
    ],
    lastUpdated: Date.now(),
  };
  setFeituanCart(next);
  return next;
}

export function removeFeituanCartProject(projectId: string): FeituanCart {
  const cart = getFeituanCart();
  const next: FeituanCart = {
    projects: cart.projects.filter((p) => p.projectId !== projectId),
    lastUpdated: Date.now(),
  };
  setFeituanCart(next);
  return next;
}

export function updateFeituanCartProject(
  projectId: string,
  patch: Partial<Pick<FeituanCartProject, 'lines' | 'bundleSelections' | 'cartDraft' | 'subtotal'>>
): FeituanCart {
  const cart = getFeituanCart();
  const next: FeituanCart = {
    projects: cart.projects.map((p) =>
      p.projectId === projectId ? { ...p, ...patch, addedAt: p.addedAt } : p
    ),
    lastUpdated: Date.now(),
  };
  setFeituanCart(next);
  return next;
}

/** 徽标：购物车中的项目条数 */
export function feituanCartProjectCount(cart?: FeituanCart): number {
  const c = cart ?? getFeituanCart();
  return c.projects.length;
}

export function createFeituanPaymentRef(): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `cart_${Date.now()}_${rand}`;
}
