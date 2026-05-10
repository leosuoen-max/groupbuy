import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { listProjectsByShopId } from '../lib/projectService';
import { listShopsByOwner, sortShopsByCreatedAt } from '../lib/shopService';

const link = 'text-indigo-600 underline-offset-2 hover:underline';

type CustomerEntry = {
  shopSlug: string;
  shopName: string;
  projectId: string;
  projectTitle: string;
};

/** 商户自用：店铺与项目链接汇总（原首页文案页） */
export default function HomeLinks() {
  const { user, loading: authLoading } = useAuthUser();
  const [customerEntries, setCustomerEntries] = useState<CustomerEntry[]>([]);
  const [shopSlugs, setShopSlugs] = useState<string[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const primarySlug = shopSlugs[0] ?? null;

  useEffect(() => {
    if (!user) {
      queueMicrotask(() => {
        setCustomerEntries([]);
        setShopSlugs([]);
        setLoadErr(null);
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoadErr(null);
      try {
        const shops = await listShopsByOwner(user.uid);
        const sorted = sortShopsByCreatedAt(shops);
        const slugs = sorted.map((s) => s.data.slug).filter(Boolean);
        const entries: CustomerEntry[] = [];
        for (const s of sorted) {
          const projects = await listProjectsByShopId(s.id);
          for (const p of projects) {
            if (p.data.status === 'draft') continue;
            entries.push({
              shopSlug: s.data.slug,
              shopName: s.data.name,
              projectId: p.id,
              projectTitle: p.data.title?.trim() || p.id,
            });
          }
        }
        if (!cancelled) {
          setShopSlugs(slugs);
          setCustomerEntries(entries);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : '加载商户/项目失败');
          setCustomerEntries([]);
          setShopSlugs([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const hint = useMemo(
    () =>
      '顾客端地址格式为 /shop/{公开链接 slug}/{项目 ID}，其中项目 ID 是 Firestore 文档 id（在项目列表里对应每个项目）。若数据库里没有对应商户，会提示「找不到该店铺链接」。',
    []
  );

  return (
    <main className="w-full px-4 py-5">
      <p className="mb-3 text-sm">
        <Link className={link} to="/">
          ← 商户入口
        </Link>
      </p>
      <h1 className="mb-3 text-2xl font-semibold text-gray-900">链接与快捷入口</h1>
      <p className="mb-4 text-sm leading-relaxed text-gray-600">{hint}</p>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-gray-900">账号</h2>
        <ul className="list-disc space-y-1 pl-5 text-gray-800">
          <li>
            <Link className={link} to="/login">
              登录
            </Link>
          </li>
          <li>
            <Link className={link} to="/register">
              注册（手机号验证码）
            </Link>
          </li>
          <li>
            <Link className={link} to="/invite/demo-code">
              管理员邀请（示例）
            </Link>
          </li>
        </ul>
      </section>

      <section className="mb-6 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-3">
        <h2 className="mb-2 text-base font-semibold text-amber-950">顾客端 · 可访问链接</h2>
        {authLoading ? (
          <p className="text-sm text-gray-600">加载登录状态…</p>
        ) : !user ? (
          <p className="text-sm text-gray-700">
            请先{' '}
            <Link className={link} to="/login">
              登录
            </Link>
            ，以便从云端读取你名下的<strong>商户与项目</strong>并生成下方链接；或用商户后台里复制到的{' '}
            <code className="rounded bg-white px-1 text-xs">slug</code> 与{' '}
            <code className="rounded bg-white px-1 text-xs">projectId</code>{' '}
            手动拼路径。
          </p>
        ) : loadErr ? (
          <p className="text-sm text-red-700">{loadErr}</p>
        ) : customerEntries.length === 0 ? (
          <p className="text-sm text-gray-700">
            当前账号下还没有<strong>已发布或已截止</strong>的项目（草稿不会出现在这里）。请先到{' '}
            <Link className={link} to="/dashboard">
              商户后台
            </Link>{' '}
            → 创建项目 → <strong>发布</strong>，再回到本页刷新。
          </p>
        ) : (
          <ul className="space-y-3 text-sm text-gray-800">
            {customerEntries.map((e) => {
              const base = `/shop/${encodeURIComponent(e.shopSlug)}/${encodeURIComponent(e.projectId)}`;
              return (
                <li
                  key={`${e.shopSlug}-${e.projectId}`}
                  className="rounded-lg border border-amber-100 bg-white px-3 py-2"
                >
                  <div className="font-medium text-gray-900">
                    {e.shopName} · {e.projectTitle}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <Link className={link} to={base}>
                      项目首页
                    </Link>
                    <Link className={link} to={`${base}/order`}>
                      下单
                    </Link>
                    <Link className={link} to={`${base}/my-orders`}>
                      我的订单
                    </Link>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-gray-500">{base}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-900">商户后台</h2>
        <ul className="list-disc space-y-1 pl-5 text-gray-800">
          <li>
            <Link className={link} to="/dashboard">
              进入商户后台
            </Link>
          </li>
          {primarySlug ? (
            <>
              <li>
                <Link className={link} to={`/dashboard/${encodeURIComponent(primarySlug)}`}>
                  后台概览（{primarySlug}）
                </Link>
              </li>
              <li>
                <Link
                  className={link}
                  to={`/dashboard/${encodeURIComponent(primarySlug)}/projects`}
                >
                  项目列表
                </Link>
              </li>
              <li>
                <Link
                  className={link}
                  to={`/dashboard/${encodeURIComponent(primarySlug)}/projects/new`}
                >
                  新建项目
                </Link>
              </li>
              <li>
                <Link className={link} to={`/dashboard/${encodeURIComponent(primarySlug)}/orders`}>
                  订单管理
                </Link>
              </li>
              <li>
                <Link
                  className={link}
                  to={`/dashboard/${encodeURIComponent(primarySlug)}/delivery-points`}
                >
                  配送点
                </Link>
              </li>
              <li>
                <Link className={link} to={`/dashboard/${encodeURIComponent(primarySlug)}/admins`}>
                  管理员
                </Link>
              </li>
              <li>
                <Link className={link} to={`/dashboard/${encodeURIComponent(primarySlug)}/settings`}>
                  基本设置
                </Link>
              </li>
            </>
          ) : (
            <li className="list-none pl-0 text-sm text-gray-600">
              登录并完成商户初始化后，这里会出现快捷入口。
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
