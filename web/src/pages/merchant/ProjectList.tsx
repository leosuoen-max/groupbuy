import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  canDeleteProject,
  copyProjectFromCustomerLinkAsDraft,
  createDraftProject,
  deleteProjectIfAllowed,
  listProjectsByShopId,
  updateProjectDoc,
  type ProjectRow,
} from '../../lib/projectService';
import { getShopBySlug, type ShopRow } from '../../lib/shopService';
import { getProjectSharePageUrl } from '../../lib/shareLink';
import {
  getFeituanProjectPublishBlocker,
  submitProjectToFeituan,
} from '../../lib/feituanService';

function statusLabel(s: ProjectRow['data']['status']) {
  if (s === 'draft') return '草稿';
  if (s === 'published') return '已发布';
  return '已截止';
}

function feituanStatusLabel(s: ProjectRow['data']['feituanStatus']): string | null {
  if (s === 'pending') return '饭团待审';
  if (s === 'listed') return '饭团已上架';
  if (s === 'rejected') return '饭团已驳回';
  if (s === 'delisted') return '饭团已下架';
  return null;
}

function canSubmitToFeituan(s: ProjectRow['data']['feituanStatus']): boolean {
  return !s || s === 'rejected' || s === 'delisted';
}

function isProjectPublished(p: ProjectRow): boolean {
  return p.data.status === 'published';
}

/** 已发布 / 已截止项目展示首次发布时间（Firestore publishedAt） */
function formatPublishedAtLine(p: ProjectRow): string | null {
  if (p.data.status === 'draft') return null;
  const ts = p.data.publishedAt;
  if (!ts?.toDate) return null;
  const d = ts.toDate();
  return `发布于 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function customerShopHomeUrl(_slug: string, projectId: string): string {
  return getProjectSharePageUrl(projectId);
}

export default function ProjectList() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const { user, loading: authLoading } = useAuthUser();
  const navigate = useNavigate();
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopRow, setShopRow] = useState<ShopRow | null>(null);
  const [shopName, setShopName] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);
  const [copyLinkInput, setCopyLinkInput] = useState('');
  const [copyingFromLink, setCopyingFromLink] = useState(false);

  const slug = decodeURIComponent(shopSlug);
  const dashboardBase = `/dashboard/${encodeURIComponent(slug)}`;

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setShopId(null);
        setShopRow(null);
        setProjects([]);
        setErr('未找到该商户链接');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setShopId(null);
        setShopRow(null);
        setProjects([]);
        setErr('无权限访问该店铺');
        return;
      }
      setShopId(shop.id);
      setShopRow(shop);
      setShopName(shop.data.name);
      setProjects(await listProjectsByShopId(shop.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [slug, user]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!authLoading && user) {
        void refresh();
      } else if (!authLoading && !user) {
        setLoading(false);
      }
    });
  }, [authLoading, user, refresh]);

  const handleNew = async () => {
    if (!shopId) return;
    setCreating(true);
    setErr(null);
    try {
      const id = await createDraftProject(shopId);
      navigate(`${dashboardBase}/projects/${encodeURIComponent(id)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const togglePublish = async (p: ProjectRow) => {
    if (!p?.id) return;
    if (busyId) return;
    const title = p.data.title?.trim() || '未命名项目';
    const cur = p.data.status;

    // ON：published；OFF：closed（“撤回”以“已截止”提示页呈现）
    const nextOn = cur !== 'published';

    if (nextOn) {
      const ok = window.confirm(
        cur === 'draft'
          ? `确定发布该草稿项目吗？\n\n${title}\n\n发布后顾客可打开链接下单。`
          : `确定重新发布该项目吗？\n\n${title}\n\n重新发布后顾客可再次下单。`
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        `确定撤回该项目吗？\n\n${title}\n\n撤回后顾客打开链接将看到“已截止”，无法下单。`
      );
      if (!ok) return;
    }

    setBusyId(p.id);
    setErr(null);
    try {
      if (nextOn) {
        await updateProjectDoc(p.id, {
          status: 'published',
          publishedAt: p.data.publishedAt ?? Timestamp.now(),
        });
      } else {
        await updateProjectDoc(p.id, { status: 'closed' });
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const switchLabel = useMemo(() => {
    return '发布';
  }, []);

  const handleCopyProjectFromLink = async () => {
    if (!shopId) return;
    setCopyingFromLink(true);
    setErr(null);
    try {
      const { newProjectId } = await copyProjectFromCustomerLinkAsDraft({
        linkOrPath: copyLinkInput,
        targetShopId: shopId,
      });
      setCopyLinkInput('');
      await refresh();
      navigate(`${dashboardBase}/projects/${encodeURIComponent(newProjectId)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '拷贝失败');
    } finally {
      setCopyingFromLink(false);
    }
  };

  const handleCopyCustomerLink = async (p: ProjectRow) => {
    const url = customerShopHomeUrl(slug, p.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedProjectId(p.id);
      window.setTimeout(() => setCopiedProjectId((cur) => (cur === p.id ? null : cur)), 2000);
    } catch {
      window.prompt('复制顾客进店链接：', url);
    }
  };

  const handleDeleteProject = async (p: ProjectRow) => {
    if (busyId) return;
    const title = p.data.title?.trim() || '未命名项目';
    setBusyId(p.id);
    setErr(null);
    try {
      const check = await canDeleteProject(p.id);
      if (!check.allowed) {
        setErr(check.reason ?? '当前项目不可删除');
        return;
      }
      const ok = window.confirm(
        `确定删除项目：${title}？\n\n删除后不可恢复。`
      );
      if (!ok) return;
      await deleteProjectIfAllowed(p.id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitToFeituan = async (p: ProjectRow) => {
    if (!user || busyId) return;
    const title = p.data.title?.trim() || '未命名项目';
    const ok = window.confirm(
      `确定发布到「大马饭团」审批队列吗？\n\n${title}\n\n提交后需饭团管理员审核，通过后将只允许从饭团入口参团。`
    );
    if (!ok) return;
    setBusyId(p.id);
    setErr(null);
    try {
      await submitProjectToFeituan(p.id, user.uid);
      setProjects((prev) =>
        prev.map((row) =>
          row.id === p.id
            ? {
                ...row,
                data: {
                  ...row.data,
                  feituanStatus: 'pending',
                  feituanSubmittedAt: Timestamp.now(),
                  feituanReviewedAt: null,
                  feituanReviewedBy: '',
                  feituanRejectReason: '',
                },
              }
            : row
        )
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提交饭团失败');
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading || (user && loading)) {
    return (
      <PageShell title="项目列表" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="项目列表" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  if (err && !shopId) {
    return (
      <PageShell title="项目列表" subtitle="错误">
        <p className="text-sm text-red-600">{err}</p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="项目列表" subtitle={shopName}>
      {err ? <p className="mb-2 text-sm text-amber-800">{err}</p> : null}
      <section className="mb-4 rounded-xl border border-orange-100 bg-orange-50/60 p-3 text-xs leading-relaxed text-orange-950">
        {shopRow?.data.feituanEnabled ? (
          <p>
            本店已开通「大马饭团」。项目可提交到饭团审批，上架后店端只读，顾客仅使用饭团链接参团。
          </p>
        ) : (
          <p>
            想发布到「大马饭团」？请联系饭团管理员开通合作（电话 / 微信 / WhatsApp）。
          </p>
        )}
      </section>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
          disabled={creating || !shopId}
          onClick={() => void handleNew()}
        >
          {creating ? '创建中…' : '+ 新建项目（草稿）'}
        </button>
        <Link
          to={dashboardBase}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          返回 Dashboard
        </Link>
      </div>

      <section className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">从链接拷贝为草稿</h2>
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          粘贴任意<strong>顾客进店链接</strong>（本店或他店均可）。会在<strong>当前店铺</strong>下新建一条草稿，并带入文案、图片、商品与套餐等；若来源是<strong>他店</strong>，配送点与次卡抵扣需在本店重新配置。
        </p>
        <textarea
          value={copyLinkInput}
          onChange={(e) => setCopyLinkInput(e.target.value)}
          rows={3}
          disabled={copyingFromLink || !shopId}
          placeholder="例如：https://你的域名/shop/店铺slug/项目ID"
          className="mb-2 w-full resize-y rounded-lg border border-gray-200 bg-white p-2 font-mono text-[12px] text-gray-800 outline-none focus:border-indigo-300"
        />
        <button
          type="button"
          disabled={copyingFromLink || !shopId || !copyLinkInput.trim()}
          onClick={() => void handleCopyProjectFromLink()}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
        >
          {copyingFromLink ? '拷贝中…' : '拷贝为草稿并打开编辑'}
        </button>
      </section>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-600">还没有项目，点上方新建。</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => {
            const publishedLine = formatPublishedAtLine(p);
            const feituanLabel = feituanStatusLabel(p.data.feituanStatus);
            const feituanListed = p.data.feituanStatus === 'listed';
            const showFeituanSubmit =
              shopRow?.data.feituanEnabled && canSubmitToFeituan(p.data.feituanStatus);
            const feituanSubmitBlocker = showFeituanSubmit
              ? getFeituanProjectPublishBlocker(p.data)
              : null;
            return (
            <li key={p.id}>
              <div className="rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm shadow-sm">
                {/* 窄屏勿与标题同一行，避免操作区被挤出视口 */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link to={`${dashboardBase}/projects/${encodeURIComponent(p.id)}`}>
                        <span className="block break-words font-medium leading-snug text-gray-900">
                          {p.data.title || '未命名'}
                        </span>
                      </Link>
                      {publishedLine ? (
                        <p className="mt-1 text-[11px] leading-snug text-gray-500">
                          {publishedLine}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {statusLabel(p.data.status)}
                    </span>
                    {feituanLabel ? (
                      <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900">
                        {feituanLabel}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {showFeituanSubmit ? (
                      <button
                        type="button"
                        className="rounded-lg border border-orange-300 bg-orange-50 px-2 py-1 text-xs font-medium text-orange-900 disabled:opacity-50"
                        disabled={busyId === p.id || Boolean(feituanSubmitBlocker)}
                        onClick={() => void handleSubmitToFeituan(p)}
                      >
                        发布到饭团
                      </button>
                    ) : null}
                    {feituanSubmitBlocker ? (
                      <span className="text-[11px] text-amber-700">
                        需先处理：{feituanSubmitBlocker}
                      </span>
                    ) : null}
                    {isProjectPublished(p) ? (
                      <button
                        type="button"
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900"
                        onClick={() => void handleCopyCustomerLink(p)}
                      >
                        {copiedProjectId === p.id ? '已复制' : '复制链接'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 disabled:opacity-50"
                      disabled={busyId === p.id || feituanListed}
                      onClick={() => void handleDeleteProject(p)}
                    >
                      删除
                    </button>
                    <label
                      className={`relative ml-auto inline-flex shrink-0 items-center ${
                        busyId === p.id ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                      }`}
                      title="发布/撤回"
                      aria-label={switchLabel}
                    >
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        disabled={busyId === p.id || feituanListed}
                        checked={isProjectPublished(p)}
                        onChange={() => {
                          if (feituanListed) {
                            setErr('饭团已上架项目由饭团管理员管理，店端不可发布/撤回。');
                            return;
                          }
                          void togglePublish(p);
                        }}
                      />
                      <div className="h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-emerald-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300"></div>
                      <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"></div>
                    </label>
                  </div>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
