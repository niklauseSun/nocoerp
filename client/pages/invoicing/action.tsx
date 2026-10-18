import { invoiceFieldMessages } from './form-errors.js';
import { useState, useEffect, useCallback } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Field, FieldLabel } from '#components/ui/field';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useWork } from '../cashier/work.js';
import { useBusinessPermission } from '../hyl/hooks.js';
import {
  Group,
  FormField,
  Choice,
  Confirm,
  LoadingRows,
  BillingError,
  Metrics,
  Money,
} from './common.js';
import type {
  Source,
  Invoice,
  InvoiceLine,
  SourceLine,
  Expected,
  Page,
} from './types.js';
type Context = {
  sources: (Omit<Source, 'payload'> & {
    payload: Omit<Source['payload'], 'lines'>;
    lines: Page<SourceLine>;
    config?: {
      payload: {
        buyer: { name: string; taxNo: string };
        seller: { name: string; taxNo: string };
        fees: { feeType: string; taxItemName: string; rate: string }[];
      };
    };
  })[];
  original?: Invoice & {
    lines: Page<
      InvoiceLine & {
        remainingCents: string;
        requiredRedCents?: string;
        billNumber?: string;
        sourceNumber?: string;
      }
    >;
  };
};
type Preview = {
  previewHash: string;
  expectedSources: Expected[];
  grossCents: string;
  netCents: string;
  taxCents: string;
  original?: Invoice;
  lines: InvoiceLine[];
};
export default function InvoiceAction() {
  useCoverFocus();
  const p = useParams(),
    [q] = useSearchParams(),
    path = useResolvedPath('.').pathname,
    red = path.endsWith('/red'),
    api = useApiClient(),
    { t } = useTranslation(),
    can = useBusinessPermission(
      'contracts',
      red ? 'invoiceRed' : 'invoiceIssue',
    ),
    ids = p.invoiceSourceId
      ? [p.invoiceSourceId]
      : (q.get('invoiceSourceIds') ?? '').split(',').filter(Boolean),
    [refresh] = useState(0);
  const result = useQuery({
    queryKey: ['hyl', 'invoiceForm', path, ids, refresh],
    enabled: can.can,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const context: Context = { sources: [] };
      async function all<T extends { id: string }>(
        endpoint: string,
      ): Promise<T & { lines: Page<Record<string, unknown>> }> {
        const first = await api.request<{
          data: T & { lines: Page<Record<string, unknown>> };
        }>({ path: endpoint });
        const lines = [...first.data.lines.data];
        for (let page = 2; lines.length < first.data.lines.meta.total; page++) {
          const r = await api.request<{
            data: { lines: Page<Record<string, unknown>> };
          }>({ path: endpoint, query: { lines: page } });
          lines.push(...r.data.lines.data);
          if (!r.data.lines.data.length) break;
        }
        return { ...first.data, lines: { ...first.data.lines, data: lines } };
      }
      if (red)
        context.original = (await all(
          'invoices/' + p.invoiceId,
        )) as unknown as Context['original'];
      else
        for (const id of ids)
          context.sources.push(
            (await all(
              'invoiceSources/' + id,
            )) as unknown as Context['sources'][number],
          );
      return context;
    },
  });
  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        {!can.can || result.error || !result.data ? (
          <BackButton
            to={{
              pathname: path.slice(0, path.lastIndexOf('/')),
              search: q.toString(),
            }}
          />
        ) : null}
        {!can.can ? (
          <p>{t('invoice.restricted')}</p>
        ) : result.error ? (
          <BillingError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !result.data ? (
          <LoadingRows />
        ) : (
          <ActionEditor
            key={path}
            initial={result.data}
            path={path}
            red={red}
            refresh={() => result.refetch().then((r) => r.data)}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function ActionEditor({
  initial,
  path,
  red,
  refresh,
}: {
  initial: Context;
  path: string;
  red: boolean;
  refresh: () => Promise<Context | undefined>;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    navigate = useNavigate(),
    l = useLocation(),
    w = useWork(),
    parent = path.slice(0, path.lastIndexOf('/')),
    [base, setBase] = useState(initial),
    [amounts, setAmounts] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        red
          ? initial.original!.lines.data.map((l) => [
              l.id,
              decimal(
                BigInt(l.requiredRedCents ?? '0') < BigInt(l.remainingCents)
                  ? (l.requiredRedCents ?? '0')
                  : l.remainingCents,
              ),
            ])
          : initial.sources.flatMap((s) =>
              s.lines.data.map((l) => [
                s.id + ':' + l.id,
                decimal(l.availableCents),
              ]),
            ),
      ),
    ),
    [reasonCode, setReasonCode] = useState('refund'),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState(''),
    [notes, setNotes] = useState(''),
    [result, setResult] = useState('success'),
    [failureReason, setFailureReason] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false),
    [dirty, setDirty] = useState(false),
    [unknown, setUnknown] = useState(false),
    [pending, setPending] = useState('');
  const search = () => {
      const n = new URLSearchParams(l.search);
      n.delete('invoiceSourceIds');
      return n.toString();
    },
    exit = () => void navigate({ pathname: parent, search: search() }),
    close = () => {
      if (w.busy) return;
      if (dirty || unknown) setDiscard(true);
      else exit();
    },
    change = () => {
      setPreview(undefined);
      setDirty(true);
      if (!unknown) setRequestId(crypto.randomUUID());
    },
    values = () =>
      red
        ? {
            reasonCode,
            reason,
            evidence,
            lines: base.original!.lines.data.map((l) => ({
              originalLineId: l.id,
              gross: amounts[l.id] ?? '0',
            })),
            result,
            failureReason,
            notes,
          }
        : {
            sources: base.sources.map((s) => ({
              sourceId: s.id,
              amounts: s.lines.data.map((l) => ({
                billLineId: l.id,
                gross: amounts[s.id + ':' + l.id] ?? '0',
              })),
            })),
            result,
            failureReason,
            notes,
          };
  const validate = useCallback(() => {
    const e: Record<string, string> = {};
    let total = 0;
    for (const [k, v] of Object.entries(amounts)) {
      if (!/^\d{1,14}(\.\d{1,2})?$/.test(v)) e[k] = t('invoice.positive');
      total += Number(v) || 0;
    }
    if (total <= 0)
      e[Object.keys(amounts)[0] ?? 'gross'] = t('invoice.positive');
    if (red) {
      if (!reason.trim()) e.reason = t('invoice.required');
      if (!evidence.trim()) e.evidence = t('invoice.required');
    }
    if (result === 'failed' && !failureReason.trim())
      e.failureReason = t('invoice.required');
    if (reason.length > 500) e.reason = t('billing.invalidField');
    if (evidence.length > 500) e.evidence = t('billing.invalidField');
    if (failureReason.length > 500) e.failureReason = t('billing.invalidField');
    if (notes.length > 1000) e.notes = t('billing.invalidField');
    return e;
  }, [amounts, red, reason, evidence, result, failureReason, notes, t]);
  const { attempted, setErrors } = w;
  useEffect(() => {
    if (attempted) setErrors(validate());
  }, [attempted, setErrors, validate]);
  const run = async (write = false) => {
    if (!w.focus(validate())) return;
    if (write && !preview) return;
    w.setBusy(true);
    w.setError(undefined);
    setPending(write ? 'save' : 'preview');
    try {
      const endpoint = red
          ? 'invoices/' + base.original!.id + (write ? '/red' : '/previewRed')
          : 'invoices' + (write ? '' : '/preview'),
        json = write
          ? {
              ...values(),
              requestId,
              expectedSources: preview!.expectedSources,
              previewHash: preview!.previewHash,
              ...(red ? { expectedVersion: base.original!.version } : {}),
            }
          : values();
      if (write) {
        const r = await api.request<{
          data: { outcome: string; invoice: Invoice | null };
        }>({ path: endpoint, method: 'POST', json });
        setUnknown(false);
        setConfirm(false);
        await cache.invalidateQueries({ queryKey: ['hyl'] });
        if (r.data.outcome === 'failed') {
          toast.show({ title: t('invoice.failed'), type: 'success' });
          setPreview(undefined);
          setRequestId(crypto.randomUUID());
        } else {
          toast.show({
            title: t(red ? 'invoice.redSaved' : 'invoice.issueSaved', {
              number: r.data.invoice?.number,
            }),
            type: 'success',
          });
          exit();
        }
      } else {
        const r = await api.request<{ data: Preview }>({
          path: endpoint,
          method: 'POST',
          json,
        });
        setPreview(r.data);
        setRequestId(crypto.randomUUID());
      }
    } catch (e) {
      w.fail(e);
      const fields = invoiceFieldMessages(e, t('billing.invalidField'), {
        sources: base.sources,
        lines: base.original?.lines.data,
      });
      if (Object.keys(fields).length) w.focus(fields);
      setConfirm(false);
      if (write && (!(e instanceof ApiClientError) || e.status >= 500))
        setUnknown(true);
    } finally {
      w.setBusy(false);
    }
  };
  return (
    <>
      <BackButton
        to={{ pathname: parent, search: search() }}
        onClick={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <PageHeader
        title={t(red ? 'invoice.red' : 'invoice.issue')}
        description={t('invoice.simulated')}
      />
      {w.error ? <BillingError error={w.error} /> : null}
      {unknown ? <p>{t('invoice.unknown')}</p> : null}
      {w.conflict ? (
        <Button
          variant='outline'
          disabled={w.busy}
          onClick={() => {
            void refresh().then((fresh) => {
              if (fresh) setBase(fresh);
            });
            setPreview(undefined);
            setRequestId(crypto.randomUUID());
            w.setError(undefined);
          }}
        >
          {t('invoice.reload')}
        </Button>
      ) : null}
      <Group title={t('invoice.party')}>
        <p>
          {red
            ? base.original!.payload.buyer.name
            : (base.sources[0]?.config?.payload.buyer.name ??
              t('invoice.notConfigured'))}{' '}
          ·{' '}
          {red
            ? base.original!.payload.seller.name
            : (base.sources[0]?.config?.payload.seller.name ??
              t('invoice.notConfigured'))}
        </p>
        {red ? (
          <p>{base.original!.number}</p>
        ) : (
          base.sources.map((s) => (
            <p key={s.id}>
              {s.number} · {s.payload.contractNumber} · {s.payload.billNumber} ·{' '}
              {s.config?.payload.buyer.taxNo} / {s.config?.payload.seller.taxNo}
            </p>
          ))
        )}
      </Group>
      <Group title={t('invoice.lines')}>
        {red
          ? base.original!.lines.data.map((line) => (
              <FormField
                key={line.id}
                name={line.id}
                label={
                  t('billing.fees.' + line.feeType) +
                  ' · ' +
                  t('invoice.fields.remainingCents') +
                  ' ' +
                  decimal(line.remainingCents)
                }
                value={amounts[line.id] ?? '0'}
                error={w.errors[line.id]}
                decimal
                disabled={w.busy || unknown}
                onChange={(v) => {
                  change();
                  setAmounts((old) => ({ ...old, [line.id]: v }));
                }}
              />
            ))
          : base.sources.map((s) => (
              <div key={s.id} className='flex flex-col gap-3'>
                <p className='font-medium'>{s.payload.billNumber}</p>
                {s.lines.data.map((line) => (
                  <div key={line.id}>
                    <FormField
                      name={s.id + ':' + line.id}
                      label={t('billing.fees.' + line.feeType)}
                      value={amounts[s.id + ':' + line.id] ?? '0'}
                      error={w.errors[s.id + ':' + line.id]}
                      decimal
                      disabled={w.busy || unknown}
                      onChange={(v) => {
                        change();
                        setAmounts((old) => ({
                          ...old,
                          [s.id + ':' + line.id]: v,
                        }));
                      }}
                    />
                    <p className='text-sm text-muted-foreground'>
                      {
                        s.config?.payload.fees.find(
                          (f) => f.feeType === line.feeType,
                        )?.taxItemName
                      }{' '}
                      ·{' '}
                      {
                        s.config?.payload.fees.find(
                          (f) => f.feeType === line.feeType,
                        )?.rate
                      }
                      % · {t('invoice.fields.availableCents')}:{' '}
                      <Money cents={line.availableCents} />
                    </p>
                  </div>
                ))}
              </div>
            ))}
      </Group>
      {red ? (
        <Group title={t('invoice.red')}>
          <Field>
            <FieldLabel>{t('invoice.fields.reasonCode')} *</FieldLabel>
            <Choice
              value={reasonCode}
              disabled={w.busy || unknown}
              onChange={(v) => {
                change();
                setReasonCode(v);
                setAmounts(
                  Object.fromEntries(
                    base.original!.lines.data.map((line) => [
                      line.id,
                      decimal(
                        v === 'correction'
                          ? line.remainingCents
                          : BigInt(line.requiredRedCents ?? '0') <
                              BigInt(line.remainingCents)
                            ? (line.requiredRedCents ?? '0')
                            : line.remainingCents,
                      ),
                    ]),
                  ),
                );
              }}
              options={['refund', 'correction'].map((value) => ({
                value,
                label: t('invoice.' + value),
              }))}
            />
          </Field>
          <FormField
            name='reason'
            label={t('invoice.fields.reason')}
            value={reason}
            error={w.errors.reason}
            required
            disabled={w.busy || unknown}
            multiline
            onChange={(v) => {
              change();
              setReason(v);
            }}
          />
          <FormField
            name='evidence'
            label={t('invoice.fields.evidence')}
            value={evidence}
            error={w.errors.evidence}
            required
            disabled={w.busy || unknown}
            multiline
            onChange={(v) => {
              change();
              setEvidence(v);
            }}
          />
        </Group>
      ) : null}
      <Group title={t('invoice.fields.result')}>
        <Choice
          value={result}
          disabled={w.busy || unknown}
          onChange={(v) => {
            change();
            setResult(v);
          }}
          options={['success', 'failed'].map((value) => ({
            value,
            label: t('invoice.' + value + 'Result'),
          }))}
        />
        {result === 'failed' ? (
          <FormField
            name='failureReason'
            label={t('invoice.fields.failureReason')}
            value={failureReason}
            error={w.errors.failureReason}
            required
            disabled={w.busy || unknown}
            onChange={(v) => {
              change();
              setFailureReason(v);
            }}
          />
        ) : null}
        <FormField
          name='notes'
          label={t('invoice.fields.notes')}
          value={notes}
          multiline
          disabled={w.busy || unknown}
          onChange={(v) => {
            change();
            setNotes(v);
          }}
        />
      </Group>
      {preview ? (
        <Group title={t('invoice.preview')}>
          <Metrics
            row={{ ...preview }}
            keys={['grossCents', 'netCents', 'taxCents']}
          />
          {preview.lines?.map((line) => {
            const source = base.sources.find((s) => s.id === line.sourceId);
            const original = base.original?.lines.data.find(
              (l) => l.id === line.originalLineId,
            );
            const basis = source?.lines.data.find(
              (l) => l.id === line.billLineId,
            );
            const before = red
              ? original?.remainingCents
              : basis?.availableCents;
            return (
              <div
                key={
                  line.originalLineId ?? line.sourceId + ':' + line.billLineId
                }
                className='rounded-lg border p-4'
              >
                <p>
                  {source?.number ?? base.original?.number} ·{' '}
                  {source?.payload.billNumber ??
                    original?.billNumber ??
                    line.billId}{' '}
                  · {t('billing.fees.' + line.feeType)}
                </p>
                <p>
                  {line.payload.taxItemName} · {line.payload.code || '—'} ·{' '}
                  {line.rateBps / 100}%
                </p>
                <Metrics
                  row={{
                    ...line,
                    beforeCents: before ?? '0',
                    afterCents: String(
                      BigInt(before ?? '0') - BigInt(line.grossCents),
                    ),
                    ...(original
                      ? {
                          originalCents: original.grossCents,
                          creditedCents: String(
                            BigInt(original.grossCents) -
                              BigInt(original.remainingCents),
                          ),
                        }
                      : {}),
                  }}
                  keys={
                    red
                      ? [
                          'originalCents',
                          'creditedCents',
                          'beforeCents',
                          'grossCents',
                          'netCents',
                          'taxCents',
                          'afterCents',
                        ]
                      : [
                          'beforeCents',
                          'grossCents',
                          'netCents',
                          'taxCents',
                          'afterCents',
                        ]
                  }
                />
              </div>
            );
          })}
        </Group>
      ) : null}
      <div className='flex justify-end gap-2'>
        <Button variant='outline' disabled={w.busy || unknown} onClick={close}>
          {t('invoice.cancel')}
        </Button>
        <Button
          variant='outline'
          disabled={w.busy || unknown}
          onClick={() => void run()}
        >
          {w.busy && pending === 'preview' ? <Spinner /> : null}
          {t('invoice.preview')}
        </Button>
        <Button
          disabled={w.busy || !preview}
          onClick={() => (unknown ? void run(true) : setConfirm(true))}
        >
          {w.busy && pending === 'save' ? <Spinner /> : null}
          {t(red ? 'invoice.red' : 'invoice.issue')}
        </Button>
      </div>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        busy={w.busy}
        destructive={red}
        title={t('invoice.confirm', {
          action: t(red ? 'invoice.red' : 'invoice.issue'),
          number:
            base.original?.number ??
            base.sources.map((s) => s.number).join(', '),
        })}
        label={t(red ? 'invoice.red' : 'invoice.issue')}
        onConfirm={() => void run(true)}
      >
        {t(red ? 'invoice.redHelp' : 'invoice.confirmHelp')}
      </Confirm>
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        busy={w.busy}
        destructive
        title={t('invoice.discard')}
        label={t('invoice.discardAction')}
        onConfirm={exit}
      >
        {t('invoice.discardHelp')}
      </Confirm>
    </>
  );
}

function decimal(value: string) {
  const n = BigInt(value);
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}
