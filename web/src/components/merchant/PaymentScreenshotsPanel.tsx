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
};

/** 商户核对付款凭证（大图 + 可选三色标记；可按 appendBatchId 分区） */
export function PaymentScreenshotsPanel({
  paymentScreenshots,
  appendBatchIdFilter,
  matchAnyAppendBatchIds,
  includeUntagged,
  untaggedNotBeforeMillis,
  emptyHint,
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

  if (withUrl.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-3 py-3 text-sm text-amber-950">
        <p className="font-semibold">暂无对应付款截图</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">
          {emptyHint ??
            '顾客上传打款凭证后，请在此对照金额与时间；确认无误后再确认收款。'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        以下为该分区内的凭证（可与下方明细金额、时间对照）。
      </p>
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
