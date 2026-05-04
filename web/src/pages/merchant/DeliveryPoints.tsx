import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  createDeliveryPoint,
  listDeliveryPointsByShopId,
  updateDeliveryPoint,
  type DeliveryPointRow,
} from '../../lib/deliveryPointService';
import { getShopBySlug } from '../../lib/shopService';

export default function DeliveryPoints() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();

  const [bootErr, setBootErr] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [rows, setRows] = useState<DeliveryPointRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [detailAddress, setDetailAddress] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadList = useCallback(async (sid: string) => {
    setLoadingList(true);
    try {
      const list = await listDeliveryPointsByShopId(sid, {
        includeInactive: true,
      });
      setRows(list);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (authLoading) return;
      setBootErr(null);
      if (!user) {
        setShopId(null);
        return;
      }
      try {
        const shop = await getShopBySlug(slug);
        if (cancelled) return;
        if (!shop) {
          setBootErr('店铺不存在');
          setShopId(null);
          return;
        }
        if (shop.data.ownerId !== user.uid) {
          setBootErr('无权限');
          setShopId(null);
          return;
        }
        setShopId(shop.id);
        await loadList(shop.id);
      } catch (e) {
        if (!cancelled) {
          setBootErr(e instanceof Error ? e.message : '加载失败');
          setShopId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug, loadList]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDetailAddress('');
    setDeliveryTime('');
    setImageUrl('');
  };

  const startEdit = (row: DeliveryPointRow) => {
    setEditingId(row.id);
    setName(row.data.name);
    setDetailAddress(row.data.detailAddress ?? '');
    setDeliveryTime(row.data.deliveryTime ?? '');
    setImageUrl(row.data.imageUrl ?? '');
    setMsg(null);
  };

  const handleSubmit = async () => {
    if (!shopId) return;
    const n = name.trim();
    if (!n) {
      setMsg('请填写配送点名称');
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      if (editingId) {
        await updateDeliveryPoint(editingId, {
          name: n,
          detailAddress,
          deliveryTime,
          imageUrl,
        });
        setMsg('已保存修改');
      } else {
        await createDeliveryPoint(shopId, {
          name: n,
          detailAddress: detailAddress.trim() || undefined,
          deliveryTime: deliveryTime.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
        });
        setMsg('已新增配送点');
        resetForm();
      }
      await loadList(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: DeliveryPointRow) => {
    if (!shopId) return;
    const currentlyOn = row.data.isActive !== false;
    setMsg(null);
    try {
      await updateDeliveryPoint(row.id, { isActive: !currentlyOn });
      await loadList(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    }
  };

  const base = `/dashboard/${encodeURIComponent(slug)}`;

  if (authLoading) {
    return (
      <PageShell title="配送点库" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="配送点库" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (bootErr) {
    return (
      <PageShell title="配送点库" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr}</p>
        <Link
          className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to="/dashboard"
        >
          返回
        </Link>
      </PageShell>
    );
  }

  const input =
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

  return (
    <PageShell
      title="配送点库"
      subtitle="保存在店铺层级，编辑项目时勾选本次启用（见 docs/04）。"
    >
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <div className="mb-6 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div className="text-sm font-semibold text-gray-900">
          {editingId ? '编辑配送点' : '新增配送点'}
        </div>
        <label className="block text-sm text-gray-800">
          简短名称 <span className="text-red-600">*</span>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：A 座大堂"
          />
        </label>
        <label className="block text-sm text-gray-800">
          详细地址（选填）
          <input
            className={input}
            value={detailAddress}
            onChange={(e) => setDetailAddress(e.target.value)}
          />
        </label>
        <label className="block text-sm text-gray-800">
          配送时间（选填）
          <input
            className={input}
            value={deliveryTime}
            onChange={(e) => setDeliveryTime(e.target.value)}
            placeholder="如：18:30 - 19:00"
          />
        </label>
        <label className="block text-sm text-gray-800">
          地点图片 URL（选填）
          <input
            className={input}
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://"
          />
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          {editingId ? (
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
              onClick={() => resetForm()}
            >
              取消编辑
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
            disabled={saving || !shopId}
            onClick={() => void handleSubmit()}
          >
            {saving ? '保存中…' : editingId ? '保存修改' : '保存新增'}
          </button>
        </div>
      </div>

      <div className="mb-2 text-sm font-semibold text-gray-900">已有配送点</div>
      {loadingList ? (
        <p className="text-sm text-gray-600">加载列表…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600">暂无配送点，请先在上方可新增。</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-medium text-gray-900">
                    #{row.data.number ?? row.data.sortOrder ?? '—'}{' '}
                    {row.data.name}
                  </span>
                  {row.data.isActive === false ? (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                      已停用
                    </span>
                  ) : null}
                  {row.data.detailAddress ? (
                    <p className="mt-1 text-xs text-gray-600">
                      {row.data.detailAddress}
                    </p>
                  ) : null}
                  {row.data.deliveryTime ? (
                    <p className="text-xs text-gray-500">{row.data.deliveryTime}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-800"
                    onClick={() => startEdit(row)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-800"
                    onClick={() => void toggleActive(row)}
                  >
                    {row.data.isActive === false ? '启用' : '停用'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Link
          to={base}
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          ← 返回后台
        </Link>
      </div>
    </PageShell>
  );
}
