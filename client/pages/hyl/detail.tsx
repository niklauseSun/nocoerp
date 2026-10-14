import { scalar } from './model.js';
import { useBusinessQuery, useBusinessPermission } from './hooks.js';
import { BackButton } from '#components/back-button';
import { LongText } from '#components/long-text';
import {
  Link,
  Outlet,
  useParams,
  useLocation,
  useOutletContext,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import { BusinessStatus } from './status.js';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '#components/ui/table';

import { LoadingRows, ErrorPanel, Refresh } from './common.js';
import {
  amountText,
  availableActions,
  permissionFor,
  specs,
  type BusinessRow,
  type Kind,
} from './model.js';

function ActionLink({ kind, action }: { kind: Kind; action: string }) {
  const can = useBusinessPermission(kind, permissionFor(action)),
    { t } = useTranslation(),
    location = useLocation();
  if (!can.can) return null;
  return (
    <Button
      variant='outline'
      nativeButton={false}
      render={<Link to={{ pathname: action, search: location.search }} />}
    >
      {t(`hyl.actions.${action}`)}
    </Button>
  );
}
export default function BusinessDetail() {
  const { kind } = useOutletContext<{ kind: Kind }>(),
    { id } = useParams(),
    location = useLocation();
  const { t, i18n } = useTranslation();
  const result = useBusinessQuery<{ data: BusinessRow }>(`${kind}/${id}`);
  const row = result.data?.data;
  void location;
  const formatValue = (key: string, value: unknown): string => {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'boolean')
      return t(`hyl.copy.${value ? 'yes' : 'no'}`);
    if (
      [
        'source',
        'method',
        'basis',
        'cycle',
        'responsibility',
        'part',
        'confirmation',
        'category',
      ].includes(key) &&
      i18n.exists(`hyl.enums.${scalar(value)}`)
    )
      return t(`hyl.enums.${scalar(value)}`);
    if (specs[kind].find((f) => f.key === key)?.type === 'money')
      return amountText(value, i18n.language);
    return scalar(value);
  };
  const actions = row ? (
    <div className='flex flex-wrap gap-2'>
      {availableActions(kind, row)
        .filter(
          (action) =>
            action !== 'dispute' || row.confirmationModes?.includes('online'),
        )
        .filter(
          (action) => action !== 'confirm' || row.confirmationModes?.length,
        )
        .map((action) => (
          <ActionLink key={action} kind={kind} action={action} />
        ))}
      <Refresh busy={result.isFetching} onClick={() => void result.refetch()} />
    </div>
  ) : null;
  const short = kind === 'merchants';
  const content = result.isPending ? (
    <LoadingRows />
  ) : result.error ? (
    <ErrorPanel error={result.error} retry={() => void result.refetch()} />
  ) : row ? (
    <div className='flex flex-col gap-6'>
      <BusinessStatus status={row.status} />
      {!short ? actions : null}
      {kind === 'settlements' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('hyl.copy.summary')}</CardTitle>
              <p className='text-sm text-muted-foreground'>
                {scalar(row.payload.start)} — {scalar(row.payload.end)}
              </p>
              <p className='text-sm text-muted-foreground'>
                {t('hyl.copy.formula')}
              </p>
            </CardHeader>
            <CardContent>
              <dl className='grid gap-4 sm:grid-cols-2'>
                {Object.entries(
                  (row.payload.amounts ?? {}) as Record<string, string>,
                ).map(([key, value]) => (
                  <div
                    key={key}
                    className='flex items-center justify-between gap-4'
                  >
                    <dt className='text-sm text-muted-foreground'>
                      {t(`hyl.fields.${key}`)}
                    </dt>
                    <dd className='font-medium tabular-nums'>
                      {amountText(value, i18n.language)}
                    </dd>
                  </div>
                ))}
                <div className='flex justify-between gap-4'>
                  <dt>{t('hyl.fields.paid')}</dt>
                  <dd>
                    {amountText(
                      (row.payments ?? []).reduce(
                        (sum, p) => sum + Number(p.amount),
                        0,
                      ),
                      i18n.language,
                    )}
                  </dd>
                </div>
                <div className='flex justify-between gap-4'>
                  <dt>{t('hyl.fields.remaining')}</dt>
                  <dd>
                    {amountText(
                      Number(
                        (row.payload.amounts as Record<string, string>).payable,
                      ) -
                        (row.payments ?? []).reduce(
                          (sum, p) => sum + Number(p.amount),
                          0,
                        ),
                      i18n.language,
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('hyl.copy.rules')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className='grid grid-cols-[8rem_1fr] gap-4'>
                {specs.contracts
                  .filter((f) => !['merchantId', 'notes'].includes(f.key))
                  .map((f) => (
                    <div key={f.key} className='contents'>
                      <dt className='text-sm text-muted-foreground'>
                        {t(`hyl.fields.${f.key}`)}
                      </dt>
                      <dd className='break-words'>
                        {formatValue(
                          f.key,
                          (row.payload.contract as Record<string, unknown>)[
                            f.key
                          ],
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>
          {(['revenues', 'expenses'] as const).map((key) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle>{t(`hyl.copy.${key}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('hyl.fields.number')}</TableHead>
                        <TableHead>{t('hyl.fields.date')}</TableHead>
                        {(key === 'revenues'
                          ? [
                              'receipts',
                              'refunds',
                              'activity',
                              'cash',
                              'hospitality',
                              'collected',
                            ]
                          : ['category', 'responsibility', 'amount']
                        ).map((field) => (
                          <TableHead key={field} className='text-right'>
                            {t(`hyl.fields.${field}`)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((row.payload[key] ?? []) as BusinessRow[]).map(
                        (item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.number}</TableCell>
                            <TableCell>{item.date}</TableCell>
                            {(key === 'revenues'
                              ? [
                                  'receipts',
                                  'refunds',
                                  'activity',
                                  'cash',
                                  'hospitality',
                                  'collected',
                                ]
                              : ['category', 'responsibility', 'amount']
                            ).map((field) => (
                              <TableCell
                                key={field}
                                className='text-right whitespace-nowrap'
                              >
                                {['category', 'responsibility'].includes(field)
                                  ? formatValue(field, item.payload[field])
                                  : amountText(
                                      item.payload[field],
                                      i18n.language,
                                    )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ),
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle>{t('hyl.copy.payments')}</CardTitle>
            </CardHeader>
            <CardContent>
              {row.payments?.length ? (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {['date', 'reference', 'amount', 'actor'].map((k) => (
                          <TableHead key={k}>{t(`hyl.fields.${k}`)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {row.payments.map((p) => (
                        <TableRow key={scalar(p.reference)}>
                          <TableCell>{scalar(p.date)}</TableCell>
                          <TableCell>{scalar(p.reference)}</TableCell>
                          <TableCell className='text-right'>
                            {amountText(p.amount, i18n.language)}
                          </TableCell>
                          <TableCell>{scalar(p.actor)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('hyl.copy.noItems')}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <dl className='grid grid-cols-[8rem_1fr] gap-4'>
          {specs[kind].map((spec) => (
            <div key={spec.key} className='contents'>
              <dt className='text-sm text-muted-foreground'>
                {t(`hyl.fields.${spec.key}`)}
              </dt>
              <dd className='min-w-0 break-words'>
                {spec.key === 'notes' ? (
                  <LongText>
                    {formatValue(spec.key, row.payload[spec.key])}
                  </LongText>
                ) : spec.key === 'merchantId' ? (
                  row.name
                ) : (
                  formatValue(spec.key, row.payload[spec.key])
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('hyl.copy.events')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='flex flex-col gap-4'>
            {(row.events ?? []).map((event) => {
              const detail = (event.detail ?? {}) as Record<string, unknown>;
              return (
                <div
                  key={scalar(event.at) + scalar(event.action)}
                  className='flex flex-col gap-1 border-b pb-3 text-sm'
                >
                  <p>
                    {i18n.exists(`hyl.actions.${scalar(event.action)}`)
                      ? t(`hyl.actions.${scalar(event.action)}`, {
                          resource: t(`hyl.nav.${kind}`),
                        })
                      : scalar(event.action)}{' '}
                    · {scalar(event.actor)} ·{' '}
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(scalar(event.at)))}
                  </p>
                  {['reason', 'confirmedBy', 'evidence', 'notes'].map((k) =>
                    detail[k] ? (
                      <p key={k} className='break-words text-muted-foreground'>
                        {t(`hyl.fields.${k}`)}：{scalar(detail[k])}
                      </p>
                    ) : null,
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  ) : null;
  return (
    <>
      {short ? (
        <RouteDrawer title={row?.name ?? t(`hyl.nav.${kind}`)} footer={actions}>
          {content}
        </RouteDrawer>
      ) : (
        <RouteChildPage>
          <PageContainer>
            <BackButton />
            <PageHeader title={row?.number ?? t(`hyl.nav.${kind}`)} />
            {content}
          </PageContainer>
        </RouteChildPage>
      )}
      <Outlet context={{ kind, row, reload: () => result.refetch() }} />
    </>
  );
}
