import { randomUUID } from 'node:crypto';
import type { HylService, Access } from '../../server/hyl/service.js';
import { AssetService } from '../../server/providers/assets.js';
import { BillingService } from '../../server/billing/service.js';
import { LeaseService } from '../../server/leases/service.js';
import { CashierService } from '../../server/cashier/service.js';
import { ProcurementService } from '../../server/procurement/service.js';
import { FinanceService } from '../../server/finance/service.js';
import { dayOf } from '../../server/cashier/reports.js';
import { contractSchema, actionSchema } from '../../server/hyl/schema.js';
import {
  configSchema,
  billCreateSchema,
  operationSchema,
} from '../../server/billing/model.js';
import { operationSchema as leaseOperation } from '../../server/leases/model.js';
import {
  writeOrderSchema,
  operationSchema as cashierOperation,
  refundSchema,
} from '../../server/cashier/model.js';
import {
  supplierValues,
  requestValues,
  receiptValues,
  requestAction,
  orderAction,
  receiptAction,
  paymentAction,
} from '../../server/procurement/schema.js';
import { querySchema } from '../../server/finance/model.js';
import type { Bill, Receipt } from '../../server/billing/model.js';
import type { Row as Purchase } from '../../server/procurement/model.js';
import { cents } from '../../server/hyl/calculation.js';
/** Explicit local demo, never automatic seed data; each run owns a clearly labelled project. */
export async function runFinanceDemo(hyl: HylService, access: Access) {
  const tag = 'DEMO-FINANCE-' + randomUUID().slice(0, 8),
    date = dayOf(new Date().toISOString()),
    month = date.slice(0, 7),
    start = month + '-01',
    end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10),
    evidence = tag + ' simulated only';
  const assets = new AssetService(hyl),
    billing = new BillingService(hyl),
    leases = new LeaseService(hyl),
    cashier = new CashierService(hyl),
    procurement = new ProcurementService(hyl),
    finance = new FinanceService(hyl),
    c = hyl.db.connection();
  const project = await assets.save(access, {
      name: '财务报表演示项目 ' + tag,
      type: 'project',
      notes: evidence,
    }),
    street = await assets.save(access, {
      name: '演示街区',
      type: 'street',
      parentId: project.id,
    }),
    unit = await assets.save(access, {
      name: '财务演示铺位',
      type: 'unit',
      parentId: street.id,
      area: '50',
      lettableArea: '50',
    });
  const merchant = await hyl.save(access, 'merchants', {
    name: '财务演示商户 ' + tag,
    unit: '演示铺位',
    contact: '本地演示',
    phone: '0',
    accountName: '模拟账户',
    bank: '模拟银行',
    account: '0',
    notes: evidence,
  });
  const contract = await hyl.save(
    access,
    'contracts',
    contractSchema.parse({
      merchantId: merchant.id,
      assetIds: [unit.id],
      title: tag,
      start,
      end,
      cycle: 'month',
      method: 'fixed',
      basis: 'receipts',
      rate: '0',
      fixedFee: '0',
      minimum: '0',
      rent: '1000',
      depositTarget: '500',
      includeActivity: true,
      includeCash: true,
      includeHospitality: false,
    }),
  );
  await billing.saveConfiguration(
    access,
    contract.id,
    configSchema.parse({
      requestId: randomUUID(),
      expectedVersion: 0,
      effectiveFrom: start,
      rentChannel: 'bill',
      property: { enabled: true, method: 'fixed', price: '200' },
      utilities: {},
      meters: [],
    }),
  );
  const query = querySchema.parse({
      projectId: project.id,
      from: start,
      to: date,
    }),
    steps: { stage: string; summary: Record<string, string> }[] = [];
  const snapshot = async (stage: string) => {
    const r = await finance.snapshot(access, query);
    if (r.checks.some((c) => c.differenceCents !== '0'))
      throw Error('Demo reconciliation mismatch at ' + stage);
    steps.push({ stage, summary: r.summary });
    return r;
  };
  const bills: Bill[] = [];
  for (const fee of ['rent', 'property']) {
    let b = await billing.createBill(
      access,
      billCreateSchema.parse({
        requestId: randomUUID(),
        contractId: contract.id,
        expectedContractVersion: contract.version,
        configVersion: 1,
        month,
        part: 'month',
        dueDate: end,
        fees: [fee],
        readings: [],
        others: [],
      }),
    );
    b = await billing.billAction(
      access,
      b.id,
      'issue',
      operationSchema.parse({
        requestId: randomUUID(),
        expectedVersion: b.version,
      }),
    );
    bills.push(b);
  }
  await snapshot('issued');
  await leases.operate(
    access,
    contract.id,
    'receive',
    leaseOperation.parse({
      requestId: randomUUID(),
      expectedVersion: (await leases.summary(access, contract.id)).version,
      amount: '500',
      date,
      reference: tag + '-D',
      evidence,
    }),
  );
  bills[0] = await billing.billAction(
    access,
    bills[0].id,
    'applyDeposit',
    operationSchema.parse({
      requestId: randomUUID(),
      expectedVersion: bills[0].version,
      expectedLeaseVersion: (await leases.summary(access, contract.id)).version,
      amount: '200',
      date,
      reason: evidence,
      evidence,
    }),
  );
  await snapshot('depositDeducted');
  const checkout = async (
    amount: string,
    allocations: string[],
    ref: string,
  ) => {
    const lease = await leases.summary(access, contract.id),
      fresh = await Promise.all(bills.map((b) => billing.findBill(b.id)));
    let order = await cashier.save(
      access,
      writeOrderSchema.parse({
        requestId: randomUUID(),
        merchantId: merchant.id,
        date,
        targets: fresh.map((b, i) => ({
          billId: b.id,
          contractId: contract.id,
          expectedBillVersion: b.version,
          expectedLeaseVersion: lease.version,
          amount: allocations[i],
        })),
        payments: [
          {
            key: randomUUID(),
            method: 'bank',
            amount,
            reference: tag + '-' + ref,
            evidence,
            splits: [{ contractId: contract.id, amount }],
          },
        ],
      }),
    );
    order = await cashier.post(
      access,
      order.id,
      cashierOperation.parse({
        requestId: randomUUID(),
        expectedVersion: order.version,
        reason: evidence,
        evidence,
      }),
    );
    return order;
  };
  const first = await checkout('600', ['500', '100'], 'C1');
  await snapshot('partialCashier');
  const second = await checkout('500', ['300', '100'], 'C2');
  await snapshot('topUpWithAdvance');
  let receipt = (
    await c
      .repository<Receipt>('hylReceipts')
      .findMany({ filter: { contractId: contract.id } })
  ).find((r) => r.payload.originalReference === tag + '-C2')!;
  const refund = async (amount: string, ref: string) => {
    receipt = await billing.findReceipt(receipt.id);
    return cashier.createRefund(
      access,
      refundSchema.parse({
        requestId: randomUUID(),
        date,
        reference: tag + '-' + ref,
        reason: evidence,
        evidence,
        sources: [
          {
            receiptId: receipt.id,
            expectedVersion: receipt.version,
            method: 'bank',
            amount,
            allocations: [],
          },
        ],
      }),
    );
  };
  const returned = await refund('50', 'REF1');
  await snapshot('refund50');
  await cashier.reverseRefund(
    access,
    returned.id,
    cashierOperation.parse({
      requestId: randomUUID(),
      expectedVersion: returned.version,
      reason: evidence,
      evidence,
    }),
  );
  await snapshot('refundReversed');
  await refund('100', 'REF2');
  await snapshot('advanceRefunded');
  await leases.operate(
    access,
    contract.id,
    'refund',
    leaseOperation.parse({
      requestId: randomUUID(),
      expectedVersion: (await leases.summary(access, contract.id)).version,
      amount: '100',
      date,
      reference: tag + '-DR',
      reason: evidence,
      evidence,
    }),
  );
  await snapshot('depositRefunded');
  let revenue = await hyl.save(access, 'revenueReports', {
    merchantId: merchant.id,
    date,
    source: 'bank',
    reference: tag + '-REV',
    receipts: '2000',
    refunds: '0',
    activity: '0',
    cash: '0',
    hospitality: '0',
    collected: '2000',
    evidence,
  });
  revenue = await hyl.act(
    access,
    'revenueReports',
    revenue.id,
    'submit',
    actionSchema.parse({ expectedVersion: revenue.version }),
  );
  await hyl.act(
    access,
    'revenueReports',
    revenue.id,
    'approve',
    actionSchema.parse({ expectedVersion: revenue.version }),
  );
  let settlement = await hyl.generate(access, {
    merchantId: merchant.id,
    contractId: contract.id,
    month,
    part: 'month',
  });
  settlement = await hyl.act(
    access,
    'settlements',
    settlement.id,
    'review',
    actionSchema.parse({ expectedVersion: settlement.version }),
  );
  settlement = await hyl.act(
    access,
    'settlements',
    settlement.id,
    'confirm',
    actionSchema.parse({
      expectedVersion: settlement.version,
      confirmation: 'offline',
      confirmedBy: '本地演示商户',
      evidence,
    }),
  );
  await snapshot('merchantPayable');
  for (const [i, amount] of ['800', '1200'].entries()) {
    settlement = await hyl.act(
      access,
      'settlements',
      settlement.id,
      'pay',
      actionSchema.parse({
        expectedVersion: settlement.version,
        amount,
        date,
        reference: tag + '-SP' + i,
        evidence,
      }),
    );
    await snapshot(i === 0 ? 'merchantPartial' : 'merchantPaid');
  }
  const supplier = await procurement.createSupplier(
    access,
    supplierValues.parse({
      projectId: project.id,
      name: '财务演示供应商',
      contact: '模拟联系人',
      phone: '0',
      supplyScope: '演示物资',
    }),
    randomUUID(),
  );
  let request = await procurement.createRequest(
    access,
    requestValues.parse({
      title: tag + '采购',
      assetId: unit.id,
      neededOn: date,
      reason: evidence,
      items: [{ name: '演示耗材', unit: '件', quantity: 3, unitPrice: '100' }],
    }),
    randomUUID(),
  );
  for (const action of ['submit', 'approve', 'convert'])
    request = await procurement.act(
      access,
      'requests',
      request.id,
      requestAction.parse({
        requestId: randomUUID(),
        expectedVersion: request.version,
        action,
        note: evidence,
        ...(action === 'convert' ? { supplierId: supplier.id } : {}),
      }),
    );
  let purchase = await procurement.row(
    'orders',
    String(request.payload.orderId),
  );
  const orderAct = async (
    action: string,
    values: Record<string, unknown> = {},
  ) => {
    purchase = await procurement.act(
      access,
      'orders',
      purchase.id,
      orderAction.parse({
        requestId: randomUUID(),
        expectedVersion: purchase.version,
        action,
        note: evidence,
        ...values,
      }),
    );
    return purchase;
  };
  await orderAct('issue');
  let acceptance = await procurement.createReceipt(
    access,
    receiptValues.parse({
      orderId: purchase.id,
      day: date,
      evidence,
      lines: [{ itemId: 'item-1', delivered: 3, accepted: 3 }],
    }),
    randomUUID(),
    purchase.version,
  );
  for (const action of ['submit', 'accept'])
    acceptance = await procurement.act(
      access,
      'receipts',
      acceptance.id,
      receiptAction.parse({
        requestId: randomUUID(),
        expectedVersion: acceptance.version,
        action,
        note: evidence,
      }),
    );
  purchase = await procurement.row('orders', purchase.id);
  await snapshot('supplierAccepted');
  await orderAct('pay', {
    amount: '100',
    day: date,
    reference: tag + '-PP1',
    channel: 'bank',
    evidence,
  });
  await snapshot('supplierPartial');
  const payment = await procurement.row(
    'payments',
    String(purchase.payload.lastPaymentId),
  );
  await procurement.act(
    access,
    'payments',
    payment.id,
    paymentAction.parse({
      requestId: randomUUID(),
      expectedVersion: payment.version,
      action: 'reverse',
      day: date,
      note: evidence,
    }),
  );
  purchase = await procurement.row('orders', purchase.id);
  await snapshot('supplierReversal');
  await orderAct('pay', {
    amount: '300',
    day: date,
    reference: tag + '-PP2',
    channel: 'bank',
    evidence,
  });
  await orderAct('settle');
  const report = await snapshot('complete');
  // Independent proof: sum the original persisted money fields, not the reporting/cashier helper.
  const receipts = await c
      .repository<Receipt>('hylReceipts')
      .findMany({ filter: { contractId: contract.id } }),
    entries = await c
      .repository<{ kind: string; amountCents: string; contractId: string }>(
        'hylReceiptEntries',
      )
      .findMany({ filter: { contractId: contract.id } }),
    deposits = await c
      .repository<{ kind: string; amountCents: string; contractId: string }>(
        'hylLeaseEntries',
      )
      .findMany({ filter: { contractId: contract.id } }),
    payments = await c
      .repository<{ payload: Record<string, unknown>; settlementId: string }>(
        'hylPayments',
      )
      .findMany({ filter: { settlementId: settlement.id } }),
    ledger = await c
      .repository<Purchase>('hylPurchaseLedger')
      .findMany({ filter: { orderId: purchase.id } });
  const receiptNet =
      receipts.reduce((a, r) => a + BigInt(r.amountCents), 0n) +
      entries.reduce(
        (a, r) =>
          a +
          (r.kind === 'refund' ? -1n : r.kind === 'reverseRefund' ? 1n : 0n) *
            BigInt(r.amountCents),
        0n,
      ),
    depositCash = deposits.reduce(
      (a, r) =>
        a +
        (r.kind === 'receive' ? 1n : r.kind === 'refund' ? -1n : 0n) *
          BigInt(r.amountCents),
      0n,
    ),
    payout = payments.reduce((a, p) => a + cents(String(p.payload.amount)), 0n),
    purchaseNet = ledger.reduce(
      (a, p) =>
        a +
        (p.type === 'payment' ? -1n : p.type === 'paymentReversal' ? 1n : 0n) *
          BigInt(p.amountCents),
      0n,
    ),
    rawNet = receiptNet + depositCash - payout + purchaseNet;
  if (String(rawNet) !== report.summary.netCents)
    throw Error('Independent cash reconciliation failed');
  return {
    tag,
    projectId: project.id,
    projectName: project.name,
    contractId: contract.id,
    billIds: bills.map((b) => b.id),
    cashierOrderIds: [first.id, second.id],
    settlementId: settlement.id,
    purchaseOrderId: purchase.id,
    steps,
    independent: {
      receiptNetCents: String(receiptNet),
      depositCashCents: String(depositCash),
      settlementPaidCents: String(payout),
      purchaseNetCents: String(purchaseNet),
      rawNetCents: String(rawNet),
      reportNetCents: report.summary.netCents,
      differenceCents: String(rawNet - BigInt(report.summary.netCents)),
    },
    summary: report.summary,
    checks: report.checks.length,
  };
}
