import { today } from './helpers.js';
import { useWork } from './work.js';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Field, FieldLabel } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '#components/ui/table';
import { useBusinessPermission } from '../hyl/hooks.js';
import {
  DateField,
  Choice,
  FormField,
  Group,
  Amounts,
  Money,
  Day,
  RecordedAt,
  Footer,
  Confirm,
  BillingError,
} from './common.js';
import type { Report, CashRow, CashEvent } from './types.js';
export function EventTable({
  events,
  path,
  search,
}: {
  events: CashEvent[];
  path?: string;
  search?: string;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  return (
    <>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'source',
                'createdAt',
                'date',
                'category',
                'kind',
                'method',
                'amount',
                'actor',
              ].map((k) => (
                <TableHead
                  key={k}
                  className={k === 'amount' ? 'text-right' : ''}
                >
                  {t(`cashier.fields.${k}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.slice((page - 1) * 20, page * 20).map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  {path ? (
                    <Link
                      className='underline'
                      to={{
                        pathname: e.receiptId
                          ? `${path}/receiptDetail/${e.receiptId}`
                          : `${path}/contract/${e.contractId}`,
                        search,
                      }}
                    >
                      {e.number}
                    </Link>
                  ) : (
                    e.number
                  )}
                </TableCell>
                <TableCell>
                  <RecordedAt value={e.at} />
                </TableCell>
                <TableCell>
                  <Day value={e.date} />
                </TableCell>
                <TableCell>{t(`cashier.categories.${e.category}`)}</TableCell>
                <TableCell>{t(`cashier.kinds.${e.kind}`)}</TableCell>
                <TableCell>{t(`cashier.methods.${e.method}`)}</TableCell>
                <TableCell className='text-right'>
                  <Money cents={e.amountCents} />
                </TableCell>
                <TableCell>{e.actor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {t('hyl.actions.previous')}
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil(events.length / 20))}
        </span>
        <Button
          type='button'
          variant='outline'
          disabled={page * 20 >= events.length}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('hyl.actions.next')}
        </Button>
      </div>
    </>
  );
}
export function ChannelTable({ report }: { report: Report }) {
  const { t } = useTranslation();
  return (
    <Group title={t('cashier.channelTotals')}>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'method',
                'receivedCents',
                'outCents',
                'correctionCents',
                'netCents',
              ].map((k) => (
                <TableHead
                  key={k}
                  className={k === 'method' ? '' : 'text-right'}
                >
                  {t(`cashier.fields.${k}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(report.channels).map(([method, values]) => (
              <TableRow key={method}>
                <TableCell>{t(`cashier.methods.${method}`)}</TableCell>
                {(
                  [
                    'receivedCents',
                    'outCents',
                    'correctionCents',
                    'netCents',
                  ] as const
                ).map((k) => (
                  <TableCell key={k} className='text-right'>
                    <Money cents={values[k]} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Group>
  );
}
export default function Reconciliation() {
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    navigate = useNavigate(),
    api = useApiClient(),
    toaster = useToaster(),
    cache = useQueryClient(),
    w = useWork(),
    can = useBusinessPermission('contracts', 'cashierReconcile'),
    all = useBusinessPermission('contracts', 'cashierReconcileAll');
  const [day, setDay] = useState(
      () => new URLSearchParams(l.search).get('cashierDay') || today(),
    ),
    [scope, setScope] = useState<'own' | 'authorized'>(() =>
      new URLSearchParams(l.search).get('cashierScope') === 'authorized'
        ? 'authorized'
        : 'own',
    ),
    [report, setReport] = useState<Report>(),
    [countedCash, setCountedCash] = useState(''),
    [evidence, setEvidence] = useState(''),
    [differenceReason, setDifferenceReason] = useState(''),
    [notes, setNotes] = useState(''),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false);
  const parent = path.replace(/\/(new|reconciliationNew)$/, '');
  const preview = async () => {
    if (!day) {
      w.focus({ day: t('cashier.required') });
      return;
    }
    w.setBusy(true);
    w.setError(undefined);
    try {
      const response = await api.request<{ data: Report }>({
        path: 'cashierReconciliationPreview',
        query: { day, scope },
      });
      setReport(response.data);
      setRequestId(crypto.randomUUID());
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const validate = (values = { countedCash, evidence, differenceReason }) => {
    const { countedCash, evidence, differenceReason } = values;
    const e: Record<string, string> = {};
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(countedCash))
      e.countedCash = t('cashier.nonnegative');
    if (!evidence.trim()) e.evidence = t('cashier.required');
    if (
      report &&
      /^\d{1,12}(\.\d{1,2})?$/.test(countedCash) &&
      BigInt(
        countedCash
          .replace('.', '')
          .padEnd(countedCash.split('.')[0].length + 2, '0'),
      ) !== BigInt(report.cashCents) &&
      !differenceReason.trim()
    )
      e.differenceReason = t('cashier.differenceReason');
    return e;
  };
  const record = async () => {
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: CashRow }>({
        path: 'cashierReconciliations',
        method: 'POST',
        json: {
          requestId,
          day,
          scope,
          sourceHash: report!.sourceHash,
          countedCash,
          evidence,
          differenceReason,
          notes,
        },
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('cashier.reconciled', { number: r.data.number }),
        type: 'success',
      });
      w.setBusy(false);
      setConfirm(false);
      void navigate({
        pathname: path.endsWith('reconciliationNew')
          ? `${parent}/reconciliation/${r.data.id}`
          : `${parent}/${r.data.id}`,
        search: l.search,
      });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const close = () => {
    if (w.busy) return;
    if (countedCash || evidence) {
      setDiscard(true);
      return;
    }
    void navigate({ pathname: parent, search: l.search });
  };
  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        <BackButton
          to={{ pathname: parent, search: l.search }}
          onClick={(e) => {
            e.preventDefault();
            close();
          }}
        />
        <PageHeader
          title={t('cashier.newReconciliation')}
          description={t('cashier.recordingHelp')}
        />
        {!can.can ? (
          <p>{t('billing.restricted')}</p>
        ) : (
          <form
            noValidate
            className='flex flex-col gap-6'
            onSubmit={(e) => {
              e.preventDefault();
              if (!report) void preview();
              else if (w.focus(validate())) setConfirm(true);
            }}
          >
            {w.error ? <BillingError error={w.error} /> : null}
            {w.conflict ? (
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={() => void preview()}
              >
                {t('cashier.reload')}
              </Button>
            ) : null}
            <Group title={t('cashier.fields.scope')}>
              <Field>
                <FieldLabel htmlFor='cashier-day'>
                  {t('cashier.fields.day')} *
                </FieldLabel>
                <DateField
                  id='cashier-day'
                  value={day}
                  disabled={w.busy}
                  onChange={(d) => {
                    setDay(d);
                    setReport(undefined);
                  }}
                />
              </Field>
              {all.can ? (
                <Field>
                  <FieldLabel>{t('cashier.fields.scope')} *</FieldLabel>
                  <Choice
                    ariaLabel={t('cashier.fields.scope')}
                    value={scope}
                    onChange={(s) => {
                      setScope(s as typeof scope);
                      setReport(undefined);
                    }}
                    disabled={w.busy}
                    options={['own', 'authorized'].map((value) => ({
                      value,
                      label: t(`cashier.${value}`),
                    }))}
                  />
                </Field>
              ) : (
                <span>{t('cashier.own')}</span>
              )}
            </Group>
            {report ? (
              <>
                <Amounts
                  labels={{ refundedCents: 'cashier.fields.grossRefundCents' }}
                  values={{
                    receivedCents: report.receivedCents,
                    refundedCents: report.refundedCents,
                    netCents: report.netCents,
                    cashCents: report.cashCents,
                  }}
                />
                <ChannelTable report={report} />
                {report.unclassified ? (
                  <Alert>
                    <AlertDescription>
                      {t('cashier.unclassified')}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <p className='text-muted-foreground'>
                  {t('cashier.payablesExcluded')}
                </p>
                <Group title={t('cashier.sources')}>
                  <EventTable events={report.events} />
                </Group>
                <Group title={t('cashier.reconciliations')}>
                  <FormField
                    name='countedCash'
                    label={t('cashier.fields.countedCash')}
                    value={countedCash}
                    onChange={(v) => {
                      setCountedCash(v);
                      if (w.attempted)
                        w.setErrors(
                          validate({
                            countedCash: v,
                            evidence,
                            differenceReason,
                          }),
                        );
                    }}
                    required
                    decimal
                    disabled={w.busy}
                    error={w.errors.countedCash}
                  />
                  <FormField
                    name='evidence'
                    label={t('cashier.fields.evidence')}
                    value={evidence}
                    onChange={(v) => {
                      setEvidence(v);
                      if (w.attempted)
                        w.setErrors(
                          validate({
                            countedCash,
                            evidence: v,
                            differenceReason,
                          }),
                        );
                    }}
                    required
                    disabled={w.busy}
                    error={w.errors.evidence}
                  />
                  <FormField
                    name='differenceReason'
                    label={t('cashier.fields.reason')}
                    value={differenceReason}
                    onChange={(v) => {
                      setDifferenceReason(v);
                      if (w.attempted)
                        w.setErrors(
                          validate({
                            countedCash,
                            evidence,
                            differenceReason: v,
                          }),
                        );
                    }}
                    required={
                      Number(countedCash) * 100 !== Number(report.cashCents)
                    }
                    disabled={w.busy}
                    error={w.errors.differenceReason}
                  />
                  <FormField
                    name='notes'
                    label={t('cashier.fields.notes')}
                    value={notes}
                    onChange={setNotes}
                    multiline
                    disabled={w.busy}
                  />
                </Group>
              </>
            ) : null}
            <Footer
              busy={w.busy}
              onCancel={close}
              onPreview={() => void preview()}
              reviewed={!!report}
              label={t('cashier.reconcile')}
            />
          </form>
        )}
        <Confirm
          open={confirm}
          onOpenChange={setConfirm}
          title={t('cashier.confirmation', {
            action: t('cashier.reconcileAction'),
            number: day,
          })}
          busy={w.busy}
          onConfirm={() => void record()}
          label={t('cashier.reconcile')}
        >
          {t('cashier.reconcileConfirm', {
            expected: (Number(report?.cashCents ?? 0) / 100).toFixed(2),
            counted: countedCash,
            difference: (
              Number(countedCash) -
              Number(report?.cashCents ?? 0) / 100
            ).toFixed(2),
          })}
        </Confirm>
        <Confirm
          open={discard}
          onOpenChange={setDiscard}
          title={t('cashier.discardTitle')}
          busy={w.busy}
          onConfirm={() =>
            void navigate({ pathname: parent, search: l.search })
          }
          destructive
          label={t('cashier.discard')}
        >
          {t('cashier.discardDescription')}
        </Confirm>
      </PageContainer>
    </RouteChildPage>
  );
}
