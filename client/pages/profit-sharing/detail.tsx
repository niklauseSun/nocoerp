import { useCoverFocus } from './focus.js';
import { scalar } from '../hyl/model.js';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { LongText } from '#components/long-text';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import {
  Group,
  Money,
  Day,
  RecordedAt,
  Value,
  Refresh,
  LoadingRows,
  BillingError,
  SplitAmounts,
  Paged,
  Truncated,
} from './common.js';
import type { Order, Rule, Line } from './types.js';
type History = {
  id: string;
  revision?: number;
  kind?: string;
  status?: string;
  amountCents?: string;
  reference?: string;
  createdAt: string;
  payload: Record<string, unknown>;
};
type Rows = {
  data: History[];
  meta: { page: number; pageSize: number; total: number };
};
export default function SplitDetail() {
  useCoverFocus();
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    [query, setQuery] = useSearchParams();
  const rules = /\/(rules|splitRules|splitRule|rule)\//.test(path),
    id = rules ? (p.newRuleId ?? p.ruleId) : p.splitId;
  const result = useBusinessQuery<{
      data: Order &
        Rule & {
          allowedActions: string[];
          closed: boolean;
          sourceRows: {
            data: import('./types.js').Snapshot['sources'];
            meta: Rows['meta'];
          };
          payments: Rows;
          merchantPayments: {
            id: string;
            reference: string;
            payload: Record<string, unknown>;
          }[];
          revisions: Rows;
          transfers: Rows;
          attempts: Rows;
        };
    }>(
      `${rules ? 'splitRules' : 'splitOrders'}/${id}`,
      rules
        ? undefined
        : {
            ...Object.fromEntries(
              ['revisions', 'transfers', 'attempts', 'sources', 'payments'].map(
                (k) => [k, Number(query.get(k + 'Page') ?? 1)],
              ),
            ),
            ...Object.fromEntries(
              ['transfers', 'attempts', 'revisions'].map((k) => [
                k + 'Order',
                query.get(k + 'Order') ?? '-createdAt',
              ]),
            ),
          },
    ),
    row = result.data?.data,
    s = row?.payload.snapshot;
  const config = useBusinessPermission('contracts', 'splitConfigure');
  const back = /\/copy(?:\/[^/]+)?\/result\/[^/]+$/.test(path)
      ? path.replace(/\/copy(?:\/[^/]+)?\/result\/[^/]+$/, '')
      : /\/(splitOrder|splitRule|rule)\/[^/]+$/.test(path)
        ? path.split('/').slice(0, -2).join('/')
        : path.slice(0, path.lastIndexOf('/')),
    backQuery = new URLSearchParams(l.search);
  if (!rules)
    for (const k of [
      'revisions',
      'transfers',
      'attempts',
      'sources',
      'payments',
    ]) {
      backQuery.delete(k + 'Page');
      backQuery.delete(k + 'Order');
    }
  const link = (
    action: string,
    label = action,
    primary = false,
    disabled = false,
  ) => (
    <Button
      key={action}
      disabled={disabled}
      nativeButton={false}
      variant={primary ? 'default' : 'outline'}
      render={<Link to={{ pathname: path + '/' + action, search: l.search }} />}
    >
      {t(`split.${label}`)}
    </Button>
  );
  const allowed = row?.allowedActions ?? [],
    can = !!row && !row.closed;
  const currentReview = !!row && row.payload.reviewedHash === row.sourceHash;
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton to={{ pathname: back, search: backQuery.toString() }} />
          <PageHeader
            title={
              row
                ? t(rules ? 'split.ruleTitle' : 'split.detailTitle', {
                    number: rules ? row.searchText : row.number,
                  })
                : t(rules ? 'split.rules' : 'split.orders')
            }
            actions={
              <>
                {row &&
                rules &&
                config.can &&
                row.allowedActions?.includes('splitConfigure') &&
                !row.closed &&
                !p.newRuleId &&
                !/\/rule\//.test(path) ? (
                  <>
                    {link('newVersion', 'newVersion', true)}
                    {link('copy', 'copy')}
                  </>
                ) : row && !rules ? (
                  <>
                    {allowed.includes('splitReview')
                      ? link(
                          'review',
                          'review',
                          !currentReview,
                          !can || row.status === 'cancelled',
                        )
                      : null}
                    {allowed.includes('splitExecute')
                      ? link(
                          'execute',
                          'execute',
                          currentReview && BigInt(row.remainingCents) > 0n,
                          !can ||
                            !currentReview ||
                            BigInt(s?.fundingGapCents ?? 0) > 0n ||
                            BigInt(row.remainingCents) === 0n,
                        )
                      : null}
                    {allowed.includes('splitRecover')
                      ? link(
                          'recover',
                          'recover',
                          currentReview &&
                            BigInt(row.remainingCents) === 0n &&
                            BigInt(row.recoveryCents) > 0n,
                          !can ||
                            !currentReview ||
                            BigInt(row.recoveryCents) === 0n,
                        )
                      : null}
                    {allowed.includes('splitReview') &&
                    row.sourceFundsCents === '0' &&
                    row.netPaidCents === '0'
                      ? link(
                          'cancel',
                          'cancel',
                          false,
                          !can || row.status === 'cancelled',
                        )
                      : null}
                  </>
                ) : null}
                <Refresh
                  busy={result.isFetching}
                  onClick={() => void result.refetch()}
                />
              </>
            }
          />
          {result.error ? (
            <BillingError
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : !row || (!rules && !s) ? (
            <LoadingRows />
          ) : rules ? (
            <>
              <Group title={t('split.rules')}>
                <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                  <Value label={t('split.fields.version')}>{row.version}</Value>
                  <Value label={t('split.fields.effectiveFrom')}>
                    <Day value={row.effectiveFrom} />
                  </Value>
                  <Value label={t('split.fields.enabled')}>
                    {t(`split.states.${row.enabled}`)}
                  </Value>
                  <Value label={t('split.fields.billFeeTypes')}>
                    {row.payload.billFeeTypes
                      .map((k) => t(`billing.fees.${k}`))
                      .join(' / ')}
                  </Value>
                </dl>
              </Group>
              <Group title={t('split.recipients')}>
                {row.payload.recipients.map((r) => (
                  <p key={r.key}>
                    {r.name} · {t(`split.roles.${r.kind}`)} · {r.accountLabel} ·{' '}
                    {r.rate}%
                  </p>
                ))}
              </Group>
              <LongText>{row.payload.notes}</LongText>
            </>
          ) : s ? (
            <>
              <Badge variant='secondary'>
                {t(`split.states.${row.status}`)}
              </Badge>
              {row.closed ? (
                <p>{t('split.closed')}</p>
              ) : !currentReview ? (
                <p>{t('split.stale')}</p>
              ) : null}
              {BigInt(s.fundingGapCents) > 0n ? <p>{t('split.gap')}</p> : null}
              <SplitAmounts
                values={{
                  sourceFundsCents: row.sourceFundsCents,
                  netPaidCents: row.netPaidCents,
                  remainingCents: row.remainingCents,
                  recoveryCents: row.recoveryCents,
                }}
              />
              <Group title={t('split.sources')}>
                <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                  {[
                    'merchantName',
                    'contractNumber',
                    'sourceNumber',
                    'sourceStart',
                  ].map((k) => (
                    <Value key={k} label={t(`split.fields.${k}`)}>
                      {k === 'contractNumber' ? (
                        <Link
                          className='underline'
                          to={{
                            pathname: path + '/contract/' + row.contractId,
                            search: l.search,
                          }}
                        >
                          {s.contractNumber}
                        </Link>
                      ) : k === 'sourceNumber' ? (
                        <Link
                          className='underline'
                          to={{
                            pathname:
                              path + '/' + row.sourceKind + '/' + row.sourceId,
                            search: l.search,
                          }}
                        >
                          {s.sourceNumber}
                        </Link>
                      ) : k === 'sourceStart' ? (
                        <Day value={s.sourceStart} />
                      ) : (
                        s.merchantName
                      )}
                    </Value>
                  ))}
                  <Value label={t('split.fields.version')}>
                    <Link
                      className='underline'
                      to={{
                        pathname: path + '/rule/' + s.rule.id,
                        search: l.search,
                      }}
                    >
                      {s.rule.version}
                    </Link>
                  </Value>
                </dl>
                <SplitAmounts
                  values={{
                    shareBaseCents: s.shareBaseCents,
                    retainedTargetCents: s.retainedTargetCents,
                    costTargetCents: s.costTargetCents,
                    fundingGapCents: s.fundingGapCents,
                  }}
                />
              </Group>
              {s.operatingComposition ? (
                <Group title={t('split.sourceBreakdown')}>
                  <SplitAmounts values={s.operatingComposition} />
                </Group>
              ) : null}
              <Group title={t('split.sourceEntries')}>
                {!row.sourceRows.meta.total ? (
                  <p>{t('split.noSourceEntries')}</p>
                ) : null}
                {row.sourceRows.data.map((entry) => (
                  <p key={entry.allocationId ?? entry.id}>
                    {entry.kind === 'receipt' ? (
                      <Link
                        className='underline'
                        to={{
                          pathname: path + '/receipt/' + entry.id,
                          search: l.search,
                        }}
                      >
                        {entry.number}
                      </Link>
                    ) : (
                      entry.number
                    )}{' '}
                    · <Money cents={entry.amountCents} />
                    {entry.allocationId ? (
                      <Truncated>{entry.allocationId}</Truncated>
                    ) : null}
                  </p>
                ))}
                <Paged
                  meta={row.sourceRows.meta}
                  busy={result.isFetching}
                  onChange={(page) =>
                    setQuery((old) => {
                      const n = new URLSearchParams(old);
                      n.set('sourcesPage', String(page));
                      return n;
                    })
                  }
                />
              </Group>
              {s.feeComposition?.length ? (
                <Group title={t('split.feeComposition')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          'feeType',
                          'amountCents',
                          'cashCents',
                          'included',
                        ].map((k) => (
                          <TableHead
                            key={k}
                            className={
                              k === 'amountCents' || k === 'cashCents'
                                ? 'text-right'
                                : undefined
                            }
                          >
                            {t(`split.fields.${k}`)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.feeComposition.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell>
                            {t(`billing.fees.${f.feeType}`)}
                          </TableCell>
                          <TableCell className='text-right'>
                            <Money cents={f.amountCents} />
                          </TableCell>
                          <TableCell className='text-right'>
                            <Money cents={f.cashCents} />
                          </TableCell>
                          <TableCell>
                            <Badge variant='secondary'>
                              {t(
                                f.included
                                  ? 'split.included'
                                  : 'split.excluded',
                              )}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p>
                    {t('split.excludedDeposit')}{' '}
                    <Money cents={s.excludedDepositCents ?? '0'} />
                  </p>
                </Group>
              ) : null}
              <Group title={t('split.recipients')}>
                <RecipientTable lines={s.lines} />
              </Group>
              {(['payments', 'transfers', 'attempts', 'revisions'] as const)
                .filter(
                  (k) => k !== 'payments' || row.sourceKind === 'settlement',
                )
                .map((k) => (
                  <Group
                    key={k}
                    title={t(
                      k === 'payments' ? 'hyl.copy.payments' : `split.${k}`,
                    )}
                  >
                    <div className='overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {[
                              'createdAt',
                              k === 'revisions' ? 'version' : 'kind',
                              'amountCents',
                              'reference',
                              'evidence',
                              'reason',
                              'actions',
                            ].map((h) => (
                              <TableHead
                                key={h}
                                className={
                                  h === 'amountCents' || h === 'version'
                                    ? 'text-right'
                                    : undefined
                                }
                              >
                                {[
                                  'createdAt',
                                  'amountCents',
                                  'version',
                                ].includes(h) &&
                                k !== 'payments' &&
                                !(h === 'amountCents' && k === 'revisions') ? (
                                  <button
                                    type='button'
                                    onClick={() =>
                                      setQuery((old) => {
                                        const n = new URLSearchParams(old);
                                        const field =
                                            h === 'version' ? 'revision' : h,
                                          oldSort =
                                            n.get(k + 'Order') ?? '-createdAt';
                                        n.set(
                                          k + 'Order',
                                          oldSort === field
                                            ? '-' + field
                                            : field,
                                        );
                                        n.delete(k + 'Page');
                                        return n;
                                      })
                                    }
                                  >
                                    {t(`split.fields.${h}`)}
                                  </button>
                                ) : (
                                  t(
                                    `split.fields.${k === 'payments' && h === 'createdAt' ? 'date' : h}`,
                                  )
                                )}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {row[k].data.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell>
                                {k === 'payments' ? (
                                  <Day value={e.createdAt} />
                                ) : (
                                  <RecordedAt value={e.createdAt} />
                                )}
                              </TableCell>
                              <TableCell>
                                {e.revision ?? (
                                  <Badge variant='secondary'>
                                    {t(
                                      e.kind
                                        ? `split.roles.${e.kind}`
                                        : `split.states.${e.status}`,
                                    )}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className='text-right'>
                                {e.amountCents ? (
                                  <Money cents={e.amountCents} />
                                ) : e.payload.sourceFundsCents ? (
                                  <Money
                                    cents={scalar(e.payload.sourceFundsCents)}
                                  />
                                ) : e.payload.amount ? (
                                  <Money value={scalar(e.payload.amount)} />
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <Truncated>
                                  {e.reference ||
                                    scalar(e.payload.reference ?? '—')}
                                </Truncated>
                              </TableCell>
                              <TableCell>
                                <LongText>
                                  {scalar(e.payload.evidence ?? '—')}
                                </LongText>
                              </TableCell>
                              <TableCell>
                                <LongText>
                                  {scalar(
                                    e.payload.reason ??
                                      e.payload.failureReason ??
                                      '—',
                                  )}
                                </LongText>
                              </TableCell>
                              <TableCell>
                                {k === 'transfers' &&
                                ['partnerPay', 'recover'].includes(
                                  e.kind ?? '',
                                ) &&
                                allowed.includes('splitRecover') &&
                                allowed.includes('splitExecute') &&
                                !row.closed ? (
                                  link('reverse/' + e.id, 'reverse')
                                ) : k === 'revisions' ? (
                                  <details>
                                    <summary>{t('split.preview')}</summary>
                                    <RecipientTable
                                      lines={(e.payload.lines ?? []) as Line[]}
                                    />
                                  </details>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <Paged
                      meta={row[k].meta}
                      busy={result.isFetching}
                      onChange={(page) =>
                        setQuery((old) => {
                          const n = new URLSearchParams(old);
                          n.set(k + 'Page', String(page));
                          return n;
                        })
                      }
                    />
                  </Group>
                ))}
              <Group title={t('split.review')}>
                <LongText>
                  {(row.payload.history ?? [])
                    .map((v) => {
                      const h = v as Record<string, unknown>;
                      return [
                        scalar(h.at),
                        scalar(h.actor),
                        scalar(h.evidence),
                        scalar(h.reason),
                      ]
                        .filter(Boolean)
                        .join(' · ');
                    })
                    .join('\n') || '—'}
                </LongText>
              </Group>
              <p className='text-sm text-muted-foreground'>
                {t('split.reviewHelp')}
              </p>
              {row.sourceKind === 'settlement' ? (
                <p>{t('split.settlementHelp')}</p>
              ) : null}
            </>
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
export function RecipientTable({ lines }: { lines: Line[] }) {
  const { t } = useTranslation();
  const columns = [
    'targetCents',
    'grossPaidCents',
    'recoveredCents',
    'netPaidCents',
    'remainingCents',
    'recoveryCents',
  ] as const;
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('split.fields.name')}</TableHead>
            <TableHead>{t('split.fields.kind')}</TableHead>
            <TableHead>{t('split.fields.accountLabel')}</TableHead>
            <TableHead>{t('split.fields.rate')}</TableHead>
            <TableHead>{t('split.fields.status')}</TableHead>
            {columns.map((k) => (
              <TableHead key={k} className='text-right'>
                {t(`split.fields.${k}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((r) => (
            <TableRow key={r.key}>
              <TableCell>
                <Truncated>{r.name || t(`split.roles.${r.kind}`)}</Truncated>
              </TableCell>
              <TableCell>
                <Badge variant='secondary'>{t(`split.roles.${r.kind}`)}</Badge>
              </TableCell>
              <TableCell>
                <Truncated>{r.accountLabel || '—'}</Truncated>
              </TableCell>
              <TableCell>{r.rate ? r.rate + '%' : '—'}</TableCell>
              <TableCell>
                <Badge variant='secondary'>
                  {t(
                    `split.states.${BigInt(r.recoveryCents) > 0n ? 'adjustmentPending' : BigInt(r.remainingCents) > 0n ? 'ready' : 'completed'}`,
                  )}
                </Badge>
              </TableCell>
              {columns.map((k) => (
                <TableCell key={k} className='text-right'>
                  <Money cents={r[k]} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
