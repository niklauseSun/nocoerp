import { useBusinessIdentity } from '../hyl/hooks.js';
import { scalar, kindFrom, endpoint, useEnergyCan } from './helpers.js';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useState, useEffect } from 'react';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useWork } from '../cashier/work.js';
import {
  type Item,
  type Page,
  State,
  Values,
  Notes,
  Group,
  Paged,
  Truncated,
  Refresh,
  BillingError,
  LoadingRows,
  Confirm,
  Money,
  Quantity,
  Day,
  RecordedAt,
} from './common.js';
type Detail = Item & {
  assignments: Page<Item>;
  readings: Page<Item>;
  bills: Page<Item>;
  audit: Page<Item>;
};
export default function EnergyDetail(props: { readOnly?: boolean } = {}) {
  const params = useParams();
  return (
    <EnergyDetailContent
      key={`${params.energyMeterId ?? ''}:${params.energyReadingId ?? ''}`}
      {...props}
    />
  );
}
function EnergyDetailContent({
  readOnly = false,
}: { readOnly?: boolean } = {}) {
  useCoverFocus();
  const businessIdentity = useBusinessIdentity();
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    [q, setQ] = useSearchParams(),
    kind = kindFrom(path) === 'meters' ? 'meters' : 'readings',
    id = kind === 'meters' ? p.energyMeterId : p.energyReadingId,
    read = useEnergyCan(kind === 'meters' ? 'meterRead' : 'readingRead'),
    result = useBusinessQuery<{ data: Detail }>(
      endpoint(kind) + '/' + id,
      Object.fromEntries(
        [...q.entries()]
          .filter(([k]) => k.startsWith('energyDetail:' + path + ':'))
          .map(([k, v]) => [k.slice(('energyDetail:' + path + ':').length), v]),
      ),
      read.can,
    ),
    row = result.isPlaceholderData ? undefined : result.data?.data,
    parent = /\/(meter|reading)\/[^/]+$/.test(path)
      ? path.replace(/\/(meter|reading)\/[^/]+$/, '')
      : path.slice(0, path.lastIndexOf('/')),
    leaf = readOnly,
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    w = useWork(),
    [approve, setApprove] = useState(false),
    [approvalId, setApprovalId] = useState(() => crypto.randomUUID()),
    [approvalSnapshot, setApprovalSnapshot] = useState<Item>(),
    [approveUnknown, setApproveUnknown] = useState(false);
  useEffect(() => {
    if (result.error instanceof ApiClientError && result.error.status === 404)
      void cache.invalidateQueries({ queryKey: ['hyl', endpoint(kind)] });
  }, [result.error, cache, kind]);
  const back = () => {
      const n = new URLSearchParams(l.search);
      for (const k of [...n.keys()])
        if (k.startsWith('energyDetail:' + path + ':')) n.delete(k);
      return n.toString();
    },
    action = (
      suffix: string,
      label: string,
      variant: 'default' | 'outline' = 'outline',
    ) => (
      <Button
        key={suffix}
        variant={variant}
        disabled={
          suffix === 'void' &&
          !['unbilled', 'released'].includes(scalar(row?.billingStatus))
        }
        nativeButton={false}
        render={
          <Link to={{ pathname: path + '/' + suffix, search: l.search }} />
        }
      >
        {t('energy.' + label)}
      </Button>
    );
  async function doApprove() {
    if (!row) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: Item }>({
        path: 'energyReadings/' + row.id + '/approve',
        method: 'POST',
        json: {
          requestId: approvalId,
          expectedVersion: approvalSnapshot?.version ?? row.version,
          expectedMeterVersion:
            approvalSnapshot?.meterVersion ?? row.meterVersion,
        },
      });
      cache.setQueryData(
        [
          'hyl',
          endpoint(kind) + '/' + id,
          Object.fromEntries(
            [...q.entries()]
              .filter(([k]) => k.startsWith('energyDetail:' + path + ':'))
              .map(([k, v]) => [
                k.slice(('energyDetail:' + path + ':').length),
                v,
              ]),
          ),
          ...businessIdentity,
        ],
        { data: { ...row, ...r.data } },
      );
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      setApprove(false);
      setApproveUnknown(false);
      toast.show({
        title: t('energy.approved', { number: row.number }),
        type: 'success',
      });
    } catch (e) {
      w.fail(e);
      if (!(e instanceof ApiClientError) || e.status >= 500)
        setApproveUnknown(true);
    } finally {
      w.setBusy(false);
    }
  }
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton to={{ pathname: parent, search: back() }} />
          <PageHeader
            title={row?.number ?? t('energy.' + kind)}
            description={scalar(row?.name) || t('energy.description')}
            actions={
              <>
                {row && !leaf ? (
                  kind === 'meters' ? (
                    <>
                      {row.status === 'active' &&
                      row.allowedActions.includes('readingWrite')
                        ? action('readingNew', 'newReading', 'default')
                        : null}
                      {row.allowedActions.includes('meterWrite') ? (
                        <>
                          {action('edit', 'edit')}
                          {row.status === 'active' ? (
                            <>
                              {action('assign', 'assign')}
                              {action('handover', 'handover')}
                              {action('stop', 'stop')}
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {['draft', 'rejected'].includes(row.status) &&
                      row.allowedActions.includes('readingWrite') ? (
                        <>
                          {action('submit', 'submit', 'default')}
                          {action('edit', 'edit')}
                        </>
                      ) : null}
                      {row.status === 'submitted' &&
                      row.allowedActions.includes('readingReview') ? (
                        <>
                          <Button
                            disabled={w.busy}
                            onClick={() => {
                              setApprovalId(crypto.randomUUID());
                              setApprovalSnapshot(row);
                              setApproveUnknown(false);
                              w.setError(undefined);
                              setApprove(true);
                            }}
                          >
                            {t('energy.approve')}
                          </Button>
                          {action('reject', 'reject')}
                        </>
                      ) : null}
                      {['draft', 'rejected', 'approved'].includes(row.status) &&
                      row.allowedActions.includes('readingWrite')
                        ? action('void', 'void')
                        : null}
                    </>
                  )
                ) : null}
                <Refresh
                  busy={result.isFetching}
                  onClick={() => void result.refetch()}
                />
              </>
            }
          />
          {!read.can ? (
            <p>{t('energy.restricted')}</p>
          ) : result.error ? (
            <BillingError
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : !row ? (
            <LoadingRows />
          ) : (
            <>
              {w.error ? <BillingError error={w.error} /> : null}
              <div className='flex flex-wrap gap-2'>
                <State value={row.status} />
                {kind === 'readings' ? (
                  <State value={row.billingStatus} />
                ) : null}
              </div>
              {kind === 'readings' &&
              !['unbilled', 'released'].includes(scalar(row.billingStatus)) ? (
                <p className='text-sm text-muted-foreground'>
                  {t('energy.errors.ENERGY_SOURCE_ALREADY_BILLED')}
                </p>
              ) : null}
              <Group title={t('energy.basic')}>
                <Values
                  values={
                    kind === 'meters'
                      ? {
                          code: row.code,
                          name: row.name,
                          type: t('energy.types.' + scalar(row.type)),
                          asset: row.assetName,
                          installedOn: row.installedOn,
                          openingReading: row.openingReading,
                          multiplier: row.multiplier,
                          unit: row.unit,
                          version: row.version,
                        }
                      : {
                          number: row.number,
                          code: row.meterCode,
                          asset: row.assetName,
                          contract: row.contractNumber,
                          start: row.start,
                          end: row.end,
                          previous: row.previous,
                          current: row.current,
                          multiplier: row.multiplier,
                          usage: row.usage,
                          unit: row.unit,
                          reviewer: row.reviewer,
                          approvedAt: row.approvedAt,
                          version: row.version,
                        }
                  }
                />
                {!leaf ? (
                  <div className='flex flex-wrap gap-2'>
                    {[
                      ['asset', row.assetId],
                      ...(kind === 'readings' && row.contractId
                        ? [['contract', row.contractId]]
                        : []),
                    ].map(([source, id]) => (
                      <Button
                        key={source}
                        variant='outline'
                        nativeButton={false}
                        render={
                          <Link
                            to={{
                              pathname: path + '/' + source + '/' + id,
                              search: l.search,
                            }}
                          />
                        }
                      >
                        {t('energy.fields.' + source)}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {!leaf && kind === 'readings' ? (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: path + '/meter/' + row.meterId,
                          search: l.search,
                        }}
                      />
                    }
                  >
                    {t('energy.meters')}
                  </Button>
                ) : null}
              </Group>
              {(['assignments', 'readings', 'bills', 'audit'] as const).map(
                (name) => {
                  const block = row[name];
                  if (!block) return null;
                  const columns =
                    name === 'assignments'
                      ? [
                          'number',
                          'contractNumber',
                          'start',
                          'end',
                          'openingReading',
                          'closingReading',
                        ]
                      : name === 'readings'
                        ? [
                            'number',
                            'start',
                            'end',
                            'current',
                            'usage',
                            'status',
                          ]
                        : name === 'bills'
                          ? ['number', 'billNumber', 'amountCents', 'status']
                          : ['createdAt', 'action', 'actor', 'reason'];
                  return (
                    <Group key={name} title={t('energy.' + name)}>
                      {block.restricted ? (
                        <p>{t('energy.restricted')}</p>
                      ) : !block.data.length ? (
                        <p className='text-muted-foreground'>
                          {t('energy.empty')}
                        </p>
                      ) : (
                        <div className='overflow-x-auto'>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {columns.map((k) => (
                                  <TableHead
                                    key={k}
                                    aria-sort={
                                      q.get(
                                        'energyDetail:' +
                                          path +
                                          ':' +
                                          name +
                                          'Order',
                                      ) === (k === 'usage' ? 'usageKey' : k)
                                        ? 'ascending'
                                        : (q.get(
                                              'energyDetail:' +
                                                path +
                                                ':' +
                                                name +
                                                'Order',
                                            ) ?? '-createdAt') ===
                                            '-' +
                                              (k === 'usage' ? 'usageKey' : k)
                                          ? 'descending'
                                          : 'none'
                                    }
                                    className={
                                      [
                                        'usage',
                                        'current',
                                        'openingReading',
                                        'closingReading',
                                        'amountCents',
                                      ].includes(k)
                                        ? 'text-right'
                                        : ''
                                    }
                                  >
                                    {[
                                      'start',
                                      'end',
                                      'createdAt',
                                      'current',
                                      'openingReading',
                                      'closingReading',
                                      'usage',
                                      'amountCents',
                                    ].includes(k) ? (
                                      <button
                                        onClick={() =>
                                          setQ((old) => {
                                            const n = new URLSearchParams(old),
                                              key =
                                                'energyDetail:' +
                                                path +
                                                ':' +
                                                name +
                                                'Order',
                                              sort =
                                                k === 'usage' ? 'usageKey' : k;
                                            n.set(
                                              key,
                                              n.get(key) === sort
                                                ? '-' + sort
                                                : sort,
                                            );
                                            n.delete(
                                              'energyDetail:' +
                                                path +
                                                ':' +
                                                name,
                                            );
                                            return n;
                                          })
                                        }
                                      >
                                        {t('energy.fields.' + k)}
                                        {(
                                          q.get(
                                            'energyDetail:' +
                                              path +
                                              ':' +
                                              name +
                                              'Order',
                                          ) ?? '-createdAt'
                                        ).replace(/^-/, '') ===
                                        (k === 'usage' ? 'usageKey' : k)
                                          ? (
                                              q.get(
                                                'energyDetail:' +
                                                  path +
                                                  ':' +
                                                  name +
                                                  'Order',
                                              ) ?? '-createdAt'
                                            ).startsWith('-')
                                            ? ' ↓'
                                            : ' ↑'
                                          : ''}
                                      </button>
                                    ) : (
                                      t('energy.fields.' + k)
                                    )}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {block.data.map((r) => (
                                <TableRow key={r.id}>
                                  {columns.map((k, i) => (
                                    <TableCell
                                      key={k}
                                      className={
                                        [
                                          'usage',
                                          'current',
                                          'amountCents',
                                        ].includes(k)
                                          ? 'text-right'
                                          : ''
                                      }
                                    >
                                      {i === 0 &&
                                      !leaf &&
                                      name === 'readings' &&
                                      kind === 'meters' ? (
                                        <Link
                                          className='underline'
                                          to={{
                                            pathname: path + '/reading/' + r.id,
                                            search: l.search,
                                          }}
                                        >
                                          <Truncated>{r.number}</Truncated>
                                        </Link>
                                      ) : i === 0 &&
                                        !leaf &&
                                        name === 'bills' ? (
                                        <Link
                                          className='underline'
                                          to={{
                                            pathname:
                                              path + '/bill/' + r.billId,
                                            search: l.search,
                                          }}
                                        >
                                          <Truncated>{r.number}</Truncated>
                                        </Link>
                                      ) : ['start', 'end'].includes(k) ? (
                                        <Day value={scalar(r[k])} />
                                      ) : k === 'createdAt' ? (
                                        <RecordedAt value={scalar(r[k])} />
                                      ) : k === 'action' ? (
                                        t(
                                          'energy.events.' +
                                            scalar(r[k]).replace(
                                              /^reading\./,
                                              '',
                                            ),
                                          {
                                            defaultValue: t(
                                              'energy.auditRecorded',
                                            ),
                                          },
                                        )
                                      ) : k === 'status' ? (
                                        <State value={r.status} />
                                      ) : k === 'amountCents' ? (
                                        <Money cents={scalar(r[k]) || '0'} />
                                      ) : [
                                          'usage',
                                          'current',
                                          'openingReading',
                                          'closingReading',
                                        ].includes(k) ? (
                                        <Quantity value={r[k]} />
                                      ) : (
                                        <Truncated>
                                          {scalar(r[k]) || '—'}
                                        </Truncated>
                                      )}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {!block.restricted ? (
                        <Paged
                          meta={block.meta}
                          busy={result.isFetching}
                          onChange={(page) =>
                            setQ((old) => {
                              const n = new URLSearchParams(old);
                              n.set(
                                'energyDetail:' + path + ':' + name,
                                String(page),
                              );
                              return n;
                            })
                          }
                        />
                      ) : null}
                    </Group>
                  );
                },
              )}
              <Group title={t('energy.fields.evidence')}>
                <Notes value={row.evidence ?? row.openingEvidence} />
                <Notes value={row.reason} />
                <Notes value={row.notes} />
              </Group>
            </>
          )}
          <Confirm
            open={approve}
            onOpenChange={(next) => {
              if (!next && approveUnknown) return;
              setApprove(next);
            }}
            title={t('energy.confirmApprove', { number: row?.number })}
            label={t('energy.approve')}
            busy={w.busy}
            onConfirm={() => void doApprove()}
          >
            {t('energy.approveHelp')}
            {approvalSnapshot ? (
              <Values
                values={{
                  number: approvalSnapshot.number,
                  start: approvalSnapshot.start,
                  end: approvalSnapshot.end,
                  usage: approvalSnapshot.usage,
                }}
              />
            ) : null}
            {w.error ? <BillingError error={w.error} /> : null}
            {approveUnknown ? <p>{t('energy.unknown')}</p> : null}
            {w.conflict || approveUnknown ? (
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={() =>
                  void (async () => {
                    await result.refetch();
                    setApproveUnknown(false);
                    setApprove(false);
                    w.setError(undefined);
                  })()
                }
              >
                {t('energy.reload')}
              </Button>
            ) : null}
          </Confirm>
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
