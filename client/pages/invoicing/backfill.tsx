import {
  sourceRecordLabel,
  type SourceRecord,
} from '../hyl/source-record-label.js';
import { RecordSearch } from '#components/record-search';
import { useRecordSearchState } from '#hooks/use-record-search';
import { invoiceFieldMessages } from './form-errors.js';
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Field, FieldLabel } from '#components/ui/field';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useWork } from '../cashier/work.js';
import { useBusinessQuery, useBusinessPermission } from '../hyl/hooks.js';
import { Paged, FormField, BillingError, Metrics, Confirm } from './common.js';
import type { Page, Source } from './types.js';
export default function Backfill() {
  useCoverFocus();
  const { t } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    navigate = useNavigate(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    parent = path.slice(0, path.lastIndexOf('/')),
    w = useWork(),
    can = useBusinessPermission('contracts', 'invoiceBackfill'),
    { q, setQ, page, setPage } = useRecordSearchState('invoice-backfill-bills'),
    [selectedNumber, setSelectedNumber] = useState(''),
    [billId, setBillId] = useState(''),
    [reason, setReason] = useState(''),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [preview, setPreview] = useState<Record<string, string>>(),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false),
    [pending, setPending] = useState(''),
    rows = useBusinessQuery<Page<SourceRecord>>(
      'bills',
      { q, page, pageSize: 20 },
      can.can,
    ),
    close = () => {
      if (w.busy) return;
      if (billId || reason) setDiscard(true);
      else void navigate({ pathname: parent, search: l.search });
    };
  const validate = useCallback(
    () => ({
      ...(!billId ? { billId: t('invoice.required') } : {}),
      ...(!reason.trim()
        ? { reason: t('invoice.required') }
        : reason.length > 500
          ? { reason: t('billing.invalidField') }
          : {}),
    }),
    [billId, reason, t],
  );
  const { attempted, setErrors } = w;
  useEffect(() => {
    if (attempted) setErrors(validate());
  }, [attempted, setErrors, validate]);
  const run = async (save = false) => {
    if (!w.focus(validate())) return;
    w.setBusy(true);
    setPending(save ? 'save' : 'preview');
    w.setError(undefined);
    try {
      if (save) {
        const r = await api.request<{ data: Source }>({
          path: 'invoiceSources',
          method: 'POST',
          json: { requestId, billId, sourceHash: preview!.sourceHash, reason },
        });
        await cache.invalidateQueries({ queryKey: ['hyl'] });
        toast.show({
          title: t('invoice.backfillSaved', { number: r.data.number }),
          type: 'success',
        });
        await navigate({
          pathname: parent + '/' + r.data.id,
          search: l.search,
        });
      } else {
        const r = await api.request<{ data: Record<string, string> }>({
          path: 'invoiceSources/preview',
          method: 'POST',
          json: { billId },
        });
        setPreview(r.data);
        setRequestId(crypto.randomUUID());
      }
    } catch (e) {
      setConfirm(false);
      w.fail(e);
      const fields = invoiceFieldMessages(e, t('billing.invalidField'), {});
      if (Object.keys(fields).length) w.focus(fields);
    } finally {
      w.setBusy(false);
    }
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
          title={t('invoice.backfill')}
          description={t('invoice.confirmHelp')}
        />
        {!can.can ? (
          <p>{t('invoice.restricted')}</p>
        ) : (
          <>
            {w.error ? <BillingError error={w.error} /> : null}
            <Field>
              <FieldLabel htmlFor='cashier-billId'>
                {t('invoice.fields.billId')} *
              </FieldLabel>
              <RecordSearch
                id='cashier-billId'
                label={t('invoice.fields.billId') + ' *'}
                value={billId}
                scopeKey='invoice-backfill-bills'
                placeholder={t('invoice.searchSourceBill')}
                disabled={w.busy}
                invalid={!!w.errors.billId}
                loading={rows.isFetching}
                options={(rows.isPlaceholderData
                  ? []
                  : (rows.data?.data ?? [])
                ).map((row) => ({
                  value: row.id,
                  label: sourceRecordLabel(row),
                }))}
                onSearch={(query) => {
                  setQ(query);
                  setPage(1);
                }}
                onChange={(id) => {
                  setBillId(id);
                  setSelectedNumber(
                    rows.data?.data.find((row) => row.id === id)?.number ?? '',
                  );
                  setPreview(undefined);
                }}
                status={
                  rows.error ? (
                    <BillingError
                      error={rows.error}
                      retry={() => void rows.refetch()}
                    />
                  ) : undefined
                }
                footer={
                  rows.data && rows.data.meta.total > 20 ? (
                    <Paged
                      meta={rows.data.meta}
                      busy={rows.isFetching}
                      onChange={setPage}
                    />
                  ) : undefined
                }
              />
              {w.errors.billId ? (
                <p className='text-destructive'>{w.errors.billId}</p>
              ) : null}
            </Field>
            <FormField
              name='reason'
              required
              label={t('invoice.fields.reason')}
              value={reason}
              disabled={w.busy}
              error={w.errors.reason}
              multiline
              onChange={(v) => {
                setReason(v);
                setPreview(undefined);
              }}
            />
            {preview ? (
              <Metrics
                row={preview}
                keys={[
                  'paidCents',
                  'netIssuedCents',
                  'availableCents',
                  'requiredRedCents',
                ]}
              />
            ) : null}
            <div className='flex justify-end gap-2'>
              <Button variant='outline' disabled={w.busy} onClick={close}>
                {t('invoice.cancel')}
              </Button>
              <Button
                variant='outline'
                disabled={w.busy}
                onClick={() => void run()}
              >
                {w.busy && pending === 'preview' ? <Spinner /> : null}
                {t('invoice.preview')}
              </Button>
              <Button
                disabled={w.busy || !preview}
                onClick={() => setConfirm(true)}
              >
                {w.busy && pending === 'save' ? <Spinner /> : null}
                {t('invoice.backfill')}
              </Button>
            </div>
          </>
        )}
        <Confirm
          open={confirm}
          onOpenChange={setConfirm}
          busy={w.busy}
          title={t('invoice.confirm', {
            action: t('invoice.backfill'),
            number: selectedNumber || billId,
          })}
          label={t('invoice.backfill')}
          onConfirm={() => void run(true)}
        >
          {t('invoice.confirmHelp')}
        </Confirm>
        <Confirm
          open={discard}
          onOpenChange={setDiscard}
          busy={w.busy}
          destructive
          title={t('invoice.discard')}
          label={t('invoice.discardAction')}
          onConfirm={() =>
            void navigate({ pathname: parent, search: l.search })
          }
        >
          {t('invoice.discardHelp')}
        </Confirm>
      </PageContainer>
    </RouteChildPage>
  );
}
