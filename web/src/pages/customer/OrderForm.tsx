import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import {
  OTHER_DELIVERY_ID,
  getMockDeliveryPoints,
} from '../../data/mockDeliveryPoints';
import { formatMYR } from '../../lib/formatMYR';
import { saveMockOrder } from '../../lib/mockOrderStorage';
import type { CartLocationState, OrderLine, StoredMockOrder } from '../../types/orderDraft';

type Step = 1 | 2 | 3;

function nextOrderNumber(): string {
  return `L${Math.floor(100 + Math.random() * 899)}`;
}

export default function OrderForm() {
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state ?? {}) as CartLocationState;
  const lines = (incoming.lines ?? []).filter(Boolean);
  const projectTitle = incoming.projectTitle ?? '当前项目';

  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [deliveryId, setDeliveryId] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const points = useMemo(() => getMockDeliveryPoints(), []);

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    [lines]
  );

  const deliveryLabel = useMemo(() => {
    if (!deliveryId) return '';
    if (deliveryId === OTHER_DELIVERY_ID) return '以上都不对（其他）';
    return points.find((p) => p.id === deliveryId)?.name ?? '';
  }, [deliveryId, points]);

  const canGoStep2 =
    name.trim().length > 0 &&
    phone.trim().length > 0 &&
    address.trim().length > 0;

  const canGoStep3 = deliveryId.length > 0;

  const handleSubmit = () => {
    setSubmitError(null);
    if (!canGoStep3) return;
    const orderNumber = nextOrderNumber();
    const isManualMatch = deliveryId === OTHER_DELIVERY_ID;
    const order: StoredMockOrder = {
      orderNumber,
      projectId,
      shopSlug,
      projectTitle,
      createdAt: new Date().toISOString(),
      status: 'unpaid',
      lines,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      customerAddress: address.trim(),
      customerNote: note.trim() || undefined,
      deliveryPointId: isManualMatch ? '' : deliveryId,
      deliveryPointLabel: isManualMatch
        ? `其他（将按地址手动匹配）：${address.trim()}`
        : deliveryLabel,
      isManualMatch,
      totalAmount,
    };
    try {
      saveMockOrder(order);
    } catch {
      setSubmitError('保存失败，请检查浏览器是否禁用 sessionStorage。');
      return;
    }
    navigate(`${base}/orders/${encodeURIComponent(orderNumber)}`, {
      replace: true,
    });
  };

  if (lines.length === 0) {
    return (
      <PageShell title="填写订单" subtitle="尚未选择菜品">
        <div className="space-y-3 text-sm text-gray-600">
          <p>还没有从首页带过来的选菜记录。</p>
          <Link
            className="text-indigo-600 underline-offset-2 hover:underline"
            to={base}
          >
            返回项目首页选菜
          </Link>
        </div>
      </PageShell>
    );
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[16px] text-gray-900 outline-none ring-emerald-500/30 focus:border-emerald-500 focus:ring-2';

  return (
    <PageShell
      title="填写订单"
      subtitle={`步骤 ${step} / 3 · ${projectTitle}`}
    >
      <div className="mb-4 flex gap-2 text-xs text-gray-500">
        <span className={step >= 1 ? 'font-semibold text-gray-900' : ''}>
          ① 信息
        </span>
        <span>→</span>
        <span className={step >= 2 ? 'font-semibold text-gray-900' : ''}>
          ② 配送点
        </span>
        <span>→</span>
        <span className={step >= 3 ? 'font-semibold text-gray-900' : ''}>
          ③ 确认
        </span>
      </div>

      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <div className="mb-1 font-medium text-gray-900">已选菜品</div>
        <ul className="space-y-1">
          {lines.map((l: OrderLine) => (
            <li key={l.productId} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {l.name} ×{l.quantity}
                {l.isDiscount ? (
                  <span className="ml-1 text-xs text-amber-700">早鸟</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMYR(l.unitPrice * l.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900">
          <span>合计</span>
          <span>{formatMYR(totalAmount)}</span>
        </div>
      </div>

      {step === 1 ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">填写信息</h2>
          <label className="block text-sm text-gray-700">
            姓名 <span className="text-red-600">*</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="例如：李美玲"
            />
          </label>
          <label className="block text-sm text-gray-700">
            电话 <span className="text-red-600">*</span>
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="例如：6012-3456789"
            />
          </label>
          <label className="block text-sm text-gray-700">
            地址 <span className="text-red-600">*</span>
            <input
              className={inputCls}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
              placeholder="楼栋门牌等"
            />
          </label>
          <label className="block text-sm text-gray-700">
            备注 <span className="text-gray-400">（选填）</span>
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="口味、忌口等"
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              to={base}
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
            >
              返回选菜
            </Link>
            <button
              type="button"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-gray-300"
              disabled={!canGoStep2}
              onClick={() => setStep(2)}
            >
              下一步：配送点
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">选择配送点</h2>
          <p className="text-sm text-gray-600">请选择本次取餐/送达位置。</p>
          <div className="space-y-2">
            {points.map((p) => (
              <div key={p.id} className="rounded-xl border border-gray-100 p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="delivery"
                    className="mt-1 h-4 w-4"
                    checked={deliveryId === p.id}
                    onChange={() => setDeliveryId(p.id)}
                  />
                  <span className="min-w-0 flex-1 text-sm text-gray-900">
                    {p.name}
                  </span>
                </label>
                <div className="mt-2 pl-7">
                  <button
                    type="button"
                    className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                    onClick={() =>
                      setExpandedId((id) => (id === p.id ? null : p.id))
                    }
                  >
                    {expandedId === p.id ? '收起详情' : '查看详情'}
                  </button>
                  {expandedId === p.id ? (
                    <div className="mt-2 space-y-1 text-xs text-gray-600">
                      {p.detailAddress ? <p>地址：{p.detailAddress}</p> : null}
                      {p.deliveryTime ? <p>时间：{p.deliveryTime}</p> : null}
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="mt-1 max-h-32 w-full rounded-lg object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              <input
                type="radio"
                name="delivery"
                className="mt-1 h-4 w-4"
                checked={deliveryId === OTHER_DELIVERY_ID}
                onChange={() => setDeliveryId(OTHER_DELIVERY_ID)}
              />
              <span className="min-w-0 flex-1 text-sm text-gray-900">
                以上都不对（其他）
                <span className="mt-1 block text-xs text-amber-900">
                  将使用你填写的地址，由商户手动匹配配送点。
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
              onClick={() => setStep(1)}
            >
              上一步
            </button>
            <button
              type="button"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-gray-300"
              disabled={!canGoStep3}
              onClick={() => setStep(3)}
            >
              下一步：确认
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">确认并提交</h2>
          <div className="rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm text-gray-800">
            <div className="font-medium text-gray-900">顾客信息</div>
            <p className="mt-1">姓名：{name.trim()}</p>
            <p>电话：{phone.trim()}</p>
            <p>地址：{address.trim()}</p>
            {note.trim() ? <p>备注：{note.trim()}</p> : <p>备注：（无）</p>}
            <div className="mt-3 font-medium text-gray-900">配送</div>
            <p className="mt-1">{deliveryLabel}</p>
          </div>
          <p className="text-xs text-gray-500">
            mock：不校验库存；提交后写入本机 sessionStorage，便于「我的订单」查看。
          </p>
          {submitError ? (
            <p className="text-sm text-red-600">{submitError}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
              onClick={() => setStep(2)}
            >
              上一步
            </button>
            <button
              type="button"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white"
              onClick={handleSubmit}
            >
              提交订单
            </button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
