import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { getShopBySlug, updateShop, uploadShopImage } from '../../lib/shopService';

type PaymentMethodItem = { id: string; name: string; qrCodeUrl: string };

export default function ShopSettings() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();
  const [shopId, setShopId] = useState<string | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [themeColor, setThemeColor] = useState('#E63946');
  const [bannerImage, setBannerImage] = useState('');
  const [logoImage, setLogoImage] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([]);

  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        if (authLoading) return;
        if (!user) {
          setLoading(false);
          setBootErr('未登录');
          return;
        }
        setLoading(true);
        setBootErr(null);
        try {
          const row = await getShopBySlug(slug);
          if (!row) throw new Error('店铺不存在');
          if (row.data.ownerId !== user.uid) throw new Error('无权限');
          if (cancelled) return;
          setShopId(row.id);
          setName(row.data.name ?? '');
          setThemeColor(row.data.themeColor ?? '#E63946');
          setBannerImage(row.data.bannerImage ?? '');
          setLogoImage(row.data.logoImage ?? '');
          setPaymentMethods(row.data.paymentMethods ?? []);
        } catch (e) {
          if (!cancelled) {
            setBootErr(e instanceof Error ? e.message : '加载失败');
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug]);

  const canEdit = useMemo(() => !!shopId && !!user, [shopId, user]);

  const handleSave = async () => {
    if (!shopId) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateShop(shopId, {
        name,
        themeColor,
        bannerImage: bannerImage || null,
        logoImage: logoImage || null,
        paymentMethods: paymentMethods
          .map((x) => ({
            id: x.id,
            name: x.name.trim(),
            qrCodeUrl: x.qrCodeUrl.trim(),
          }))
          .filter((x) => x.name && x.qrCodeUrl),
      });
      setMsg('店铺设置已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (
    kind: 'banner' | 'logo' | 'payment',
    file: File | null,
    paymentId?: string
  ) => {
    if (!file || !user) return;
    setMsg(null);
    if (kind === 'banner') setUploadingBanner(true);
    if (kind === 'logo') setUploadingLogo(true);
    if (kind === 'payment' && paymentId) setUploadingPaymentId(paymentId);
    try {
      const url = await uploadShopImage(user.uid, kind, file);
      if (kind === 'banner') setBannerImage(url);
      else if (kind === 'logo') setLogoImage(url);
      else if (paymentId) {
        setPaymentMethods((prev) =>
          prev.map((p) => (p.id === paymentId ? { ...p, qrCodeUrl: url } : p))
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      if (kind === 'banner') setUploadingBanner(false);
      if (kind === 'logo') setUploadingLogo(false);
      if (kind === 'payment') setUploadingPaymentId(null);
    }
  };

  const addPaymentMethod = () => {
    setPaymentMethods((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: '', qrCodeUrl: '' },
    ]);
  };

  const inputCls =
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

  if (authLoading || loading) {
    return (
      <PageShell title="店铺设置" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (bootErr) {
    return (
      <PageShell title="店铺设置" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr}</p>
        <Link
          to="/dashboard"
          className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline"
        >
          返回
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="店铺设置" subtitle={`/${slug}`}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <div className="space-y-4">
        <label className="block text-sm text-gray-800">
          店名
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="block text-sm text-gray-800">
          主题色
          <input
            type="color"
            className="mt-1 h-10 w-20 rounded border border-gray-200 bg-white"
            value={themeColor}
            onChange={(e) => setThemeColor(e.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="block text-sm text-gray-800">
          门头图（Banner）
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-sm"
            disabled={!canEdit || uploadingBanner}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void onUpload('banner', f);
              e.currentTarget.value = '';
            }}
          />
          {bannerImage ? (
            <img src={bannerImage} alt="" className="mt-2 h-24 w-full rounded object-cover" />
          ) : null}
        </label>

        <label className="block text-sm text-gray-800">
          Logo
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-sm"
            disabled={!canEdit || uploadingLogo}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void onUpload('logo', f);
              e.currentTarget.value = '';
            }}
          />
          {logoImage ? (
            <img src={logoImage} alt="" className="mt-2 h-16 w-16 rounded object-cover" />
          ) : null}
        </label>

        <div className="rounded-xl border border-gray-100 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">付款码</span>
            <button
              type="button"
              className="text-sm font-medium text-indigo-600"
              onClick={addPaymentMethod}
              disabled={!canEdit}
            >
              + 添加
            </button>
          </div>
          <div className="space-y-3">
            {paymentMethods.map((pm) => (
              <div key={pm.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <input
                  className={inputCls}
                  placeholder="名称，如 TNG / DuitNow"
                  value={pm.name}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setPaymentMethods((prev) =>
                      prev.map((x) =>
                        x.id === pm.id ? { ...x, name: e.target.value } : x
                      )
                    )
                  }
                />
                <div className="mt-2 flex gap-2">
                  <input
                    className={inputCls}
                    placeholder="二维码图片 URL（上传后自动填入）"
                    value={pm.qrCodeUrl}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setPaymentMethods((prev) =>
                        prev.map((x) =>
                          x.id === pm.id ? { ...x, qrCodeUrl: e.target.value } : x
                        )
                      )
                    }
                  />
                  <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-gray-200 px-3 text-sm text-gray-700">
                    上传
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={!canEdit || uploadingPaymentId === pm.id}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        void onUpload('payment', f, pm.id);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-red-200 px-3 text-sm text-red-700"
                    disabled={!canEdit}
                    onClick={() =>
                      setPaymentMethods((prev) => prev.filter((x) => x.id !== pm.id))
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            {paymentMethods.length === 0 ? (
              <p className="text-sm text-gray-500">暂无付款码，点击上方添加。</p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white disabled:bg-gray-300"
          disabled={!canEdit || saving}
          onClick={() => void handleSave()}
        >
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>
    </PageShell>
  );
}
