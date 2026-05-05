import { parseScreenshotEntries } from '../../lib/paymentScreenshotHelpers';

function flagBorder(flag: 'green' | 'yellow' | 'red' | null): string {
  if (flag === 'green') return 'border-l-emerald-500';
  if (flag === 'yellow') return 'border-l-amber-400';
  if (flag === 'red') return 'border-l-red-500';
  return 'border-l-gray-300';
}

function flagLabel(flag: 'green' | 'yellow' | 'red' | null): string | null {
  if (flag === 'green') return '🟢 正常';
  if (flag === 'yellow') return '🟡 请注意';
  if (flag === 'red') return '🔴 存疑';
  return null;
}

type Props = {
  paymentScreenshots: unknown;
};

/** 商户核对付款凭证（大图 + 可选三色标记，见 docs/04） */
export function PaymentScreenshotsPanel({ paymentScreenshots }: Props) {
  const parsed = parseScreenshotEntries(paymentScreenshots);
  const withUrl = parsed.filter((p) => p.url);

  if (withUrl.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-3 py-3 text-sm text-amber-950">
        <p className="font-semibold">暂无付款截图</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">
          顾客上传打款凭证后，请在此对照<strong>凭证金额 / 时间与订单应付金额、下单时间</strong>，
          并可结合下方商品明细一并核对；确认无误后再点「确认收款」。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        以下为顾客上传的凭证（后续可在此接入三色标记、MD5 等辅助提示）。
      </p>
      {withUrl.map((shot, i) => (
        <div
          key={i}
          className={`overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm ${flagBorder(shot.flag)} border-l-4`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <span>凭证 {i + 1}</span>
            {shot.uploadedAt ? (
              <span className="text-gray-500">
                上传：
                {typeof shot.uploadedAt.toDate === 'function'
                  ? shot.uploadedAt.toDate().toLocaleString()
                  : ''}
              </span>
            ) : null}
            {flagLabel(shot.flag) ? (
              <span className="font-medium">{flagLabel(shot.flag)}</span>
            ) : null}
          </div>
          {shot.flagReason ? (
            <p className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              {shot.flagReason}
            </p>
          ) : null}
          <div className="bg-black/[0.03]">
            <img
              src={shot.url!}
              alt={`付款凭证 ${i + 1}`}
              className="max-h-72 w-full object-contain"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
