import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  isPlatformAdmin,
  listRegisteredUsers,
  type RegisteredUserRow,
} from '../lib/registeredUserService';

function fmtTs(
  t: { toDate?: () => Date } | null | undefined
): string {
  if (!t?.toDate) return '—';
  try {
    return t.toDate().toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function PlatformRegistrations() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<RegisteredUserRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setLoadErr(null);
    try {
      const ok = await isPlatformAdmin(user.uid);
      setAllowed(ok);
      if (!ok) {
        setRows([]);
        return;
      }
      const list = await listRegisteredUsers();
      setRows(list);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAllowed(false);
      setRows([]);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  if (authLoading || allowed === null) {
    return (
      <PageShell title="用户登记" subtitle="平台后台">
        <p className="text-sm text-gray-600">加载中…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="用户登记" subtitle="平台后台">
        <p className="mb-4 text-sm text-gray-700">请先登录后再访问。</p>
        <Link
          className="text-indigo-600 underline-offset-2 hover:underline"
          to="/login?returnTo=/admin/registrations"
        >
          去登录
        </Link>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="用户登记" subtitle="平台后台">
        <p className="mb-3 text-sm text-gray-700">
          当前账号无权查看。请在 Firebase 控制台创建集合{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">platform_admins</code>{' '}
          ，并以你的 UID 为文档 ID 新增一条空文档（内容可为 <code className="rounded bg-gray-100 px-1 text-xs">&#123;&#125;</code>
          ）。
        </p>
        <p className="mb-4 text-xs text-gray-500">
          UID 可在 Firebase Authentication 用户列表中查看，或浏览器控制台打印登录用户。
        </p>
        <Link to="/" className="text-indigo-600 underline-offset-2 hover:underline">
          返回首页
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="用户登记" subtitle="登录 / 注册出现过的账号">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-600">
          共 {rows.length} 条（最多拉取 500 条）。数据来自用户登录时写入的{' '}
          <code className="rounded bg-gray-100 px-1">registered_users</code>。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
        >
          {busy ? '刷新中…' : '刷新'}
        </button>
      </div>

      {loadErr ? (
        <p className="mb-3 text-sm text-red-600">{loadErr}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">UID（后 8 位）</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">类型</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">手机号（掩码）</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">首次出现</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">最近活跃</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                  暂无登记记录。任意用户登录一次后即会出现。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/80">
                  <td className="font-mono px-3 py-2 tabular-nums">
                    …{r.data.uid.slice(-8)}
                  </td>
                  <td className="px-3 py-2">
                    {r.data.isAnonymous ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                        匿名
                      </span>
                    ) : r.data.phoneMasked ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">
                        手机号
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900">
                        其他
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.data.phoneMasked ?? (r.data.isAnonymous ? '—' : '—')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {fmtTs(r.data.firstSeenAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {fmtTs(r.data.lastSeenAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <Link
          to="/"
          className="text-sm text-indigo-600 underline-offset-2 hover:underline"
        >
          返回首页
        </Link>
      </div>
    </PageShell>
  );
}
