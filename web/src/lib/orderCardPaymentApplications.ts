import type { OrderCardPaymentDoc, OrderDoc } from '../types/firestore';

/** 同一订单内每次钱包/次卡结算一条，按时间顺序；读档兼容旧字段 `cardPayment` */
export function listOrderCardPaymentApplications(
  order: OrderDoc
): OrderCardPaymentDoc[] {
  const apps = order.cardPaymentApplications;
  if (apps && apps.length > 0) return apps;
  if (order.cardPayment) return [order.cardPayment];
  return [];
}

export function orderHasCardPaymentApplications(order: OrderDoc): boolean {
  return listOrderCardPaymentApplications(order).length > 0;
}

/**
 * 将某次卡支付快照对应到 `buildPaymentGroups` 中的一组（凭清偿 scope）。
 * 无 scope 的旧数据：仅当全单仅此一笔卡结算且该组带卡自动确认时归入该组。
 */
export function cardApplicationsForPaymentGroup(
  order: OrderDoc,
  group: {
    includesInitial: boolean;
    appendBatchIds: string[];
    hasCardAuto: boolean;
  }
): OrderCardPaymentDoc[] {
  const apps = listOrderCardPaymentApplications(order);
  return apps.filter((app) =>
    cardApplicationMatchesGroup(app, apps, group)
  );
}

function cardApplicationMatchesGroup(
  app: OrderCardPaymentDoc,
  allApps: OrderCardPaymentDoc[],
  group: {
    includesInitial: boolean;
    appendBatchIds: string[];
    hasCardAuto: boolean;
  }
): boolean {
  const scope = app.cardSettlementScope;
  if (!scope) {
    return (
      allApps.length === 1 &&
      group.hasCardAuto &&
      (group.includesInitial || (group.appendBatchIds?.length ?? 0) > 0)
    );
  }
  const batchHit = (scope.confirmedAppendBatchIds ?? []).some((id) =>
    (group.appendBatchIds ?? []).includes(id)
  );
  const initialHit =
    Boolean(scope.includesInitialSegment) && group.includesInitial;
  return batchHit || initialHit;
}

/** 加购批次是否由某条卡支付记录清偿（新数据用 scope；旧数据无法区分则返回空由调用方兜底） */
export function cardApplicationsForAppendBatch(
  order: OrderDoc,
  batchId: string
): OrderCardPaymentDoc[] {
  return listOrderCardPaymentApplications(order).filter((app) =>
    app.cardSettlementScope?.confirmedAppendBatchIds?.includes(batchId)
  );
}
