import type { ReactNode } from 'react';
import {
  parseScreenshotEntries,
  type ParsedScreenshotEntry,
} from '../../lib/paymentScreenshotHelpers';

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

function filterByAppendBatch(
  entries: ParsedScreenshotEntry[],
  appendBatchIdFilter: string | null | undefined,
  matchAnyAppendBatchIds?: string[],
  includeUntagged?: boolean,
  /** 未挂批次的图：仅保留上传时间不早于该毫秒时间戳的（避免首单旧图误入加购区） */
  untaggedNotBeforeMillis?: number
): ParsedScreenshotEntry[] {
  if (matchAnyAppendBatchIds?.length) {
    const set = new Set(matchAnyAppendBatchIds);
    return entries.filter((p) => {
      if (!p.url) return false;
      const bid = p.appendBatchId;
      if (bid && set.has(bid)) return true;
      if (
        includeUntagged &&
        (bid == null || bid === '')
      ) {
        if (
          untaggedNotBeforeMillis != null &&
          untaggedNotBeforeMillis > 0 &&
          untaggedNotBeforeMillis < Number.MAX_SAFE_INTEGER
        ) {
          const ua = p.uploadedAt?.toMillis?.() ?? 0;
          if (ua < untaggedNotBeforeMillis) return false;
        }
        return true;
      }
      return false;
    });
  }
  if (appendBatchIdFilter === undefined) return entries;
  if (appendBatchIdFilter === null) {
    return entries.filter((p) => p.appendBatchId == null || p.appendBatchId === '');
  }
  return entries.filter((p) => p.appendBatchId === appendBatchIdFilter);
}

type Props = {
  paymentScreenshots: unknown;
  /** 不传=全部；null=仅首单/未挂批次的图；string=该加购批次 */
  appendBatchIdFilter?: string | null;
  /** 挂在任一批次 id 上的凭证（合并待确认加购区） */
  matchAnyAppendBatchIds?: string[];
  /** 与 matchAnyAppendBatchIds 联用：同时包含未挂批次截图（须晚于 append 起始时间） */
  includeUntagged?: boolean;
  /** 未挂批次图必须 uploadedAt >= 该毫秒时间（一般为待确认加购最早 appendedAt） */
  untaggedNotBeforeMillis?: number;
  emptyHint?: string;
  emptyAction?: ReactNode;
  /**
   * default：订单支付组语境（分区、加购批次等）。
   * wallet_recharge：饭团钱包单次充值，无加购/批次；加购请走新订单，不在此展示。
   */
  variant?: 'default' | 'wallet_recharge';
};

/** 商户核对付款凭证（大图 + 可选三色标记）。订单侧可按 appendBatchId 分区；钱包充值请传 variant=wallet_recharge。 */
export function PaymentScreenshotsPanel({
  paymentScreenshots,
  appendBatchIdFilter,
  matchAnyAppendBatchIds,
  includeUntagged,
  untaggedNotBeforeMillis,
  emptyHint,
  emptyAction,
  variant = 'default',
}: Props) {
  const parsed = parseScreenshotEntries(paymentScreenshots);
  const filtered = filterByAppendBatch(
    parsed,
    appendBatchIdFilter,
    matchAnyAppendBatchIds,
    includeUntagged,
    untaggedNotBeforeMillis
  );
  const withUrl = filtered.filter((p) => p.url);
  const waivedNoShot = filtered.filter((p) => !p.url && p.waivedNoScreenshot);

  const emptyTitle =
    variant === 'wallet_recharge' ? '暂无付款截图' : '暂无对应付款截图';
  const defaultEmptyHint =
    variant === 'wallet_recharge'
      ? '顾客上传转账截图后即进入「待核实」，请核对金额后再确认入账。'
      : '顾客上传打款凭证后，请在此对照金额与时间；确认无误后再确认收款。';

  if (withUrl.length === 0 && waivedNoShot.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-3 py-3 text-sm text-amber-950">
        <p className="font-semibold">{emptyTitle}</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">
          {emptyHint ?? defaultEmptyHint}
        </p>
        {emptyAction ? <div className="mt-3">{emptyAction}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        {variant === 'wallet_recharge'
          ? '以下为本次充值的付款截图（单笔入账，无加购批次）。'
          : '以下为该分区内的凭证（含无图免提交通道）。'}
      </p>
      {waivedNoShot.map((shot, i) => (
        <div
          key={`${shot.id ?? 'waive'}-waive-${i}`}
          className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/70"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-3 py-2 text-xs text-amber-900">
            <span>🧾 免提交付款凭证</span>
            {shot.uploadedAt ? (
              <span className="text-amber-800">
                时间：
                {typeof shot.uploadedAt.toDate === 'function'
                  ? shot.uploadedAt.toDate().toLocaleString()
                  : ''}
              </span>
            ) : null}
          </div>
          <div className="px-3 py-2 text-xs text-amber-950">
            <p>该组由商户人工标记为“免提交付款凭证”，无顾客上传截图。</p>
            {shot.waivedByUserId ? (
              <p className="mt-1 text-amber-900">操作人：{shot.waivedByUserId.slice(0, 8)}…</p>
            ) : null}
          </div>
        </div>
      ))}
      {withUrl.map((shot, i) => (
        <div
          key={`${shot.id ?? shot.url}-${i}`}
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
