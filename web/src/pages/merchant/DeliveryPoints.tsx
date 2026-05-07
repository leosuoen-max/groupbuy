import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  createDeliveryPoint,
  deleteDeliveryPoint,
  listDeliveryPointsByOwnerId,
  normalizeDeliveryPointCode,
  uploadDeliveryPointImage,
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
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [rows, setRows] = useState<DeliveryPointRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [shortName, setShortName] = useState('');
  const [detailAddress, setDetailAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadList = useCallback(async (oid: string, sid?: string | null) => {
    setLoadingList(true);
    try {
      const list = await listDeliveryPointsByOwnerId(oid, {
        includeInactive: true,
        fallbackShopId: sid ?? undefined,
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
        setOwnerId(null);
        return;
      }
      try {
        const shop = await getShopBySlug(slug);
        if (cancelled) return;
        if (!shop) {
          setBootErr('店铺不存在');
          setShopId(null);
          setOwnerId(null);
          return;
        }
        if (shop.data.ownerId !== user.uid) {
          setBootErr('无权限');
          setShopId(null);
          setOwnerId(null);
          return;
        }
        setShopId(shop.id);
        setOwnerId(shop.data.ownerId);
        await loadList(shop.data.ownerId, shop.id);
      } catch (e) {
        if (!cancelled) {
          setBootErr(e instanceof Error ? e.message : '加载失败');
          setShopId(null);
          setOwnerId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug, loadList]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const resetForm = () => {
    setEditingId(null);
    setCode('');
    setShortName('');
    setDetailAddress('');
    setMapsUrl('');
    setImageUrl('');
    setImagePreviewUrl('');
  };

  const startEdit = (row: DeliveryPointRow) => {
    setEditingId(row.id);
    setCode(row.data.code ?? '');
    setShortName(row.data.shortName ?? row.data.name ?? '');
    setDetailAddress(row.data.detailAddress ?? '');
    setMapsUrl(row.data.mapsUrl ?? '');
    setImageUrl(row.data.imageUrl ?? '');
    setImagePreviewUrl(row.data.imageUrl ?? '');
    setMsg(null);
  };

  const handleSubmit = async () => {
    if (!ownerId) return;
    setSaving(true);
    setMsg(null);
    try {
      const normalizedCode = normalizeDeliveryPointCode(code);
      const sn = shortName.trim();
      if (!sn) throw new Error('请填写配送点简称');
      if (editingId) {
        await updateDeliveryPoint(editingId, {
          ownerId,
          code: normalizedCode,
          shortName: sn,
          detailAddress,
          mapsUrl,
          imageUrl,
        }, { fallbackShopId: shopId ?? undefined });
        setMsg('已保存修改');
      } else {
        await createDeliveryPoint(ownerId, {
          code: normalizedCode,
          shortName: sn,
          detailAddress: detailAddress.trim() || undefined,
          mapsUrl: mapsUrl.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
        }, { fallbackShopId: shopId ?? undefined });
        setMsg('已新增配送点');
        resetForm();
      }
      await loadList(ownerId, shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: DeliveryPointRow) => {
    if (!ownerId) return;
    const currentlyOn = row.data.isActive !== false;
    setMsg(null);
    try {
      await updateDeliveryPoint(row.id, { isActive: !currentlyOn });
      await loadList(ownerId, shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    }
  };

  const handleDelete = async (row: DeliveryPointRow) => {
    if (!ownerId) return;
    const label = `[${row.data.code ?? '—'}] ${row.data.shortName ?? row.data.name}`;
    const ok = window.confirm(`确定删除配送点：${label}？\n\n删除后所有店铺将不可再选用该配送点。`);
    if (!ok) return;
    setMsg(null);
    try {
      if (editingId === row.id) resetForm();
      await deleteDeliveryPoint(row.id);
      await loadList(ownerId, shopId);
      setMsg('已删除配送点');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleUploadImage = async (file: File | null) => {
    if (!ownerId || !file) return;
    const localPreview = URL.createObjectURL(file);
    setImagePreviewUrl(localPreview);
    setUploadingImage(true);
    setMsg(null);
    try {
      const url = await uploadDeliveryPointImage(ownerId, file);
      setImageUrl(url);
      setImagePreviewUrl(url);
      setMsg('图片上传成功，保存后生效');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '图片上传失败');
    } finally {
      setUploadingImage(false);
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
      subtitle="账号级共享库：同账号下多店可共用，项目里按需勾选。"
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
          编号（1-2 位字母 + 1-2 位数字） <span className="text-red-600">*</span>
          <input
            className={input}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="如：A1 / AB12"
          />
        </label>
        <label className="block text-sm text-gray-800">
          简称 <span className="text-red-600">*</span>
          <input
            className={input}
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder="如：A座大堂"
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
          谷歌地图链接（选填）
          <input
            className={input}
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://maps.google.com/..."
          />
        </label>
        <label className="block text-sm text-gray-800">
          上传地点图片（选填）
          <div className="mt-2 flex items-start gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {imagePreviewUrl || imageUrl ? (
                <img
                  src={imagePreviewUrl || imageUrl}
                  alt="地点缩略图"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                  暂无图片
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="file"
                accept="image/*"
                className="block w-full text-sm text-gray-700"
                disabled={uploadingImage}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  void handleUploadImage(f);
                  e.currentTarget.value = '';
                }}
              />
              {uploadingImage ? (
                <p className="mt-1 text-xs text-gray-500">上传中…</p>
              ) : null}
              <button
                type="button"
                className="mt-2 rounded border border-red-200 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                disabled={!(imagePreviewUrl || imageUrl)}
                onClick={() => {
                  setImageUrl('');
                  setImagePreviewUrl('');
                }}
              >
                删除图片
              </button>
            </div>
          </div>
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
            disabled={saving || !ownerId}
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
                    [{row.data.code ?? '—'}] {row.data.shortName ?? row.data.name}
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
                  {row.data.mapsUrl ? (
                    <a
                      href={row.data.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-xs text-indigo-600 hover:underline"
                    >
                      打开谷歌地图
                    </a>
                  ) : null}
                  {row.data.imageUrl ? (
                    <a
                      href={row.data.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      查看图片
                    </a>
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
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                    onClick={() => void handleDelete(row)}
                  >
                    删除
                  </button>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={row.data.isActive !== false}
                      onChange={() => void toggleActive(row)}
                    />
                    <div className="h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-emerald-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300"></div>
                    <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"></div>
                  </label>
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
