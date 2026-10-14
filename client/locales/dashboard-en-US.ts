export default {
  comparison: {
    previous: 'Previous month ({{month}}): {{amount}}',
    increase: 'Increase {{amount}}',
    decrease: 'Decrease {{amount}}',
    unchanged: 'Unchanged · {{amount}}',
    rate: 'Month-over-month {{value}}',
    noBaseline: 'No approved reports last month · percentage unavailable',
    zeroBaseline: 'Previous turnover is zero · percentage unavailable',
    noBaselineNote: 'Missing reports do not imply no business activity.',
    rankingNote:
      'Compared with the same merchant in {{month}}; ranking remains based on the selected month.',
    currentPeriod:
      'Comparison: approved month-to-date total against the full previous month, not the same elapsed period.',
    fullPeriod:
      'Comparison: selected calendar month against the previous calendar month, approved net turnover only.',
  },
  monthLabel: 'Reporting month',
  resetMonth: 'Current month',
  monthScope:
    'Month filters revenue, daily trend and merchant ranking only. Merchant count and pending work cover all months.',
  trendTitle: 'Revenue trend',
  trendNote: 'Daily approved net turnover in {{month}}, in CNY.',
  rankingTitle: 'Merchant turnover ranking',
  rankingNote:
    'Top 10 by approved net turnover in {{month}}; {{count}} merchants have reports.',
  netTurnover: 'Net turnover',
  dailyDetails: 'View daily amounts',
  dailyCaption:
    'Days without approved reports show zero; this does not imply reporting is complete.',
  date: 'Date',
  merchant: 'Merchant',
  hiddenMerchant: 'Merchant name unavailable',
  noRevenue: 'No approved reports in the selected month',
  noRevenueNote:
    'Choose another month, or approve revenue reports and refresh.',
  allReports: 'View all monthly reports',
  merchantFilter: 'Selected merchant only',

  title: 'Operations dashboard',
  description:
    'Review business metrics and open the lists to approve reports, settle accounts and record refunds.',
  period:
    'Revenue month: {{month}} (Asia/Shanghai). Pending work and outstanding amounts cover all months.',
  updated: 'Updated: {{time}}',
  scope: 'Metrics include only business records you are allowed to view.',
  denied: 'No viewing permission. Contact an administrator.',
  stale:
    'Refresh failed. Previous figures remain below; retry before relying on these amounts.',
  sessionExpired:
    'Your session has expired. Sign in again to view business data.',
  signIn: 'Sign in again',
  rulesTitle: 'Definitions and next steps',
  rules:
    'Net turnover = receipts − refunds + activity vouchers + cash vouchers + complimentary consumption. Unsettled turnover is not an estimated refund and excludes reports already claimed by a settlement. Refunds become outstanding only after settlement review and confirmation.',
  next: 'Approve reports, check source records and generate settlements; confirm settlements before recording completed offline payments.',
  settle: 'Open settlements',
  filters: {
    monthRevenue: 'Dashboard filter: approved reports for {{month}}',
    unsettled: 'Dashboard filter: approved, unclaimed reports (all months)',
    unpaid:
      'Dashboard filter: confirmed, unpaid or partially paid settlements (all months)',
  },
  metrics: {
    merchants: {
      title: 'Merchants',
      note: 'All merchant records, including inactive merchants',
      action: 'View merchants',
    },
    revenue: {
      title: 'Selected month revenue',
      note: 'Approved net turnover, including vouchers and complimentary consumption',
      action: 'View monthly reports',
    },
    pendingReports: {
      title: 'Reports awaiting review',
      note: 'Submitted revenue reports awaiting review, across all months',
      action: 'Review reports',
    },
    unsettled: {
      title: 'Unsettled turnover',
      note: 'Approved, unclaimed net turnover across all months',
      action: 'View unsettled reports',
    },
    unpaid: {
      title: 'Outstanding refunds',
      note: 'Confirmed payable amount less recorded payments, including partial payments',
      action: 'Process refunds',
    },
  },
};
