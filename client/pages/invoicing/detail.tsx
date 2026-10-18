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
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  endpoint,
  kindFrom,
  type Item,
  type Page,
  type ConfigValues,
} from './types.js';
import {
  Metrics,
  Details,
  Group,
  LongNotes,
  PartySnapshot,
  ChildTable,
  Refresh,
  LoadingRows,
  BillingError,
} from './common.js';
type Detail = Item & {
  lines?: Page<Record<string, unknown>>;
  cash?: Page<Record<string, unknown>>;
  deposits?: Page<Record<string, unknown>>;
  invoices?: Page<Record<string, unknown>>;
  history?: Page<Record<string, unknown>>;
  credits?: Page<Record<string, unknown>>;
  members?: Page<Record<string, unknown>>;
  attempts?: Page<Record<string, unknown>>;
  config?: { payload: ConfigValues };
  sample?: Record<string, string>[];
};
export default function InvoiceDetail() {
  useCoverFocus();
  const { t } = useTranslation(),
    p = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    [q, setQ] = useSearchParams(),
    kind = kindFrom(path),
    id =
      kind === 'sources'
        ? p.invoiceSourceId
        : kind === 'configs'
          ? p.invoiceConfigId
          : (p.originalInvoiceId ?? p.invoiceId),
    result = useBusinessQuery<{ data: Detail }>(
      endpoint(kind) + '/' + id,
      Object.fromEntries(
        [...q.entries()]
          .filter(([k]) => k.startsWith('invoiceDetail:' + path + ':'))
          .map(([k, v]) => [
            k.slice(('invoiceDetail:' + path + ':').length),
            v,
          ]),
      ),
    ),
    row = result.data?.data,
    parent = /\/(invoice|original|source)\/[^/]+$/.test(path)
      ? path.replace(/\/(invoice|original|source)\/[^/]+$/, '')
      : path.slice(0, path.lastIndexOf('/')),
    leaf = path.includes('/original/') || path.includes('/source/'),
    set = (k: string, v: string) =>
      setQ((old) => {
        const n = new URLSearchParams(old);
        n.set('invoiceDetail:' + path + ':' + k, v);
        if (k.endsWith('Order'))
          n.delete('invoiceDetail:' + path + ':' + k.slice(0, -5));
        return n;
      }),
    action = (suffix: string, key: string, disabled = false) => (
      <Button
        key={key}
        disabled={disabled}
        nativeButton={false}
        render={
          <Link to={{ pathname: path + '/' + suffix, search: l.search }} />
        }
      >
        {t('invoice.' + key)}
      </Button>
    );
  const source = row?.payload as {
      billNumber?: string;
      contractNumber?: string;
      merchantName?: string;
    },
    buyer = row?.payload.buyer as ConfigValues['buyer'] | undefined,
    seller = row?.payload.seller as ConfigValues['seller'] | undefined;
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton
            to={{
              pathname: parent,
              search: (() => {
                const back = new URLSearchParams(l.search);
                for (const k of [...back.keys()])
                  if (k.startsWith('invoiceDetail:' + path + ':'))
                    back.delete(k);
                return back.toString();
              })(),
            }}
          />
          <PageHeader
            title={row?.number ?? t('invoice.' + kind)}
            description={t('invoice.simulated')}
            actions={
              <>
                {row && !leaf ? (
                  kind === 'sources' ? (
                    row.status === 'redRequired' ? (
                      <Button
                        onClick={() =>
                          document
                            .getElementById('invoice-related')
                            ?.scrollIntoView()
                        }
                      >
                        {t('invoice.processRed')}
                      </Button>
                    ) : row.allowedActions.includes('invoiceIssue') ? (
                      action(
                        'issue',
                        'issue',
                        BigInt(String(row.availableCents)) === 0n,
                      )
                    ) : null
                  ) : kind === 'configs' ? (
                    row.allowedActions.includes('invoiceConfigure') ? (
                      action('newVersion', 'newVersion')
                    ) : null
                  ) : row.kind === 'blue' &&
                    row.allowedActions.includes('invoiceRed') ? (
                    action(
                      'red',
                      'red',
                      BigInt(String(row.remainingRedCents)) === 0n,
                    )
                  ) : null
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
          ) : !row ? (
            <LoadingRows />
          ) : (
            <>
              <Badge variant='secondary'>
                {t('invoice.states.' + (row.status ?? String(row.enabled)))}
              </Badge>
              {kind === 'sources' ? (
                <>
                  <Metrics
                    row={row}
                    keys={[
                      'paidCents',
                      'selectedPaidCents',
                      'netIssuedCents',
                      'availableCents',
                      'requiredRedCents',
                    ]}
                  />
                  <Group title={t('invoice.members')}>
                    <Details
                      values={{
                        merchantName: source.merchantName,
                        contractNumber: source.contractNumber,
                        billNumber: source.billNumber,
                      }}
                    />
                    {!leaf ? (
                      <div className='flex flex-wrap gap-2'>
                        {['bill', 'contract'].map((k) => (
                          <Button
                            key={k}
                            variant='outline'
                            nativeButton={false}
                            render={
                              <Link
                                to={{
                                  pathname:
                                    path +
                                    '/' +
                                    k +
                                    '/' +
                                    (k === 'bill'
                                      ? row.billId
                                      : row.contractId),
                                  search: l.search,
                                }}
                              />
                            }
                          >
                            {t(
                              'invoice.fields.' +
                                (k === 'bill'
                                  ? 'billNumber'
                                  : 'contractNumber'),
                            )}
                          </Button>
                        ))}
                        {row.allowedActions.includes('invoiceConfigure') ? (
                          <Button
                            variant='outline'
                            nativeButton={false}
                            render={
                              <Link
                                to={{
                                  pathname: path + '/config',
                                  search: l.search,
                                }}
                              />
                            }
                          >
                            {t('invoice.configuration')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </Group>
                </>
              ) : kind === 'invoices' ? (
                <>
                  <Metrics
                    row={row}
                    keys={[
                      'grossCents',
                      'netCents',
                      'taxCents',
                      'redGrossCents',
                      'remainingRedCents',
                    ]}
                  />
                  <Group title={t('invoice.party')}>
                    <Details
                      values={{
                        buyerName: buyer?.name,
                        sellerName: seller?.name,
                        taxNo: [buyer?.taxNo, seller?.taxNo].join(' / '),
                        mode: t(
                          'invoice.' +
                            (row.payload.mode === 'systemSimulation'
                              ? 'systemSimulation'
                              : 'manualSimulation'),
                        ),
                        actor: scalar(row.payload.actor) || '—',
                        configAuthorizers: Array.isArray(
                          row.payload.configAuthorizers,
                        )
                          ? row.payload.configAuthorizers.join(', ')
                          : '—',
                      }}
                    />
                    {row.originalInvoiceId && !leaf ? (
                      <Button
                        variant='outline'
                        nativeButton={false}
                        render={
                          <Link
                            to={{
                              pathname:
                                path +
                                '/original/' +
                                scalar(row.originalInvoiceId),
                              search: l.search,
                            }}
                          />
                        }
                      >
                        {t('invoice.original')}
                      </Button>
                    ) : null}
                  </Group>
                </>
              ) : (
                <>
                  <Group title={t('invoice.settings')}>
                    <Details
                      values={{
                        contractId: row.contractId,
                        version: row.version,
                        enabled: t('invoice.states.' + String(row.enabled)),
                        autoIssue: t('invoice.states.' + String(row.autoIssue)),
                      }}
                    />
                  </Group>
                  <Group title={t('invoice.party')}>
                    <Details
                      values={{
                        buyerName: buyer?.name,
                        sellerName: seller?.name,
                        taxNo: [buyer?.taxNo, seller?.taxNo].join(' / '),
                      }}
                    />
                  </Group>
                  <Group title={t('invoice.sample')}>
                    {row.sample?.map((r) => (
                      <div key={r.feeType}>
                        <p>{t('billing.fees.' + r.feeType)}</p>
                        <Metrics
                          row={r}
                          keys={['grossCents', 'netCents', 'taxCents']}
                        />
                      </div>
                    ))}
                  </Group>
                  <Group title={t('invoice.fees')}>
                    {((row.payload.fees ?? []) as ConfigValues['fees']).map(
                      (f) => (
                        <p key={f.feeType}>
                          {t('billing.fees.' + f.feeType)} · {f.taxItemName} ·{' '}
                          {f.rate}%
                        </p>
                      ),
                    )}
                  </Group>
                </>
              )}
              {row.status === 'redRequired' ? (
                <Alert>
                  <AlertDescription>{t('invoice.processRed')}</AlertDescription>
                </Alert>
              ) : null}
              <div id='invoice-related' className='flex flex-col gap-4'>
                {(
                  [
                    'lines',
                    'cash',
                    'deposits',
                    'invoices',
                    'credits',
                    'members',
                    'history',
                    'attempts',
                  ] as const
                ).map((name) => (
                  <ChildTable
                    key={name}
                    name={name}
                    page={row[name]}
                    columns={
                      name === 'lines'
                        ? kind === 'sources'
                          ? [
                              'feeType',
                              'amountCents',
                              'included',
                              'paidCents',
                              'netIssuedCents',
                              'availableCents',
                              'requiredRedCents',
                            ]
                          : [
                              'feeType',
                              'taxItemName',
                              'code',
                              'rate',
                              'configVersion',
                              'configAuthorizer',
                              'grossCents',
                              'netCents',
                              'taxCents',
                              'remainingCents',
                            ]
                        : name === 'cash' || name === 'deposits'
                          ? name === 'cash'
                            ? ['number', 'amountCents', 'createdAt']
                            : ['createdAt', 'amountCents']
                          : name === 'invoices' || name === 'credits'
                            ? ['number', 'grossCents', 'status', 'issuedAt']
                            : name === 'members'
                              ? ['billNumber']
                              : name === 'history'
                                ? kind === 'configs'
                                  ? ['version', 'createdAt']
                                  : [
                                      'revision',
                                      'paidCents',
                                      'netIssuedCents',
                                      'requiredRedCents',
                                      'createdAt',
                                    ]
                                : ['createdAt', 'grossCents', 'status']
                    }
                    set={set}
                    order={
                      q.get('invoiceDetail:' + path + ':' + name + 'Order') ??
                      (name === 'history' ||
                      name === 'attempts' ||
                      name === 'credits'
                        ? '-createdAt'
                        : 'id')
                    }
                    link={
                      leaf
                        ? undefined
                        : name === 'invoices' || name === 'credits'
                          ? (r) => path + '/invoice/' + String(r.id)
                          : name === 'members'
                            ? (r) => path + '/source/' + String(r.sourceId)
                            : name === 'cash'
                              ? (r) => path + '/receipt/' + String(r.receiptId)
                              : undefined
                    }
                  />
                ))}
              </div>
              {kind !== 'sources' ? (
                <>
                  <Group title={t('invoice.fields.buyer')}>
                    <PartySnapshot party={buyer} />
                  </Group>
                  <Group title={t('invoice.fields.seller')}>
                    <PartySnapshot party={seller} />
                  </Group>
                </>
              ) : null}
              <LongNotes values={row.payload} />
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
