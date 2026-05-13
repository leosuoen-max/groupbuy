import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  createFeituanDeliverySet,
  deleteFeituanDeliveryPoint,
  deleteFeituanDeliverySet,
  listFeituanDeliverySets,
  updateFeituanDeliverySet,
  upsertFeituanDeliveryPoint,
  type FeituanDeliverySetRow,
} from '../lib/feituanDeliveryService';
import { isFeituanAdmin } from '../lib/feituanService';
import type { FeituanDeliveryPointDoc } from '../types/firestore';

type PointDraft = {
  id?: string;
  code: string;
  shortName: string;
  detailAddress: string;
  mapsUrl: string;
  imageUrl: string;
  isActive: boolean;
};

const emptyPoint: PointDraft = {
  code: '',
  shortName: '',
  detailAddress: '',
  mapsUrl: '',
  imageUrl: '',
  isActive: true,
};

function pointToDraft(point: FeituanDeliveryPointDoc): PointDraft {
  return {
    id: point.id,
    code: point.code ?? '',
    shortName: point.shortName ?? point.name,
    detailAddress: point.detailAddress ?? '',
    mapsUrl: point.mapsUrl ?? '',
    imageUrl: point.imageUrl ?? '',
    isActive: point.isActive !== false,
  };
}

export default function FeituanDelivery() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<FeituanDeliverySetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [setName, setSetName] = useState('');
  const [setDesc, setSetDesc] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pointDrafts, setPointDrafts] = useState<Record<string, PointDraft>>({});

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) {
        setRows([]);
        return;
      }
      setRows(await listFeituanDeliverySets({ includeInactive: true }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  const createSet = async () => {
    if (!user) return;
    setBusy('create-set');
    setMsg(null);
    setErr(null);
    try {
      await createFeituanDeliverySet({
        actorUid: user.uid,
        name: setName,
        description: setDesc,
      });
      setSetName('');
      setSetDesc('');
      setMsg('已新增配送区');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '新增失败');
    } finally {
      setBusy(null);
    }
  };

  const toggleSet = async (row: FeituanDeliverySetRow) => {
    if (!user) return;
    setBusy(`set:${row.id}`);
    setErr(null);
    try {
      await updateFeituanDeliverySet({
        actorUid: user.uid,
        setId: row.id,
        isActive: row.data.isActive === false,
      });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const removeSet = async (row: FeituanDeliverySetRow) => {
    if (!user) return;
    const ok = window.confirm(
      `确定删除配送区「${row.data.name}」？区内配送点也会一并移除。`
    );
    if (!ok) return;
    setBusy(`set:${row.id}`);
    setErr(null);
    try {
      await deleteFeituanDeliverySet({ actorUid: user.uid, setId: row.id });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const savePoint = async (setId: string) => {
    if (!user) return;
    const draft = pointDrafts[setId] ?? emptyPoint;
    setBusy(`point:${setId}`);
    setErr(null);
    try {
      await upsertFeituanDeliveryPoint({
        actorUid: user.uid,
        setId,
        point: draft,
      });
      setPointDrafts((prev) => ({ ...prev, [setId]: { ...emptyPoint } }));
      setMsg('配送点已保存');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存配送点失败');
    } finally {
      setBusy(null);
    }
  };

  const removePoint = async (setId: string, pointId: string) => {
    if (!user) return;
    const ok = window.confirm('确定删除该配送点？');
    if (!ok) return;
    setBusy(`point:${setId}`);
    setErr(null);
    try {
      await deleteFeituanDeliveryPoint({ actorUid: user.uid, setId, pointId });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除配送点失败');
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || loading || allowed == null) {
    return (
      <PageShell title="饭团配送" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="饭团配送" subtitle="无权限">
        <p className="text-sm text-gray-700">当前账号无饭团管理员权限。</p>
      </PageShell>
    );
  }

  const input =
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900';

  return (
    <PageShell title="饭团配送" subtitle="配送区 / 配送点">
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/feituan"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          返回饭团管理
        </Link>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
        >
          刷新
        </button>
      </div>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {msg ? <p className="mb-3 text-sm text-emerald-700">{msg}</p> : null}

      <section className="mb-5 rounded-xl border border-orange-100 bg-orange-50 p-4">
        <h2 className="text-sm font-semibold text-orange-950">新增配送区</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className={input}
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            placeholder="配送区名称，如：KL 市区 A 线"
          />
          <input
            className={input}
            value={setDesc}
            onChange={(e) => setSetDesc(e.target.value)}
            placeholder="说明（可选）"
          />
          <button
            type="button"
            disabled={busy === 'create-set' || !setName.trim()}
            onClick={() => void createSet()}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
          >
            新增
          </button>
        </div>
      </section>

      <div className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-600">暂无配送区。</p>
        ) : (
          rows.map((row) => {
            const draft = pointDrafts[row.id] ?? emptyPoint;
            const pointBusy = busy === `point:${row.id}`;
            return (
              <section
                key={row.id}
                className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {row.data.name}
                    </h2>
                    {row.data.description ? (
                      <p className="mt-1 text-xs text-gray-500">
                        {row.data.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-gray-500">
                      配送点 {row.data.points?.length ?? 0} 个
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy === `set:${row.id}`}
                      onClick={() => void toggleSet(row)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      {row.data.isActive === false ? '启用' : '停用'}
                    </button>
                    <button
                      type="button"
                      disabled={busy === `set:${row.id}`}
                      onClick={() => void removeSet(row)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="mb-3 space-y-2">
                  {(row.data.points ?? []).map((point) => (
                    <div
                      key={point.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-semibold text-gray-900">
                          [{point.code ?? '—'}] {point.shortName ?? point.name}
                        </span>
                        {point.detailAddress ? (
                          <span className="ml-2 text-xs text-gray-500">
                            {point.detailAddress}
                          </span>
                        ) : null}
                        {point.isActive === false ? (
                          <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700">
                            停用
                          </span>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPointDrafts((prev) => ({
                              ...prev,
                              [row.id]: pointToDraft(point),
                            }))
                          }
                          className="text-xs font-medium text-indigo-600"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => void removePoint(row.id, point.id)}
                          className="text-xs font-medium text-red-600"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-gray-700">
                    {draft.id ? '编辑配送点' : '新增配送点'}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      className={input}
                      value={draft.code}
                      onChange={(e) =>
                        setPointDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...draft, code: e.target.value.toUpperCase() },
                        }))
                      }
                      placeholder="编号，如 A1"
                    />
                    <input
                      className={input}
                      value={draft.shortName}
                      onChange={(e) =>
                        setPointDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...draft, shortName: e.target.value },
                        }))
                      }
                      placeholder="简称"
                    />
                    <input
                      className={input}
                      value={draft.detailAddress}
                      onChange={(e) =>
                        setPointDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...draft, detailAddress: e.target.value },
                        }))
                      }
                      placeholder="详细地址（可选）"
                    />
                    <input
                      className={input}
                      value={draft.imageUrl}
                      onChange={(e) =>
                        setPointDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...draft, imageUrl: e.target.value },
                        }))
                      }
                      placeholder="图片 URL（可选）"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(e) =>
                          setPointDrafts((prev) => ({
                            ...prev,
                            [row.id]: { ...draft, isActive: e.target.checked },
                          }))
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      disabled={pointBusy || !draft.shortName.trim()}
                      onClick={() => void savePoint(row.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300"
                    >
                      {pointBusy ? '保存中…' : '保存配送点'}
                    </button>
                    {draft.id ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPointDrafts((prev) => ({
                            ...prev,
                            [row.id]: { ...emptyPoint },
                          }))
                        }
                        className="text-xs font-medium text-gray-600"
                      >
                        取消编辑
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
    </PageShell>
  );
}
