import { useId } from 'react';

export type ProofDatetimeFilterFieldsProps = {
  searchParams: URLSearchParams;
  /** 来自 `useSearchParams()[1]`，仅在使用处传入 URLSearchParams 新版本 */
  setSearchParams: (next: URLSearchParams) => void;
  proofStart: string;
  proofEnd: string;
  startLabel: string;
  endLabel: string;
  hint: string;
};

function patchProofParam(
  searchParams: URLSearchParams,
  setSearchParams: ProofDatetimeFilterFieldsProps['setSearchParams'],
  key: 'proofStart' | 'proofEnd',
  v: string
) {
  const next = new URLSearchParams(searchParams);
  const t = v.trim();
  if (t) next.set(key, v);
  else next.delete(key);
  setSearchParams(next);
}

/**
 * 对账时间筛选：`datetime-local` 在移动端系统选择器里的「还原」往往无法清空，
 * 故在表单区提供显式「清除」以同步删掉 URL 参数。
 */
export function ProofDatetimeFilterFields({
  searchParams,
  setSearchParams,
  proofStart,
  proofEnd,
  startLabel,
  endLabel,
  hint,
}: ProofDatetimeFilterFieldsProps) {
  const startFieldId = useId();
  const endFieldId = useId();

  const clearBtnClass =
    'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-default disabled:text-gray-400 disabled:hover:bg-transparent';

  return (
    <>
      <div className="mt-3 grid max-w-md gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label
              htmlFor={startFieldId}
              className="text-sm font-medium text-gray-800"
            >
              {startLabel}
            </label>
            <button
              type="button"
              disabled={!proofStart.trim()}
              className={clearBtnClass}
              aria-label={`清除${startLabel}`}
              onClick={() =>
                patchProofParam(searchParams, setSearchParams, 'proofStart', '')
              }
            >
              清除
            </button>
          </div>
          <input
            id={startFieldId}
            type="datetime-local"
            className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={proofStart}
            onChange={(e) =>
              patchProofParam(
                searchParams,
                setSearchParams,
                'proofStart',
                e.target.value
              )
            }
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label
              htmlFor={endFieldId}
              className="text-sm font-medium text-gray-800"
            >
              {endLabel}
            </label>
            <button
              type="button"
              disabled={!proofEnd.trim()}
              className={clearBtnClass}
              aria-label={`清除${endLabel}`}
              onClick={() =>
                patchProofParam(searchParams, setSearchParams, 'proofEnd', '')
              }
            >
              清除
            </button>
          </div>
          <input
            id={endFieldId}
            type="datetime-local"
            className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={proofEnd}
            onChange={(e) =>
              patchProofParam(
                searchParams,
                setSearchParams,
                'proofEnd',
                e.target.value
              )
            }
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-600">{hint}</p>
    </>
  );
}
