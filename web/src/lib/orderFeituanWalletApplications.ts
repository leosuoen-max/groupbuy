import type { OrderDoc, OrderFeituanWalletPaymentDoc } from '../types/firestore';

export function listOrderFeituanWalletPaymentApplications(
  order: OrderDoc
): OrderFeituanWalletPaymentDoc[] {
  return order.feituanWalletPaymentApplications ?? [];
}

export function feituanWalletApplicationsForPaymentGroup(
  order: OrderDoc,
  group: {
    includesInitial: boolean;
    appendBatchIds: string[];
    hasCardAuto: boolean;
  }
): OrderFeituanWalletPaymentDoc[] {
  const apps = listOrderFeituanWalletPaymentApplications(order);
  return apps.filter((app) => {
    const scope = app.paymentGroupScope;
    const batchHit = (scope.confirmedAppendBatchIds ?? []).some((id) =>
      (group.appendBatchIds ?? []).includes(id)
    );
    const initialHit =
      Boolean(scope.includesInitialSegment) && group.includesInitial;
    return batchHit || initialHit;
  });
}
