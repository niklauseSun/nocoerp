import {
  Home,
  Network,
  ChartNoAxesCombined,
  Bell,
  ShoppingCart,
  ClipboardCheck,
  Wrench,
  Gauge,
  FileCheck2,
  Split,
  ReceiptText,
  WalletCards,
  Building2,
  Store,
  FileText,
  Receipt,
  Wallet,
  Landmark,
} from 'lucide-react';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
  type AppClientRouteDefinition,
} from '@nocobase/app-client/plugins';

function approvalChildren(prefix: string): AppClientRouteDefinition[] {
  return [
    {
      name: prefix + '-approval-submit',
      path: 'approvalSubmit',
      componentLoader: () => import('./pages/approvals/submit.js'),
    },
    {
      name: prefix + '-approval-detail',
      path: 'approvalRequests/:approvalRequestId',
      componentLoader: () => import('./pages/approvals/detail.js'),
    },
  ];
}
const procurementLoaders = {
  'receipts-leaf': () => import('./pages/procurement/receipts-leaf.js'),
  'receipts-form': () => import('./pages/procurement/receipts-form.js'),
  'payments-list': () => import('./pages/procurement/payments-list.js'),
  'orders-detail': () => import('./pages/procurement/orders-detail.js'),
  'requests-detail': () => import('./pages/procurement/requests-detail.js'),
  'payments-detail': () => import('./pages/procurement/payments-detail.js'),
  'orders-leaf': () => import('./pages/procurement/orders-leaf.js'),
  'orders-form': () => import('./pages/procurement/orders-form.js'),
  'ledger-leaf': () => import('./pages/procurement/ledger-leaf.js'),
  'suppliers-leaf': () => import('./pages/procurement/suppliers-leaf.js'),
  'requests-leaf': () => import('./pages/procurement/requests-leaf.js'),
  'requests-form': () => import('./pages/procurement/requests-form.js'),
  'suppliers-form': () => import('./pages/procurement/suppliers-form.js'),
  'orders-list': () => import('./pages/procurement/orders-list.js'),
  'payments-form': () => import('./pages/procurement/payments-form.js'),
  'payments-leaf': () => import('./pages/procurement/payments-leaf.js'),
  'suppliers-detail': () => import('./pages/procurement/suppliers-detail.js'),
  'receipts-list': () => import('./pages/procurement/receipts-list.js'),
  'requests-list': () => import('./pages/procurement/requests-list.js'),
  'suppliers-list': () => import('./pages/procurement/suppliers-list.js'),
  finance: () => import('./pages/procurement/finance.js'),
  repair: () => import('./pages/procurement/repair.js'),
  'receipts-detail': () => import('./pages/procurement/receipts-detail.js'),
  'ledger-list': () => import('./pages/procurement/ledger-list.js'),
  'ledger-detail': () => import('./pages/procurement/ledger-detail.js'),
};
const purchaseKinds = [
  'suppliers',
  'requests',
  'orders',
  'receipts',
  'payments',
  'ledger',
] as const;
type PurchaseKind = (typeof purchaseKinds)[number];
function purchaseDetail(
  prefix: string,
  kind: PurchaseKind,
  path: string,
  leaf = false,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader:
      procurementLoaders[
        (kind + (leaf ? '-leaf' : '-detail')) as keyof typeof procurementLoaders
      ],
    children: leaf
      ? []
      : [
          ...(kind === 'requests' ? approvalChildren(prefix) : []),
          ...(kind === 'ledger'
            ? [
                purchaseDetail(
                  prefix + '-source-receipt',
                  'receipts',
                  'source/receipt/:purchasereceiptsId',
                  true,
                ),
                purchaseDetail(
                  prefix + '-source-payment',
                  'payments',
                  'source/payment/:purchasepaymentsId',
                  true,
                ),
              ]
            : []),
          ...['asset', 'repair'].map((k) => ({
            name: prefix + '-' + k,
            path: k + '/:purchaseSourceId',
            componentLoader: () => import('./pages/procurement/source.js'),
          })),
          ...(kind === 'ledger'
            ? []
            : [
                {
                  name: prefix + '-action',
                  path: ':purchaseAction',
                  componentLoader:
                    procurementLoaders[
                      (kind + '-form') as keyof typeof procurementLoaders
                    ],
                },
              ]),
          ...(kind === 'orders'
            ? [
                {
                  name: prefix + '-receipt-new',
                  path: 'newReceipt',
                  componentLoader: () =>
                    import('./pages/procurement/receipts-form.js'),
                },
                ...(['receipts', 'payments', 'ledger'] as PurchaseKind[]).map(
                  (k) =>
                    purchaseDetail(
                      prefix + '-' + k,
                      k,
                      k + '/:purchase' + k + 'Id',
                    ),
                ),
              ]
            : []),
          ...(['requests', 'orders', 'suppliers'] as PurchaseKind[]).map((k) =>
            purchaseDetail(
              prefix + '-source-' + k,
              k,
              'source/' +
                { requests: 'request', orders: 'order', suppliers: 'supplier' }[
                  k as 'requests' | 'orders' | 'suppliers'
                ] +
                '/:purchase' +
                k +
                'Id',
              true,
            ),
          ),
          ...(['suppliers', 'requests'].includes(kind)
            ? [
                purchaseDetail(
                  prefix + '-related',
                  'orders',
                  'related/:purchaseordersId',
                ),
              ]
            : []),
        ],
  };
}
function purchaseList(
  prefix: string,
  kind: PurchaseKind,
  path: string,
  scope?: 'repair' | 'finance',
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader:
      procurementLoaders[
        (scope ?? kind + '-list') as keyof typeof procurementLoaders
      ],
    children: [
      ...(['suppliers', 'requests'].includes(kind)
        ? [
            {
              name: prefix + '-new',
              path: 'new',
              componentLoader:
                procurementLoaders[
                  (kind + '-form') as keyof typeof procurementLoaders
                ],
            },
          ]
        : []),
      purchaseDetail(prefix + '-detail', kind, ':purchase' + kind + 'Id'),
    ],
  };
}
function invoiceLeaf(prefix: string, path: string): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/profit-sharing/source.js'),
  };
}
function invoiceDetailRoute(
  prefix: string,
  path: string,
  leaf = false,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/invoicing/detail.js'),
    children: leaf
      ? []
      : [
          {
            name: prefix + '-red',
            path: 'red',
            componentLoader: () => import('./pages/invoicing/action.js'),
          },
          invoiceSourceRoute(
            prefix + '-source',
            'source/:invoiceSourceId',
            true,
          ),
          invoiceDetailRoute(
            prefix + '-original',
            'original/:originalInvoiceId',
            true,
          ),
          invoiceDetailRoute(prefix + '-credit', 'invoice/:invoiceId', true),
          invoiceLeaf(prefix + '-bill', 'bill/:sourceId'),
          invoiceLeaf(prefix + '-receipt', 'receipt/:sourceId'),
        ],
  };
}
function invoiceSourceRoute(
  prefix: string,
  path: string,
  leaf = false,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/invoicing/detail.js'),
    children: leaf
      ? []
      : [
          {
            name: prefix + '-issue',
            path: 'issue',
            componentLoader: () => import('./pages/invoicing/action.js'),
          },
          {
            name: prefix + '-config',
            path: 'config',
            componentLoader: () => import('./pages/invoicing/config-form.js'),
          },
          invoiceDetailRoute(prefix + '-invoice', 'invoice/:invoiceId'),
          invoiceLeaf(prefix + '-bill', 'bill/:sourceId'),
          invoiceLeaf(prefix + '-receipt', 'receipt/:sourceId'),
          invoiceLeaf(prefix + '-contract', 'contract/:sourceId'),
        ],
  };
}
function invoiceListRoute(
  prefix: string,
  path: string,
  kind: 'sources' | 'invoices' | 'configs',
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/invoicing/list.js'),
    children:
      kind === 'sources'
        ? [
            {
              name: prefix + '-backfill',
              path: 'backfill',
              componentLoader: () => import('./pages/invoicing/backfill.js'),
            },
            {
              name: prefix + '-issue',
              path: 'issue',
              componentLoader: () => import('./pages/invoicing/action.js'),
            },
            invoiceSourceRoute(prefix + '-source', ':invoiceSourceId'),
          ]
        : kind === 'invoices'
          ? [invoiceDetailRoute(prefix + '-invoice', ':invoiceId')]
          : [
              {
                name: prefix + '-new',
                path: 'new',
                componentLoader: () =>
                  import('./pages/invoicing/config-form.js'),
              },
              {
                name: prefix + '-config',
                path: ':invoiceConfigId',
                componentLoader: () => import('./pages/invoicing/detail.js'),
                children: [
                  {
                    name: prefix + '-new-version',
                    path: 'newVersion',
                    componentLoader: () =>
                      import('./pages/invoicing/config-form.js'),
                  },
                ],
              },
            ],
  };
}
function invoiceRelatedRoutes(
  prefix: string,
  contract = false,
): AppClientRouteDefinition[] {
  return [
    invoiceListRoute(prefix + '-sources', 'invoiceSources', 'sources'),
    invoiceListRoute(prefix + '-invoices', 'invoices', 'invoices'),
    invoiceDetailRoute(prefix + '-invoice', 'invoice/:invoiceId'),
    ...(contract
      ? [
          {
            name: prefix + '-config',
            path: 'invoiceConfig',
            componentLoader: () => import('./pages/invoicing/config-form.js'),
          },
        ]
      : []),
  ];
}
function splitRuleRoute(
  prefix: string,
  path: string,
  leaf = false,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/profit-sharing/detail.js'),
    children: leaf
      ? []
      : [
          {
            name: prefix + '-new-version',
            path: 'newVersion',
            componentLoader: () =>
              import('./pages/profit-sharing/rule-form.js'),
          },
          splitCopyRoute(prefix + '-copy', 'copy'),
        ],
  };
}
function splitCopyRoute(
  prefix: string,
  path: string,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/profit-sharing/rule-form.js'),
    children: [splitRuleRoute(prefix + '-result', 'result/:newRuleId', true)],
  };
}
function splitOrderRoute(
  prefix: string,
  path: string,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/profit-sharing/detail.js'),
    children: [
      ...['review', 'execute', 'recover', 'cancel'].map((action) => ({
        name: prefix + '-' + action,
        path: action,
        componentLoader: () => import('./pages/profit-sharing/action.js'),
      })),
      {
        name: prefix + '-reverse',
        path: 'reverse/:transferId',
        componentLoader: () => import('./pages/profit-sharing/action.js'),
      },
      ...['bill', 'receipt', 'settlement', 'contract'].map((kind) => ({
        name: prefix + '-source-' + kind,
        path: kind + '/:sourceId',
        componentLoader: () => import('./pages/profit-sharing/source.js'),
      })),
      splitRuleRoute(prefix + '-rule', 'rule/:ruleId', true),
    ],
  };
}
function splitContractRoutes(prefix: string): AppClientRouteDefinition[] {
  return [
    splitOrderRoute(prefix + '-split-order', 'splitOrder/:splitId'),
    {
      name: prefix + '-split-new',
      path: 'splitRuleNew',
      componentLoader: () => import('./pages/profit-sharing/rule-form.js'),
    },
    splitRuleRoute(prefix + '-split-rule', 'splitRule/:ruleId'),
    {
      name: prefix + '-split-rules',
      path: 'splitRules',
      componentLoader: () => import('./pages/profit-sharing/list.js'),
      children: [
        {
          name: prefix + '-scoped-rule-new',
          path: 'new',
          componentLoader: () => import('./pages/profit-sharing/rule-form.js'),
        },
        splitRuleRoute(prefix + '-scoped-rule', ':ruleId'),
      ],
    },
  ];
}

function cashierSources(prefix: string) {
  return [
    {
      name: `${prefix}-bill`,
      path: 'bill/:billId',
      componentLoader: () => import('./pages/billing/detail.js'),
      children: billOperations(`${prefix}-bill`),
    },
    {
      name: `${prefix}-receipt`,
      path: 'receiptDetail/:receiptId',
      componentLoader: () => import('./pages/billing/detail.js'),
      children: receiptOperations(`${prefix}-receipt`),
    },
    {
      name: `${prefix}-contract`,
      path: 'contract/:id',
      componentLoader: () => import('./pages/cashier/contract.js'),
      children: [
        {
          name: `${prefix}-contract-lease`,
          path: 'lease/:action',
          componentLoader: () => import('./pages/hyl/lease/action.js'),
          children: [],
        },
        {
          name: `${prefix}-contract-bill`,
          path: 'bills/:billId',
          componentLoader: () => import('./pages/billing/detail.js'),
          children: billOperations(`${prefix}-contract-bill`),
        },
        {
          name: `${prefix}-contract-receipt`,
          path: 'receipts/:receiptId',
          componentLoader: () => import('./pages/billing/detail.js'),
          children: receiptOperations(`${prefix}-contract-receipt`),
        },
      ],
    },
  ];
}
function cashierDetail(
  prefix: string,
  path: string,
  kind: 'orders' | 'refunds' | 'reconciliations',
  related = true,
): AppClientRouteDefinition {
  return {
    name: prefix,
    path,
    componentLoader: () => import('./pages/cashier/detail.js'),
    children: [
      ...(kind !== 'reconciliations'
        ? invoiceRelatedRoutes(prefix + '-invoice')
        : []),
      ...cashierSources(prefix),
      ...(kind === 'orders'
        ? [splitOrderRoute(prefix + '-split', 'splitOrder/:splitId')]
        : []),
      ...(kind === 'orders'
        ? [
            {
              name: `${prefix}-edit`,
              path: 'edit',
              componentLoader: () => import('./pages/cashier/checkout.js'),
            },
            {
              name: `${prefix}-void`,
              path: 'void',
              componentLoader: () => import('./pages/cashier/action.js'),
            },
            {
              name: `${prefix}-refund-new`,
              path: 'refundNew',
              componentLoader: () => import('./pages/cashier/refund.js'),
            },
            ...(related
              ? [
                  cashierDetail(
                    `${prefix}-refund`,
                    'refund/:refundId',
                    'refunds',
                    false,
                  ),
                ]
              : []),
          ]
        : []),
      ...(kind === 'refunds'
        ? [
            {
              name: `${prefix}-reverse`,
              path: 'reverse',
              componentLoader: () => import('./pages/cashier/action.js'),
            },
          ]
        : []),
      ...(kind === 'reconciliations'
        ? [
            {
              name: `${prefix}-revision`,
              path: 'reconciliationNew',
              componentLoader: () =>
                import('./pages/cashier/reconciliation.js'),
            },
            ...(related
              ? [
                  cashierDetail(
                    `${prefix}-revision-detail`,
                    'reconciliation/:reconciliationId',
                    'reconciliations',
                    false,
                  ),
                ]
              : []),
          ]
        : []),
    ],
  };
}
const cashierEntries = (prefix: string) => [
  {
    name: `${prefix}-cashier-new`,
    path: 'cashierNew',
    componentLoader: () => import('./pages/cashier/checkout.js'),
  },
  cashierDetail(`${prefix}-cashier-order`, 'cashierOrder/:orderId', 'orders'),
];
const billingFormChildren = (prefix: string) => [
  {
    name: `${prefix}-config`,
    path: 'billingConfig/:billingContractId',
    componentLoader: () => import('./pages/billing/form.js'),
  },
];
const receiptOperations = (prefix: string): AppClientRouteDefinition[] => [
  ...[
    'allocate',
    'refund',
    'void',
    'reverseAllocation/:entryId',
    'reverseRefund/:entryId',
  ].map((path) => ({
    name: `${prefix}-${path.split('/')[0]}`,
    path,
    componentLoader: () => import('./pages/billing/action.js'),
  })),
  ...invoiceRelatedRoutes(prefix + '-invoice'),
];
const billOperations = (prefix: string) => [
  ...approvalChildren(prefix),
  energyListRoute(prefix + '-energy', 'energyReadings', 'readings', true),
  ...invoiceRelatedRoutes(prefix + '-invoice'),
  ...['issue', 'void', 'deposit', 'receipt', 'reverseDeposit/:entryId'].map(
    (path) => ({
      name: `${prefix}-${path.split('/')[0]}`,
      path,
      componentLoader: () => import('./pages/billing/action.js'),
    }),
  ),
  {
    name: `${prefix}-edit`,
    path: 'edit',
    componentLoader: () => import('./pages/billing/form.js'),
    children: billingFormChildren(`${prefix}-edit`),
  },
];
const billDetail = (prefix: string, path = ':billId') => ({
  name: prefix,
  path,
  componentLoader: () => import('./pages/billing/detail.js'),
  children: [
    ...billOperations(prefix),
    ...cashierEntries(prefix),
    {
      name: `${prefix}-receipt-detail`,
      path: 'receiptDetail/:receiptId',
      componentLoader: () => import('./pages/billing/detail.js'),
      children: receiptOperations(`${prefix}-receipt-detail`),
    },
  ],
});
const receiptDetail = (prefix: string, path = ':receiptId') => ({
  name: prefix,
  path,
  componentLoader: () => import('./pages/billing/detail.js'),
  children: [
    ...receiptOperations(prefix),
    ...cashierEntries(prefix),
    {
      name: `${prefix}-bill-detail`,
      path: 'bill/:billId',
      componentLoader: () => import('./pages/billing/detail.js'),
      children: billOperations(`${prefix}-bill-detail`),
    },
  ],
});

function energyFormRoute(name: string, path: string): AppClientRouteDefinition {
  return {
    name,
    path,
    componentLoader: () => import('./pages/energy/form.js'),
  };
}
function energyDetailRoute(
  name: string,
  path: string,
  kind: 'meters' | 'readings',
  leaf = false,
): AppClientRouteDefinition {
  return {
    name,
    path,
    componentLoader: leaf
      ? () => import('./pages/energy/source-detail.js')
      : () => import('./pages/energy/detail.js'),
    children: leaf
      ? []
      : [
          ...(kind === 'meters'
            ? ['edit', 'readingNew', 'assign', 'handover', 'stop']
            : ['edit', 'submit', 'reject', 'void']
          ).map((action) => energyFormRoute(name + '-' + action, action)),
          ...(kind === 'meters'
            ? [
                energyDetailRoute(
                  name + '-reading',
                  'reading/:energyReadingId',
                  'readings',
                ),
              ]
            : [
                energyDetailRoute(
                  name + '-meter',
                  'meter/:energyMeterId',
                  'meters',
                  true,
                ),
              ]),
          ...['asset', 'contract'].map((source) => ({
            name: name + '-' + source,
            path: source + '/:energySourceId',
            componentLoader: () => import('./pages/energy/source.js'),
          })),
          {
            name: name + '-bill',
            path: 'bill/:sourceId',
            componentLoader: () => import('./pages/profit-sharing/source.js'),
          },
        ],
  };
}
function energyListRoute(
  name: string,
  path: string,
  kind: 'meters' | 'readings' | 'billing',
  leaf = false,
): AppClientRouteDefinition {
  return {
    name,
    path,
    componentLoader: leaf
      ? () => import('./pages/energy/source-list.js')
      : () => import('./pages/energy/list.js'),
    children: [
      ...(!leaf
        ? [
            energyFormRoute(
              name + '-new',
              kind === 'billing' ? 'generate' : 'new',
            ),
            ...(kind === 'meters'
              ? [energyFormRoute(name + '-adopt', 'adopt')]
              : []),
          ]
        : []),
      energyDetailRoute(
        name + '-detail',
        kind === 'meters' ? ':energyMeterId' : ':energyReadingId',
        kind === 'meters' ? 'meters' : 'readings',
        leaf,
      ),
    ],
  };
}
function energyRelatedRoutes(prefix: string): AppClientRouteDefinition[] {
  return [
    energyListRoute(prefix + '-meters', 'energyMeters', 'meters'),
    energyListRoute(prefix + '-readings', 'energyReadings', 'readings'),
    energyListRoute(prefix + '-billing', 'energyBilling', 'billing'),
  ];
}

function repairRoutes(
  prefix: string,
  inspectionLinks = true,
): AppClientRouteDefinition[] {
  return [
    {
      name: prefix + '-new',
      path: 'new',
      componentLoader: () => import('./pages/repairs/form.js'),
    },
    {
      name: prefix + '-detail',
      path: ':repairId',
      componentLoader: inspectionLinks
        ? () => import('./pages/repairs/detail.js')
        : () => import('./pages/inspections/repair.js'),
      children: [
        purchaseList(prefix + '-purchase', 'requests', 'procurement', 'repair'),
        ...[
          'edit',
          'assign',
          'reassign',
          'start',
          'progress',
          'complete',
          'accept',
          'reject',
          'close',
          'cancel',
        ].map((action) => ({
          name: prefix + '-' + action,
          path: action,
          componentLoader: () => import('./pages/repairs/form.js'),
        })),
        ...(inspectionLinks
          ? [
              {
                name: prefix + '-inspections',
                path: 'inspectionissues',
                componentLoader: () =>
                  import('./pages/inspections/issues-repair.js'),
                children: [
                  {
                    name: prefix + '-inspection-leaf',
                    path: ':inspectionLeafId',
                    componentLoader: () =>
                      import('./pages/inspections/issues-leaf.js'),
                  },
                ],
              },
            ]
          : []),
        ...['asset', 'merchant', 'contract'].map((kind) => ({
          name: prefix + '-' + kind,
          path: kind + '/:repairSourceId',
          componentLoader: () => import('./pages/repairs/source.js'),
        })),
      ],
    },
  ];
}
function repairRelatedRoute(prefix: string): AppClientRouteDefinition {
  return {
    name: prefix + '-repairs',
    path: 'repairOrders',
    componentLoader: () => import('./pages/repairs/related-list.js'),
    children: repairRoutes(prefix + '-repairs'),
  };
}

function inspectionDetail(
  prefix: string,
  kind: 'plans' | 'tasks' | 'issues',
): AppClientRouteDefinition {
  const actions =
    kind === 'plans'
      ? ['edit', 'activate', 'pause', 'archive', 'generate']
      : kind === 'tasks'
        ? [
            'assign',
            'start',
            'save',
            'report',
            'submit',
            'pass',
            'return',
            'cancel',
          ]
        : ['assign', 'rectify', 'pass', 'return', 'toRepair'];
  const loadForm =
    kind === 'plans'
      ? () => import('./pages/inspections/plans-form.js')
      : kind === 'tasks'
        ? () => import('./pages/inspections/tasks-form.js')
        : () => import('./pages/inspections/issues-form.js');
  return {
    name: prefix + '-detail',
    path:
      kind === 'plans'
        ? ':inspectionPlanId'
        : kind === 'tasks'
          ? ':inspectionTaskId'
          : ':inspectionIssueId',
    componentLoader:
      kind === 'plans'
        ? () => import('./pages/inspections/plans-detail.js')
        : kind === 'tasks'
          ? () => import('./pages/inspections/tasks-detail.js')
          : () => import('./pages/inspections/issues-detail.js'),
    children: [
      ...actions.map((action) => ({
        name: prefix + '-' + action,
        path: action,
        componentLoader: loadForm,
      })),
      {
        name: prefix + '-asset',
        path: 'source/asset/:inspectionAssetId',
        componentLoader: () => import('./pages/inspections/source.js'),
      },
      ...(['plans', 'tasks'] as const).map((k) => ({
        name: prefix + '-source-' + k,
        path: 'source/' + k + '/:inspectionLeafId',
        componentLoader:
          k === 'plans'
            ? () => import('./pages/inspections/plans-leaf.js')
            : () => import('./pages/inspections/tasks-leaf.js'),
      })),
      ...(kind === 'plans'
        ? [inspectionList(prefix + '-tasks', 'tasks', 'plan')]
        : kind === 'tasks'
          ? [inspectionList(prefix + '-issues', 'issues', 'task')]
          : [
              {
                name: prefix + '-repair',
                path: 'repair',
                componentLoader: () => import('./pages/inspections/outlet.js'),
                children: repairRoutes(prefix + '-repair', false).filter(
                  (r) => r.path !== 'new',
                ),
              },
            ]),
    ],
  };
}
function inspectionList(
  prefix: string,
  kind: 'plans' | 'tasks' | 'issues',
  scope?: 'asset' | 'plan' | 'task' | 'repair',
): AppClientRouteDefinition {
  const loaders = {
    plans: {
      main: () => import('./pages/inspections/plans-list.js'),
      asset: () => import('./pages/inspections/plans-asset.js'),
      plan: () => import('./pages/inspections/plans-plan.js'),
      task: () => import('./pages/inspections/plans-task.js'),
      repair: () => import('./pages/inspections/plans-repair.js'),
    },
    tasks: {
      main: () => import('./pages/inspections/tasks-list.js'),
      asset: () => import('./pages/inspections/tasks-asset.js'),
      plan: () => import('./pages/inspections/tasks-plan.js'),
      task: () => import('./pages/inspections/tasks-task.js'),
      repair: () => import('./pages/inspections/tasks-repair.js'),
    },
    issues: {
      main: () => import('./pages/inspections/issues-list.js'),
      asset: () => import('./pages/inspections/issues-asset.js'),
      plan: () => import('./pages/inspections/issues-plan.js'),
      task: () => import('./pages/inspections/issues-task.js'),
      repair: () => import('./pages/inspections/issues-repair.js'),
    },
  };
  return {
    name: prefix,
    path: scope ? 'inspection' + kind : kind,
    componentLoader: loaders[kind][scope ?? 'main'],
    children: [
      ...(kind === 'plans'
        ? [
            {
              name: prefix + '-new',
              path: 'new',
              componentLoader: () =>
                import('./pages/inspections/plans-form.js'),
            },
          ]
        : []),
      inspectionDetail(prefix, kind),
    ],
  };
}

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    name: 'hyl-tenant-operations',
    path: '/tenantOperations',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-tenant-operations' },
      action: 'access',
    },
    navigation: { title: 'operations.title', icon: ClipboardCheck },
    componentLoader: () => import('./pages/tenant-operations/index.js'),
    children: [
      {
        name: 'hyl-tenant-operations-followup',
        path: 'followup/:kind/:sourceId',
        componentLoader: () => import('./pages/tenant-operations/action.js'),
      },
      {
        name: 'hyl-tenant-operations-import',
        path: 'import',
        componentLoader: () =>
          import('./pages/tenant-operations/bank-import.js'),
      },
      {
        name: 'hyl-tenant-operations-batch-new',
        path: 'batch/new',
        componentLoader: () =>
          import('./pages/tenant-operations/batch-form.js'),
      },
      {
        name: 'hyl-tenant-operations-batch-detail',
        path: 'batch/:batchId',
        componentLoader: () =>
          import('./pages/tenant-operations/batch-detail.js'),
        children: [
          {
            name: 'hyl-batch-contract-source',
            path: 'contract/:id',
            componentLoader: () =>
              import('./pages/tenant-operations/batch-source.js'),
          },
          {
            name: 'hyl-batch-settlement-source',
            path: 'settlement/:id',
            componentLoader: () =>
              import('./pages/tenant-operations/batch-source.js'),
            children: ['review', 'confirm', 'dispute', 'cancel', 'pay'].map(
              (action) => ({
                name: 'hyl-batch-settlement-' + action,
                path: action,
                componentLoader: () => import('./pages/hyl/action.js'),
              }),
            ),
          },
        ],
      },
      {
        name: 'hyl-tenant-operations-service-new',
        path: 'service/new',
        componentLoader: () =>
          import('./pages/tenant-operations/service-form.js'),
      },
      {
        name: 'hyl-tenant-operations-service-detail',
        path: 'service/:serviceId',
        componentLoader: () =>
          import('./pages/tenant-operations/service-detail.js'),
        children: [
          {
            name: 'hyl-tenant-operations-service-action',
            path: 'action/:serviceAction',
            componentLoader: () =>
              import('./pages/tenant-operations/service-action.js'),
          },
        ],
      },
      {
        name: 'hyl-tenant-operations-bank-resolve',
        path: 'resolve/:bankRowId',
        componentLoader: () =>
          import('./pages/tenant-operations/bank-resolution.js'),
      },
      {
        name: 'hyl-tenant-operations-bank-batch',
        path: 'matchBatch',
        componentLoader: () =>
          import('./pages/tenant-operations/bank-batch.js'),
      },
      {
        name: 'hyl-tenant-operations-match',
        path: 'match/:bankRowId',
        componentLoader: () => import('./pages/tenant-operations/action.js'),
      },
    ],
  },
  {
    name: 'hyl-procurement',
    path: '/procurement',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-procurement' },
      action: 'access',
    },
    navigation: { title: 'procurement.title', icon: ShoppingCart },
    componentLoader: () => import('./pages/procurement/index.js'),
    children: purchaseKinds.map((k) =>
      purchaseList('hyl-procurement-' + k, k, k),
    ),
  },
  {
    name: 'hyl-inspections',
    path: '/inspections',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-inspections' },
      action: 'access',
    },
    navigation: { title: 'inspection.title', icon: ClipboardCheck },
    componentLoader: () => import('./pages/inspections/index.js'),
    children: [
      inspectionList('hyl-inspections-plans', 'plans'),
      inspectionList('hyl-inspections-tasks', 'tasks'),
      inspectionList('hyl-inspections-issues', 'issues'),
      {
        name: 'hyl-inspection-scheduling',
        path: 'scheduling',
        componentLoader: () => import('./pages/inspections/scheduling.js'),
      },
    ],
  },
  {
    name: 'hyl-repairs',
    path: '/repairs',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-repairs' }, action: 'access' },
    navigation: { title: 'repair.title', icon: Wrench },
    componentLoader: () => import('./pages/repairs/list.js'),
    children: repairRoutes('hyl-repairs'),
  },
  {
    name: 'hyl-energy',
    path: '/energy',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-energy' }, action: 'access' },
    navigation: { title: 'energy.title', icon: Gauge },
    componentLoader: () => import('./pages/energy/index.js'),
    children: [
      energyListRoute('hyl-energy-meters', 'meters', 'meters'),
      energyListRoute('hyl-energy-readings', 'readings', 'readings'),
      energyListRoute('hyl-energy-billing', 'billing', 'billing'),
    ],
  },
  {
    name: 'hyl-invoicing',
    path: '/invoicing',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-invoicing' },
      action: 'access',
    },
    navigation: { title: 'invoice.title', icon: FileCheck2 },
    componentLoader: () => import('./pages/invoicing/index.js'),
    children: [
      invoiceListRoute('hyl-invoice-sources', 'sources', 'sources'),
      invoiceListRoute('hyl-invoice-ledger', 'invoices', 'invoices'),
      invoiceListRoute('hyl-invoice-configs', 'configs', 'configs'),
    ],
  },
  {
    name: 'hyl-profit-sharing',
    path: '/profit-sharing',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-profit-sharing' },
      action: 'access',
    },
    navigation: { title: 'split.title', icon: Split },
    componentLoader: () => import('./pages/profit-sharing/index.js'),
    children: [
      {
        name: 'hyl-split-orders',
        path: 'orders',
        componentLoader: () => import('./pages/profit-sharing/list.js'),
        children: [
          {
            name: 'hyl-split-new',
            path: 'new',
            componentLoader: () =>
              import('./pages/profit-sharing/new-order.js'),
          },
          splitOrderRoute('hyl-split-detail', ':splitId'),
        ],
      },
      {
        name: 'hyl-split-rules',
        path: 'rules',
        componentLoader: () => import('./pages/profit-sharing/list.js'),
        children: [
          {
            name: 'hyl-split-rule-new',
            path: 'new',
            componentLoader: () =>
              import('./pages/profit-sharing/rule-form.js'),
          },
          splitCopyRoute('hyl-split-rule-copy', 'copy/:ruleId'),
          splitRuleRoute('hyl-split-rule-detail', ':ruleId'),
        ],
      },
    ],
  },

  {
    name: 'hyl-assets',
    path: '/assets',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-assets' }, action: 'access' },
    navigation: { title: 'assets.title', icon: Building2 },
    componentLoader: () => import('./pages/assets/index.js'),
    children: [
      {
        name: 'hyl-assets-new',
        path: 'new',
        componentLoader: () => import('./pages/assets/form.js'),
      },
      {
        name: 'hyl-assets-detail',
        path: ':id',
        componentLoader: () => import('./pages/assets/detail.js'),
        children: [
          energyListRoute('hyl-assets-energy', 'energyMeters', 'meters'),
          repairRelatedRoute('hyl-assets'),
          inspectionList('hyl-assets-inspections-tasks', 'tasks', 'asset'),
          inspectionList('hyl-assets-inspections-issues', 'issues', 'asset'),
          {
            name: 'hyl-assets-edit',
            path: 'edit',
            componentLoader: () => import('./pages/assets/form.js'),
          },
          {
            name: 'hyl-assets-file-new',
            path: 'files/new',
            componentLoader: () => import('./pages/assets/files.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-merchants',
    path: '/merchants',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-merchants' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.merchants', icon: Store },
    componentLoader: () => import('./pages/hyl/merchants.js'),
    children: [
      {
        name: 'hyl-merchants-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-merchants-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-merchants-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          repairRelatedRoute('hyl-merchants'),
          {
            name: 'hyl-merchants-assets-new',
            path: 'assets/new',
            componentLoader: () => import('./pages/assets/bindings.js'),
          },
          {
            name: 'hyl-merchants-assets-close',
            path: 'assets/:bindingId/close',
            componentLoader: () => import('./pages/assets/bindings.js'),
          },

          {
            name: 'hyl-merchants-licenses-new',
            path: 'licenses/new',
            componentLoader: () =>
              import('./pages/hyl/merchant-profile/form.js'),
          },
          {
            name: 'hyl-merchants-visits-new',
            path: 'visits/new',
            componentLoader: () =>
              import('./pages/hyl/merchant-profile/form.js'),
          },
          {
            name: 'hyl-merchants-contacts-new',
            path: 'contacts/new',
            componentLoader: () =>
              import('./pages/hyl/merchant-profile/form.js'),
          },
          {
            name: 'hyl-merchants-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-contracts',
    path: '/contracts',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-contracts' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.contracts', icon: FileText },
    componentLoader: () => import('./pages/hyl/contracts.js'),
    children: [
      {
        name: 'hyl-contracts-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-contracts-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-contracts-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          ...approvalChildren('hyl-contracts'),
          {
            name: 'hyl-contracts-billing-config',
            path: 'billingConfig',
            componentLoader: () => import('./pages/billing/form.js'),
          },
          {
            name: 'hyl-contracts-billing-new',
            path: 'billingNew',
            componentLoader: () => import('./pages/billing/form.js'),
            children: billingFormChildren('hyl-contracts-billing-new'),
          },
          {
            name: 'hyl-contracts-receipt-new',
            path: 'receipts/new',
            componentLoader: () => import('./pages/billing/action.js'),
          },
          ...cashierEntries('hyl-contracts'),
          ...splitContractRoutes('hyl-contracts'),
          ...invoiceRelatedRoutes('hyl-contracts-invoice', true),
          ...energyRelatedRoutes('hyl-contracts-energy'),
          repairRelatedRoute('hyl-contracts'),
          billDetail('hyl-contracts-bill', 'bills/:billId'),
          receiptDetail('hyl-contracts-receipt', 'receipts/:receiptId'),
          {
            name: 'hyl-contracts-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
          {
            name: 'hyl-contracts-lease-action',
            path: 'lease/:action',
            componentLoader: () => import('./pages/hyl/lease/action.js'),
            children: [
              billDetail('hyl-contracts-lease-bill', 'bills/:billId'),
              receiptDetail(
                'hyl-contracts-lease-receipt',
                'receipts/:receiptId',
              ),
            ],
          },
          {
            name: 'hyl-contracts-settlement',
            path: 'settlement/:id',
            componentLoader: () => import('./pages/hyl/lease/settlement.js'),
            children: ['review', 'confirm', 'dispute', 'cancel', 'pay'].map(
              (action) => ({
                name: `hyl-contracts-settlement-${action}`,
                path: action,
                componentLoader: () => import('./pages/hyl/action.js'),
              }),
            ),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-revenueReports',
    path: '/revenueReports',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-revenueReports' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.revenueReports', icon: Receipt },
    componentLoader: () => import('./pages/hyl/revenueReports.js'),
    children: [
      {
        name: 'hyl-revenueReports-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-revenueReports-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-revenueReports-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-revenueReports-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
          {
            name: 'hyl-revenueReports-submit',
            path: 'submit',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-revenueReports-approve',
            path: 'approve',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-revenueReports-return',
            path: 'return',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-expenses',
    path: '/expenses',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-expenses' }, action: 'access' },
    navigation: { title: 'hyl.nav.expenses', icon: Wallet },
    componentLoader: () => import('./pages/hyl/expenses.js'),
    children: [
      purchaseList(
        'hyl-expenses-purchase',
        'ledger',
        'purchaseLedger',
        'finance',
      ),
      {
        name: 'hyl-expenses-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-expenses-edit',
        path: 'edit/:id',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-expenses-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          {
            name: 'hyl-expenses-detail-edit',
            path: 'edit',
            componentLoader: () => import('./pages/hyl/form.js'),
          },
          {
            name: 'hyl-expenses-submit',
            path: 'submit',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-expenses-approve',
            path: 'approve',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-expenses-return',
            path: 'return',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-settlements',
    path: '/settlements',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-settlements' },
      action: 'access',
    },
    navigation: { title: 'hyl.nav.settlements', icon: Landmark },
    componentLoader: () => import('./pages/hyl/settlements.js'),
    children: [
      {
        name: 'hyl-settlements-new',
        path: 'new',
        componentLoader: () => import('./pages/hyl/form.js'),
      },
      {
        name: 'hyl-settlements-detail',
        path: ':id',
        componentLoader: () => import('./pages/hyl/detail.js'),
        children: [
          splitOrderRoute('hyl-settlements-split', 'splitOrder/:splitId'),
          {
            name: 'hyl-settlements-review',
            path: 'review',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-confirm',
            path: 'confirm',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-dispute',
            path: 'dispute',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-cancel',
            path: 'cancel',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
          {
            name: 'hyl-settlements-pay',
            path: 'pay',
            componentLoader: () => import('./pages/hyl/action.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'hyl-cashier',
    path: '/cashier',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-cashier' }, action: 'access' },
    navigation: { title: 'cashier.title', icon: WalletCards },
    componentLoader: () => import('./pages/cashier/index.js'),
    children: [
      {
        name: 'hyl-cashier-orders',
        path: 'orders',
        componentLoader: () => import('./pages/cashier/list.js'),
        children: [
          {
            name: 'hyl-cashier-order-new',
            path: 'new',
            componentLoader: () => import('./pages/cashier/checkout.js'),
          },
          cashierDetail('hyl-cashier-order', ':orderId', 'orders'),
        ],
      },
      {
        name: 'hyl-cashier-refunds',
        path: 'refunds',
        componentLoader: () => import('./pages/cashier/list.js'),
        children: [
          {
            name: 'hyl-cashier-refund-new',
            path: 'new',
            componentLoader: () => import('./pages/cashier/refund.js'),
          },
          cashierDetail('hyl-cashier-refund', ':refundId', 'refunds'),
        ],
      },
      {
        name: 'hyl-cashier-reconciliations',
        path: 'reconciliations',
        componentLoader: () => import('./pages/cashier/list.js'),
        children: [
          {
            name: 'hyl-cashier-reconciliation-new',
            path: 'new',
            componentLoader: () => import('./pages/cashier/reconciliation.js'),
          },
          cashierDetail(
            'hyl-cashier-reconciliation',
            ':reconciliationId',
            'reconciliations',
          ),
        ],
      },
    ],
  },
  {
    name: 'hyl-billing',
    path: '/billing',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'hyl-billing' }, action: 'access' },
    navigation: { title: 'billing.title', icon: ReceiptText },
    componentLoader: () => import('./pages/billing/index.js'),
    children: [
      {
        name: 'hyl-billing-bills',
        path: 'bills',
        componentLoader: () => import('./pages/billing/list.js'),
        children: [
          {
            name: 'hyl-billing-new',
            path: 'new',
            componentLoader: () => import('./pages/billing/form.js'),
            children: billingFormChildren('hyl-billing-new'),
          },
          billDetail('hyl-billing-bill'),
        ],
      },
      {
        name: 'hyl-billing-receipts',
        path: 'receipts',
        componentLoader: () => import('./pages/billing/list.js'),
        children: [
          {
            name: 'hyl-billing-receipt-new',
            path: 'new',
            componentLoader: () => import('./pages/billing/action.js'),
          },
          receiptDetail('hyl-billing-receipt'),
        ],
      },
    ],
  },
  {
    name: 'mobile-workbench',
    path: '/workbench',
    auth: 'required',
    authz: 'skip',
    // Direct/mobile entry: keep the route accessible without adding a sidebar item.
    componentLoader: () => import('./pages/workbench/index.js'),
    children: [
      {
        name: 'mobile-workbench-todo',
        path: 'todos/:messageTodoId',
        componentLoader: () => import('./pages/messages/detail.js'),
      },
      {
        name: 'mobile-workbench-approval',
        path: 'approvalRequests/:approvalRequestId',
        authz: {
          resource: { type: 'page', id: 'hyl-approvals' },
          action: 'access',
        },
        componentLoader: () => import('./pages/approvals/detail.js'),
      },
    ],
  },
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/home/index.js'),
    name: 'home',
    navigation: { title: 'dashboard.title', icon: Home },
    path: '/',
  },
  {
    // Personal inbox APIs enforce ownership; linked business records retain domain authorization.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/inbox.js'),
    name: 'inbox',
    navigation: { title: 'messages.title', icon: Bell },
    path: '/inbox',
  },
  {
    auth: 'required',
    name: 'financial-reports',
    path: '/financialReports',
    componentLoader: () => import('./pages/financial-reports/index.js'),
    authz: {
      resource: { type: 'page', id: 'hyl-financial-reports' },
      action: 'access',
    },
    navigation: { title: 'finance.title', icon: ChartNoAxesCombined },
    children: [
      {
        name: 'financial-report-source',
        path: ':kind/:sourceId',
        componentLoader: () => import('./pages/financial-reports/detail.js'),
      },
    ],
  },
  {
    name: 'approvals',
    path: '/approvals',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'hyl-approvals' },
      action: 'access',
    },
    navigation: { title: 'approval.title', icon: ClipboardCheck },
    componentLoader: () => import('./pages/approvals/list.js'),
    children: [
      {
        name: 'approval-detail',
        path: 'requests/:approvalRequestId',
        componentLoader: () => import('./pages/approvals/detail.js'),
      },
      {
        name: 'approval-configs',
        path: 'configs',
        componentLoader: () => import('./pages/approvals/configs.js'),
        children: [
          {
            name: 'approval-config-new',
            path: 'new',
            componentLoader: () => import('./pages/approvals/config-form.js'),
          },
          {
            name: 'approval-config-detail',
            path: ':approvalProjectId/:approvalKind',
            componentLoader: () => import('./pages/approvals/config-form.js'),
          },
        ],
      },
    ],
  },
  {
    authz: 'skip',
    auth: 'required',
    name: 'message-todos',
    path: '/messageTodos',
    componentLoader: () => import('./pages/messages/list.js'),
    children: [
      {
        authz: 'skip',
        auth: 'required',
        name: 'message-todo',
        path: ':messageTodoId',
        componentLoader: () => import('./pages/messages/detail.js'),
      },
    ],
  },
  {
    authz: 'skip',
    auth: 'required',
    name: 'message-preferences',
    path: '/messagePreferences',
    componentLoader: () => import('./pages/messages/preferences.js'),
  },
  {
    name: 'hyl-organization',
    path: '/organization',
    auth: 'required',
    authz: {
      resource: { type: 'settings', id: 'hyl.organization' },
      action: 'read',
    },
    navigation: { title: 'organization.title', icon: Network },
    componentLoader: () => import('./pages/organization/index.js'),
    children: [
      {
        name: 'hyl-organization-departments',
        path: 'departments',
        componentLoader: () => import('./pages/organization/departments.js'),
        children: [
          {
            name: 'hyl-organization-department-new',
            path: 'new',
            componentLoader: () =>
              import('./pages/organization/new-department.js'),
          },
          {
            name: 'hyl-organization-member-new',
            path: 'members/new',
            componentLoader: () => import('./pages/organization/new-member.js'),
          },
          {
            name: 'hyl-organization-department-edit',
            path: 'edit/:departmentId',
            componentLoader: () =>
              import('./pages/organization/edit-department.js'),
          },
        ],
      },
      {
        name: 'hyl-organization-projects',
        path: 'projects',
        componentLoader: () => import('./pages/organization/projects.js'),
      },
      {
        name: 'hyl-organization-roles',
        path: 'roles',
        componentLoader: () => import('./pages/organization/roles.js'),
        children: [
          {
            name: 'hyl-organization-role',
            path: ':roleKey',
            componentLoader: () => import('./pages/organization/role-form.js'),
          },
        ],
      },
      {
        name: 'hyl-organization-users',
        path: 'users',
        componentLoader: () => import('./pages/organization/users.js'),
      },
    ],
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
  {
    // Where a command line's sign-in sends the person to approve it (`pages/auth/device.tsx`). Optional rather than
    // required so it renders outside the shell, like the sign-in pages; the page sends a guest to sign in and back.
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/device.js'),
    name: 'device',
    path: '/device',
  },
]);

const routes: readonly AppClientRouteContribution[] = [appRoutes];

export default routes;
