import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthUser } from './useAuthUser';
import {
  merchantCanManageAdminInvitations,
  merchantCanManageShopSettingsAndProjects,
  merchantHasShopStaffAccess,
  resolveMerchantShopRole,
  type MerchantShopActorRole,
} from '../lib/permissionService';
import { getShopBySlug, type ShopRow } from '../lib/shopService';

/** 店长台：解析当前登录用户对某店铺的店员角色与能力（含订单/对账 vs 全局配置）。 */
export function useMerchantShopAccess(shopSlug: string) {
  const { user, loading: authLoading } = useAuthUser();
  const slug = decodeURIComponent(shopSlug);

  const [shop, setShop] = useState<ShopRow | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [shopLoading, setShopLoading] = useState(true);

  const refreshShop = useCallback(async () => {
    setBootErr(null);
    setShopLoading(true);
    try {
      const row = await getShopBySlug(slug);
      setShop(row);
      if (!row) setBootErr('未找到该商户链接');
    } catch (e) {
      setShop(null);
      setBootErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setShopLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refreshShop();
  }, [refreshShop]);

  const [role, setRole] = useState<MerchantShopActorRole | null>(null);
  const [roleResolved, setRoleResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        if (authLoading || shopLoading) return;
        if (!shop || !user) {
          if (!cancelled) {
            setRole(null);
            setRoleResolved(true);
          }
          return;
        }
        if (!cancelled) setRoleResolved(false);
        try {
          const r = await resolveMerchantShopRole(user.uid, shop);
          if (!cancelled) setRole(r);
        } finally {
          if (!cancelled) setRoleResolved(true);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, shop, shopLoading, user]);

  const access = useMemo(() => {
    const staff = merchantHasShopStaffAccess(role);
    return {
      canOrdersOrReconciliation: staff,
      canConfigureShopAndProjects: merchantCanManageShopSettingsAndProjects(role),
      canManageAdminInvitations: merchantCanManageAdminInvitations(role),
    };
  }, [role]);

  const loading =
    authLoading || shopLoading || (Boolean(shop && user) && !roleResolved);

  return {
    slug,
    shop,
    bootErr,
    loading,
    user,
    role,
    refreshShop,
    ...access,
  };
}
