import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { compressImageFileForUpload } from '../lib/imageCompress';
import { sha256HexOfFile } from '../lib/fileSha256';
import { formatMYR } from '../lib/formatMYR';
import {
  appendFeituanWalletTopupScreenshot,
  calculateFeituanWalletTopupPreview,
  effectiveFeituanWalletTopupStatus,
  getFeituanWalletSettings,
  getFeituanWalletTopupRequest,
  submitFeituanWalletTopupRequest,
  uploadFeituanWalletPaymentImage,
  type FeituanWalletTopupRequestRow,
} from '../lib/feituanWalletService';
import { computeImageFileMd5Hex } from '../lib/paymentImageUpload';
import type { FeituanWalletSettingsDoc } from '../types/firestore';

export default function FeituanWalletTopup() {
  const { user, loading: authLoading } = useAuthUser();
  const [settings, setSettings] = useState<FeituanWalletSettingsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [request, setRequest] = useState<FeituanWalletTopupRequestRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshRequest = useCallback(async () => {
    if (!requestId) return;
    setRequest(await getFeituanWalletTopupRequest(requestId));
  }, [requestId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getFeituanWalletSettings();
        if (!cancelled) setSettings(s);
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : '加载充值配置失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTiers = useMemo(
    () => (settings?.topupTiers ?? []).filter((tier) => tier.isActive !== false),
    [settings?.topupTiers]
  );
  const paymentMethods = useMemo(
    () =>
      (settings?.paymentMethods ?? [])
        .filter((method) => method.isActive !== false && method.qrCodeUrl)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [settings?.paymentMethods]
  );
  const preview = useMemo(
    () => calculateFeituanWalletTopupPreview(Number(amount), activeTiers),
    [activeTiers, amount]
  );

  const startTopup = async (pay: number) => {
    if (!user?.phoneNumber) return;
    setBusy(true);
    setMsg(null);
    try {
      const id = await submitFeituanWalletTopupRequest(user, pay);
      setRequestId(id);
      setRequest(await getFeituanWalletTopupRequest(id));
      setMsg('已生成充值申请，请上传付款截图');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '提交充值失败');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !user || !requestId) return;
    setUploading(true);
    setMsg(null);
    try {
      const toSend = await compressImageFileForUpload(file);
      const hex = await sha256HexOfFile(toSend);
      const md5 = await computeImageFileMd5Hex(toSend);
      const url = await uploadFeituanWalletPaymentImage({
        userId: user.uid,
        requestId,
        file: toSend,
      });
      await appendFeituanWalletTopupScreenshot(requestId, user.uid, url, {
        md5Hash: md5,
        contentSha256: hex,
      });
      await refreshRequest();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <PageShell title="饭团钱包充值" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user?.phoneNumber) {
    return (
      <PageShell title="饭团钱包充值" subtitle="需要手机号验证">
        <Link
          to="/feituan/account?returnTo=/feituan/wallet/topup"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white"
        >
          去验证手机号
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="饭团钱包充值" subtitle="实付 + 赠送一起入账">
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}
      <p className="mb-3 text-sm">
        <Link className="text-orange-600 underline-offset-2 hover:underline" to="/feituan/wallet">
          ← 返回钱包
        </Link>
      </p>

      {!request ? (
        <>
          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">选择充值档位</h2>
            {activeTiers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-3 py-5 text-center text-xs text-amber-900">
                饭团后台尚未配置充值档位；仍可输入自定义金额，本金入账不赠送。
              </p>
            ) : (
              <div className="space-y-2">
                {activeTiers.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAmount(String(tier.payAmount));
                      void startTopup(tier.payAmount);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-orange-100 bg-white px-3 py-3 text-left shadow-sm disabled:opacity-60"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {tier.label || `充 ${formatMYR(tier.payAmount)}`}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        实付 {formatMYR(tier.payAmount)} · 赠送 {formatMYR(tier.bonusAmount)} · 到账{' '}
                        {formatMYR(tier.payAmount + tier.bonusAmount)}
                      </p>
                    </div>
                    <span className="text-base font-bold text-orange-700">
                      {formatMYR(tier.payAmount)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="mb-4 rounded-xl border border-gray-100 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">自定义金额</h2>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="输入充值金额，例如 260"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-[16px] outline-none focus:border-orange-300"
            />
            <div className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-950">
              <p>
                实付 {formatMYR(preview.payAmount)} · 赠送 {formatMYR(preview.bonusAmount)} · 入账{' '}
                <strong>{formatMYR(preview.creditAmount)}</strong>
              </p>
              {preview.appliedTiers.length > 0 ? (
                <p className="mt-1 text-orange-800">
                  匹配：{preview.appliedTiers.map((tier) => `${formatMYR(tier.payAmount)} × ${tier.count}`).join('，')}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || preview.payAmount <= 0}
              onClick={() => void startTopup(preview.payAmount)}
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? '提交中…' : '生成充值申请'}
            </button>
          </section>
        </>
      ) : (
        <section className="space-y-3">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold text-indigo-900">上传付款截图</h2>
            <div className="mb-3 rounded-lg bg-white px-3 py-2 text-xs text-indigo-900 ring-1 ring-indigo-100">
              <p>
                应付：<strong>{formatMYR(request.data.payAmount)}</strong>
              </p>
              <p className="mt-0.5">
                赠送 {formatMYR(request.data.bonusAmount)} · 入账 {formatMYR(request.data.creditAmount)}
              </p>
            </div>
            <div className="flex gap-3">
              <div className="w-[6.5rem] shrink-0">
                {paymentMethods[0] ? (
                  <img
                    src={paymentMethods[0].qrCodeUrl}
                    alt={paymentMethods[0].name}
                    className="aspect-square w-[6.5rem] rounded-xl border border-indigo-100 object-cover"
                  />
                ) : (
                  <div className="flex aspect-square w-[6.5rem] items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-white text-center text-[11px] text-indigo-500">
                    暂无收款码
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-2 text-xs leading-relaxed text-indigo-900/80">
                  请按应付金额转账，上传截图后进入「待核实」，饭团管理员核对后再入账。
                </p>
                {request && effectiveFeituanWalletTopupStatus(request.data) === 'awaiting_payment' ? (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {uploading ? '上传中…' : '选择图片上传'}
                  </button>
                ) : request ? (
                  <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
                    {effectiveFeituanWalletTopupStatus(request.data) === 'pending_review'
                      ? '已提交凭证，请等待饭团管理员核实。'
                      : '当前状态不可继续上传。'}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void handleUpload(f);
              e.currentTarget.value = '';
            }}
          />
          {request && (request.data.paymentScreenshots ?? []).length > 0 ? (
            <ul className="space-y-2">
              {request.data.paymentScreenshots.map((shot) => (
                <li key={shot.url} className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2">
                  <a href={shot.url} target="_blank" rel="noreferrer">
                    <img src={shot.url} alt="" className="h-16 w-16 rounded-md object-cover" />
                  </a>
                  <div className="text-xs text-gray-700">
                    <p className="font-medium">已上传付款截图</p>
                    <p className="mt-1 text-gray-500">
                      {shot.uploadedAt?.toDate?.().toLocaleString?.() ?? ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <Link
            to="/feituan/wallet"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
          >
            返回钱包
          </Link>
        </section>
      )}
    </PageShell>
  );
}
