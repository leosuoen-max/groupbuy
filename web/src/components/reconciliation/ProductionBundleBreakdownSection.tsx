import type { ProductionBundleToolBreakdown } from '../../lib/reconciliationSummary';

type Props = {
  breakdowns: ProductionBundleToolBreakdown[];
  /** 「全部项目」等跨项目筛选时展示每条记录所属项目 */
  multiProjectScope: boolean;
};

export function ProductionBundleBreakdownSection({
  breakdowns,
  multiProjectScope,
}: Props) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          套餐拆解（{breakdowns.length} 个套餐工具）
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">
          按套餐工具分组；下方列出拆解品项与生产份数（同一工具内多方案数值已合并）。
        </p>
      </div>
      {breakdowns.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">暂无套餐拆解项。</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {breakdowns.map((g) => (
            <div key={g.key}>
              <div className="bg-violet-50/80 px-4 py-2.5">
                <div className="text-sm font-semibold text-violet-950">
                  {g.bundleToolName}
                </div>
                {multiProjectScope &&
                g.projectTitle &&
                g.projectTitle !== '—' ? (
                  <div className="mt-0.5 text-xs font-medium text-violet-900/85">
                    项目：{g.projectTitle}
                  </div>
                ) : null}
                <div className="mt-1 text-xs text-violet-800/85">
                  拆解 {g.optionItems.length} 项 · 份数合计{' '}
                  {g.sectionOptionTotalQty}
                </div>
              </div>
              {g.optionItems.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">无拆解细项。</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {g.optionItems.map((row) => (
                    <li
                      key={`${g.key}::${row.name}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 break-words text-sm text-gray-800">
                        {row.name}
                      </span>
                      <span className="shrink-0 text-base font-semibold tabular-nums text-gray-900">
                        × {row.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
