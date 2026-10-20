import report from '../../server/locales/operations-en-US.js';
import delivery from './delivery-en-US.js';
export default {
  ...report,
  ...delivery,
  metricScope:
    'Metrics cover the complete authorized scope; search and status filter the details only.',
  methods: {
    bank: 'Bank',
    cash: 'Cash',
    other: 'Other',
    unclassified: 'Unclassified',
  },
  differences: 'Same-reference discrepancies',
  differenceAmount: 'External minus internal:',
  differenceLimit:
    'First 5 similar events shown; inspect the financial ledger for more.',
  allStatuses: 'All statuses',
  actionsFor: 'Actions for {{name}}',
  feeCents: 'Confirmed settlement fees',
  group: 'Report grouping',
  groups: {
    daily: 'Merchant daily / channel',
    merchant: 'Monthly merchant ranking',
    channel: 'Monthly channels',
    project: 'Monthly projects',
  },
  collectionRate:
    'Current receivable application rate (includes deposit offsets):',
  cashCollectionRate:
    'Current cash collection rate (cash applied / confirmed receivables; excludes deposit offsets and unallocated advances):',
  cashCollectionHint:
    'Based on the current registered ledger. Actual bank arrival requires external reconciliation; the month filter does not create historical receivable snapshots.',
  description:
    'Follow up reporting, settlements, arrears and leases; reconcile external statements.',
  reporting: 'Reporting completeness',
  statements: 'Settlement delivery',
  arrears: 'Arrears',
  leases: 'Lease expiry',
  vacancy: 'Vacant units',
  business: 'Daily revenue and channels',
  reconciliation: 'External reconciliation',
  import: 'Import statement',
  export: 'Export Excel',
  pdf: 'Export PDF',
  search: 'Search names, numbers, channels or dates',
  month: 'Month',
  clear: 'Clear filters',
  open: 'Open business module',
  followup: 'Record follow-up',
  empty: 'No items to process',
  emptyHint:
    'Authorized sources have been checked. Effective leases enable reporting completeness checks.',
  noResults: 'No matching records',
  noResultsHint: 'Adjust the month or search.',
  current:
    'Arrears, expiry and vacancy use the current Shanghai date. Month filters revenue, settlements and bank statements.',
  scope:
    'Only authorized source records are included. Missing is different from reported zero.',
  metrics: {
    cashAppliedCents: 'Cash applied (excluding deposit offsets)',
    feeCents: 'Confirmed settlement fees',
    assessedCents: 'Assessed receivables',
    appliedCents: 'Applied amount',
    age30Cents: '1–30 days overdue',
    age60Cents: '31–60 days overdue',
    age90Cents: '61–90 days overdue',
    ageOver90Cents: 'Over 90 days overdue',
    expected: 'Expected merchant-days',
    missing: 'Missing merchant-days',
    pending: 'Unapproved merchant-days',
    revenueCents: 'Approved revenue',
    merchants: 'Reporting merchants',
    units: 'Available normal units',
    occupied: 'Occupied units',
    vacant: 'Vacant units',
    outstandingCents: 'Current receivables',
  },
  occupancy:
    'Occupancy uses normal units with positive lettable area; an effective binding makes a unit occupied.',
  followupTitle: 'Record business follow-up',
  note: 'Follow-up note *',
  nextDate: 'Next follow-up date *',
  history: 'Follow-up history',
  save: 'Save',
  cancel: 'Cancel',
  saved: 'Saved',
  required: 'Complete required fields and check their format.',
  bankHelp:
    'Import UTF-8 CSV with headers externalId,date,reference,amountCents,method. Amounts are signed integer cents. Maximum 500 rows. TEST examples are not actual money movements.',
  account: 'Statement account *',
  file: 'CSV file *',
  preview: 'Import preview',
  rows: '{{count}} rows',
  badCsv:
    'Invalid CSV. Check dates, integer cents, methods and duplicate references.',
  importTitle: 'Import external statement',
  sample: 'Download TEST example',
  matchTitle: 'Confirm external transaction match',
  match: 'Review match',
  event: 'Internal cash event *',
  reason: 'Match evidence / difference explanation *',
  confirm: 'Confirm match',
  matchHelp:
    'Unique matches require the same date, reference, method and amount. Ambiguous candidates need manual review. Confirmation records reconciliation only, without registering cash.',
  noCandidates:
    'No available cash events with the same amount. Check original payments; matching cannot register money.',
  source: 'Source',
  attachments: 'Evidence attachments',
  attachmentHelp:
    'After saving, append PDF, PNG or JPEG evidence (10MB each). Upload actor and time are retained; historical evidence is not replaced.',
  upload: 'Upload evidence',
  uploaded: 'Evidence uploaded',
  exportHint:
    'Exports include all authorized records matching the filters, in CNY.',
  errors: {
    MATCH_INVALID:
      'The event is already matched, inaccessible or has a different amount. Refresh and check.',
    REQUEST_CONFLICT: 'Retry content changed. Refresh before submitting again.',
  },
};
