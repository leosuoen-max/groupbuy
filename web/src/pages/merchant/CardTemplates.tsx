import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { getShopBySlug } from '../../lib/shopService';
import {
  cardTemplateHasIssued,
  createCardTemplate,
  deleteCardTemplate,
  listCardTemplatesByShop,
  setCardTemplateActive,
  updateCardTemplate,
  type CardTemplateRow,
} from '../../lib/cardService';
import type {
  CardTemplateDoc,
  CardTopupRule,
  CardType,
} from '../../types/firestore';

type EditingDraft = {
  id: string | null;
  name: string;
  type: CardType;
  faceValueOrUses: number;
  salePrice: number;
  validityDays: number;
  description: string;
  topupRules: CardTopupRule[];
  isActive: boolean;
};

const blankDraft = (): EditingDraft => ({
  id: null,
  name: '钱包',
  type: 'stored',
  faceValueOrUses: 0,
  salePrice: 0,
  validityDays: 0,
  description: '',
  topupRules: [],
  isActive: true,
});

function fromDoc(row: CardTemplateRow): EditingDraft {
  return {
    id: row.id,
    name: row.data.type === 'stored' ? '钱包' : (row.data.name ?? ''),
    type: row.data.type,
    faceValueOrUses: Number(row.data.faceValueOrUses ?? 0) || 0,
    salePrice: Number(row.data.salePrice ?? 0) || 0,
    validityDays: Number(row.data.validityDays ?? 0) || 0,
    description: row.data.description ?? '',
    topupRules: Array.isArray(row.data.topupRules)
      ? row.data.topupRules.map((r) => ({
          pay: Number(r.pay ?? 0) || 0,
          gain: Number(r.gain ?? 0) || 0,
        }))
      : [],
    isActive: row.data.isActive !== false,
  };
}

const inputCls =
  'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

export default function CardTemplates() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const [shopId, setShopId] = useState<string | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CardTemplateRow[]>([]);
  const [issuedMap, setIssuedMap] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<EditingDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const list = await listCardTemplatesByShop(sid, { includeInactive: true });
      setRows(list);
      const issued: Record<string, boolean> = {};
      await Promise.all(
        list.map(async (r) => {
          issued[r.id] = await cardTemplateHasIssued(r.id);
        })
      );
      setIssuedMap(issued);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (authLoading) return;
      if (!user) {
        setBootErr('未登录');
        setLoading(false);
        return;
      }
      try {
        const row = await getShopBySlug(slug);
        if (!row) throw new Error('店铺不存在');
        if (row.data.ownerId !== user.uid) throw new Error('无权限');
        if (cancelled) return;
        setShopId(row.id);
        await refresh(row.id);
      } catch (e) {
        if (!cancelled) {
          setBootErr(e instanceof Error ? e.message : '加载失败');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug, refresh]);

  const ownerId = user?.uid ?? null;

  const handleSave = async () => {
    if (!draft || !shopId || !ownerId) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        name: draft.name,
        type: draft.type,
        faceValueOrUses: Number(draft.faceValueOrUses) || 0,
        salePrice: Number(draft.salePrice) || 0,
        validityDays: Number(draft.validityDays) || 0,
        description: draft.description?.trim() || '',
        topupRules: draft.topupRules,
        isActive: draft.isActive,
      };
      if (draft.id) {
        await updateCardTemplate(draft.id, payload);
        setMsg('已保存修改');
      } else {
        await createCardTemplate(shopId, ownerId, payload);
        setMsg('已新建优惠卡');
      }
      setDraft(null);
      await refresh(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: CardTemplateRow) => {
    if (!shopId) return;
    if (!confirm(`确认删除「${row.data.name}」？此操作不可撤销。`)) return;
    try {
      await deleteCardTemplate(row.id);
      setMsg('已删除');
      await refresh(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleToggleActive = async (row: CardTemplateRow) => {
    if (!shopId) return;
    try {
      await setCardTemplateActive(row.id, row.data.isActive === false);
      await refresh(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '切换失败');
    }
  };

  const back = useMemo(
    () => `/dashboard/${encodeURIComponent(slug)}`,
    [slug]
  );

  if (authLoading || loading) {
    return (
      <PageShell title="优惠卡管理" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (bootErr) {
    return (
      <PageShell title="优惠卡管理" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr}</p>
        <Link className="mt-3 inline-block text-indigo-600" to="/dashboard">
          返回
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="优惠卡管理" subtitle={`/${slug} · 钱包 / 次卡`}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <Link to={back} className="text-sm text-indigo-600 underline-offset-2 hover:underline">
          ← 返回店铺后台
        </Link>
        <button
          type="button"
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
          onClick={() => setDraft(blankDraft())}
        >
          + 新增卡
        </button>
      </div>

      {rows.length === 0 && !draft ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500">
          还没有优惠卡。点击右上方「+ 新增卡」开始配置。
        </p>
      ) : null}

      <div className="space-y-3">
        {rows.map((row) => (
          <CardRow
            key={row.id}
            row={row}
            issued={!!issuedMap[row.id]}
            onOpen={() =>
              navigate(
                `/dashboard/${encodeURIComponent(slug)}/cards/${encodeURIComponent(row.id)}`
              )
            }
            onEdit={() => setDraft(fromDoc(row))}
            onDelete={() => void handleDelete(row)}
            onToggleActive={() => void handleToggleActive(row)}
          />
        ))}
      </div>

      {draft ? (
        <CardEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void handleSave()}
          saving={saving}
        />
      ) : null}
    </PageShell>
  );
}

type CardRowProps = {
  row: CardTemplateRow;
  issued: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
};

function CardRow({ row, issued, onOpen, onEdit, onDelete, onToggleActive }: CardRowProps) {
  const d = row.data as CardTemplateDoc;
  const typeLabel = d.type === 'stored' ? '钱包' : '次卡';
  const valueLabel =
    d.type === 'stored'
      ? `面值 RM ${Number(d.faceValueOrUses ?? 0).toFixed(2)}`
      : `${Number(d.faceValueOrUses ?? 0)} 次`;
  const validityLabel =
    Number(d.validityDays ?? 0) > 0 ? `${d.validityDays} 天有效` : '永久有效';
  const isActive = d.isActive !== false;

  return (
    <div
      className={`rounded-xl border p-3 ${
        isActive ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold text-gray-900">
              {d.name || '未命名卡'}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                d.type === 'stored'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'bg-purple-50 text-purple-700'
              }`}
            >
              {typeLabel}
            </span>
            {!isActive ? (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                已下架
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-gray-600">
            {valueLabel} · 售价 RM {Number(d.salePrice ?? 0).toFixed(2)} ·{' '}
            {validityLabel}
          </p>
          {d.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-gray-500">
              {d.description}
            </p>
          ) : null}
          {Array.isArray(d.topupRules) && d.topupRules.length > 0 ? (
            <p className="mt-1 text-[11px] text-gray-500">
              充值档位：
              {d.topupRules
                .map(
                  (r) =>
                    `付 RM ${Number(r.pay).toFixed(2)} 得 ${
                      d.type === 'stored'
                        ? `面值 RM ${Number(r.gain).toFixed(2)}`
                        : `${Number(r.gain)} 次`
                    }`
                )
                .join('；')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
            onClick={onOpen}
          >
            详情
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
            onClick={onEdit}
          >
            编辑
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
            onClick={onToggleActive}
          >
            {isActive ? '下架' : '上架'}
          </button>
          {!issued ? (
            <button
              type="button"
              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
              onClick={onDelete}
            >
              删除
            </button>
          ) : (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
              已售出 · 不可删
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type CardEditorProps = {
  draft: EditingDraft;
  onChange: (next: EditingDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
};

function CardEditor({ draft, onChange, onCancel, onSave, saving }: CardEditorProps) {
  const set = (patch: Partial<EditingDraft>) => onChange({ ...draft, ...patch });
  const isStored = draft.type === 'stored';
  const valueLabel = isStored ? '面值 (RM)' : '使用次数';

  const addRule = () =>
    set({ topupRules: [...draft.topupRules, { pay: 0, gain: 0 }] });
  const updateRule = (i: number, patch: Partial<CardTopupRule>) => {
    const next = draft.topupRules.slice();
    next[i] = { ...next[i]!, ...patch };
    set({ topupRules: next });
  };
  const removeRule = (i: number) => {
    const next = draft.topupRules.slice();
    next.splice(i, 1);
    set({ topupRules: next });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {draft.id ? '编辑优惠卡' : '新增优惠卡'}
          </h2>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-gray-500"
            onClick={onCancel}
          >
            关闭
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-sm text-gray-800">类型</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  set({ type: 'stored', validityDays: 0, name: '钱包' })
                }
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  draft.type === 'stored'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                钱包（按金额抵扣）
              </button>
              <button
                type="button"
                onClick={() =>
                  set({
                    type: 'pass',
                    name: draft.name === '钱包' ? '' : draft.name,
                  })
                }
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  draft.type === 'pass'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                次卡（按次数抵扣）
              </button>
            </div>
          </div>

          {draft.type === 'pass' ? (
            <label className="block text-sm text-gray-800">
              卡名称 <span className="text-xs text-gray-500">（必填）</span>
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="例如：午餐次卡"
              />
            </label>
          ) : (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">
              钱包名称固定为「钱包」，全店仅一种钱包。
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-gray-800">
              {valueLabel}
              <input
                className={inputCls}
                type="number"
                min={0}
                step={isStored ? '0.01' : '1'}
                value={draft.faceValueOrUses || ''}
                onChange={(e) =>
                  set({ faceValueOrUses: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="block text-sm text-gray-800">
              售价 (RM)
              <input
                className={inputCls}
                type="number"
                min={0}
                step="0.01"
                value={draft.salePrice || ''}
                onChange={(e) =>
                  set({ salePrice: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>

          <label className="block text-sm text-gray-800">
            有效期（天）·{' '}
            <span className="text-xs text-gray-500">
              {draft.type === 'stored'
                ? '钱包推荐永久有效（留 0）'
                : '0 = 永久有效'}
            </span>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="1"
              value={draft.validityDays || ''}
              onChange={(e) =>
                set({ validityDays: Number(e.target.value) || 0 })
              }
            />
          </label>

          <label className="block text-sm text-gray-800">
            备注 / 描述（可选）
            <textarea
              className={`${inputCls} min-h-[3.5rem]`}
              placeholder="例如：仅限自取使用 / 不可与折扣同享"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">
                充值档位（可选）
              </span>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600"
                onClick={addRule}
              >
                + 添加档位
              </button>
            </div>
            {draft.topupRules.length === 0 ? (
              <p className="text-xs text-gray-500">
                未配置充值档位时，仍可按"售价"购买首张，但顾客无法在前端续费。
              </p>
            ) : (
              <div className="space-y-2">
                {draft.topupRules.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-gray-700"
                  >
                    <span>付</span>
                    <input
                      className="w-24 rounded-md border border-gray-200 px-2 py-1"
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.pay || ''}
                      onChange={(e) =>
                        updateRule(i, { pay: Number(e.target.value) || 0 })
                      }
                    />
                    <span>RM 得</span>
                    <input
                      className="w-24 rounded-md border border-gray-200 px-2 py-1"
                      type="number"
                      min={0}
                      step={isStored ? '0.01' : '1'}
                      value={r.gain || ''}
                      onChange={(e) =>
                        updateRule(i, { gain: Number(e.target.value) || 0 })
                      }
                    />
                    <span>{isStored ? 'RM 面值' : '次'}</span>
                    <button
                      type="button"
                      className="ml-auto rounded-md border border-red-200 px-2 py-0.5 text-red-700"
                      onClick={() => removeRule(i)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
            />
            上架（顾客可购买）
          </label>

          {!isStored ? (
            <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-800">
              本张卡可抵扣的"产品 / 套餐方案"将在第二阶段：在产品上架页选择「可使用此次卡」。当前仅完成卡的基础配置。
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700"
              onClick={onCancel}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
