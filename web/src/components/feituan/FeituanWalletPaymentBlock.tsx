import { Link } from 'react-router-dom';
import { formatMYR } from '../../lib/formatMYR';
import { FEITUAN_TW } from '../../lib/feituanHomeTheme';
import type { FeituanWalletCartPaymentPlan } from '../../lib/feituanWalletService';

type WalletPlan = FeituanWalletCartPaymentPlan | {
  ok: boolean;
  message?: string;
  reason?: string;
  balance?: number;
  payAmount?: number;
};

type Props = {
  authLoading: boolean;
  hasPhone: boolean;
  plan: WalletPlan | null;
  paying: boolean;
  message: string | null;
  onPay: () => void;
  accountReturnTo?: string;
  payButtonLabel?: string;
};

export function FeituanWalletPaymentBlock({
  authLoading,
  hasPhone,
  plan,
  paying,
  message,
  onPay,
  accountReturnTo,
  payButtonLabel = '使用饭团钱包抵扣并确认',
}: Props) {
  const accountHref = accountReturnTo
    ? `/feituan/account?returnTo=${encodeURIComponent(accountReturnTo)}`
    : '/feituan/account';

  return (
    <section className="rounded-xl border border-orange-100 bg-orange-50/50 px-3 py-3">
      <h2 className="mb-1 text-sm font-semibold text-orange-950">
        支付方法一：饭团钱包
      </h2>
      <p className="mb-2 text-xs leading-relaxed text-orange-950/80">
        手机号验证后可用钱包余额付清；余额不足时请充值或继续上传付款截图。
      </p>
      {authLoading ? (
        <p className="text-xs text-orange-800">正在检查登录状态…</p>
      ) : !hasPhone ? (
        <div className="space-y-2 rounded-lg bg-white px-3 py-2 text-xs text-orange-900 ring-1 ring-orange-100">
          <p>请先完成手机号验证后使用饭团钱包。</p>
          <Link
            to={accountHref}
            className="inline-flex rounded-lg bg-orange-600 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            去验证手机号
          </Link>
        </div>
      ) : plan && !plan.ok ? (
        <div className="space-y-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
          <p className="font-medium">{plan.message}</p>
          {'payAmount' in plan && plan.payAmount != null && 'balance' in plan ? (
            <p>
              当前待付 {formatMYR(plan.payAmount)} · 钱包余额{' '}
              {formatMYR(plan.balance ?? 0)}
            </p>
          ) : null}
          {plan.reason === 'insufficient' ? (
            <Link
              to="/feituan/wallet/topup"
              className="inline-flex rounded-lg bg-orange-600 px-3 py-1.5 text-[11px] font-semibold text-white"
            >
              去充值
            </Link>
          ) : null}
        </div>
      ) : plan?.ok &&
        typeof plan.payAmount === 'number' &&
        typeof plan.balance === 'number' ? (
        <>
          <div className="mb-2 rounded-lg bg-white px-3 py-2 text-xs text-orange-950 ring-1 ring-orange-100">
            <p>
              当前待抵扣：<strong>{formatMYR(plan.payAmount)}</strong>
            </p>
            <p className="mt-0.5">
              钱包余额：{formatMYR(plan.balance)} → 抵扣后余额{' '}
              {formatMYR(plan.balance - plan.payAmount)}
            </p>
          </div>
          <button
            type="button"
            disabled={paying}
            onClick={onPay}
            className={`inline-flex h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${FEITUAN_TW.btn}`}
          >
            {paying ? '处理中…' : payButtonLabel}
          </button>
        </>
      ) : null}
      {message ? (
        <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-orange-900">
          {message}
        </p>
      ) : null}
    </section>
  );
}
