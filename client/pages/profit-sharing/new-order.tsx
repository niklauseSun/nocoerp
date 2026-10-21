import { RecordSearch } from '#components/record-search';
import { useRecordSearchState } from '#hooks/use-record-search';
import {
  sourceRecordLabel,
  type SourceRecord,
} from '../hyl/source-record-label.js';
import { Field, FieldLabel } from '#components/ui/field';
import { useCoverFocus } from './focus.js';
import { Spinner } from '#components/ui/spinner';
import { useWork } from '../cashier/work.js';
import { useState } from 'react';
import { useLocation, useNavigate, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  Choice,
  FormField,
  Confirm,
  BillingError,
  Paged,
  SplitAmounts,
} from './common.js';
import { RecipientTable } from './detail.js';
import type { Snapshot, Order } from './types.js';
export default function Backfill() {
  useCoverFocus();
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    navigate = useNavigate(),
    api = useApiClient(),
    cache = useQueryClient(),
    toaster = useToaster(),
    w = useWork(),
    can = useBusinessPermission('contracts', 'splitConfigure');
  const [kind, setKind] = useState('bill'),
    { q, setQ, page, setPage } = useRecordSearchState('split-source:' + kind),
    [sourceId, setSourceId] = useState(''),
    [reason, setReason] = useState(''),
    [preview, setPreview] = useState<Snapshot>(),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false);
  const result = useBusinessQuery<{
      data: SourceRecord[];
      meta: { page: number; pageSize: number; total: number };
    }>(
      kind === 'bill' ? 'bills' : 'settlements',
      { q, page, pageSize: 10 },
      can.can,
    ),
    parent = path.slice(0, path.lastIndexOf('/'));
  const [pending, setPending] = useState('');
  const previewNow = async () => {
    setPending('preview');
    if (!w.focus({ ...(!sourceId ? { sourceId: t('split.required') } : {}) }))
      return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: Snapshot }>({
        path: 'splitOrders/preview',
        method: 'POST',
        json: { sourceKind: kind, sourceId },
      });
      setPreview(r.data);
      setRequestId(crypto.randomUUID());
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  const create = async () => {
    setPending('save');
    if (!preview) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: Order }>({
        path: 'splitOrders',
        method: 'POST',
        json: {
          requestId,
          sourceKind: kind,
          sourceId,
          sourceHash: preview.sourceHash,
          reason,
        },
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('split.recorded', { number: r.data.number }),
        type: 'success',
      });
      w.setBusy(false);
      setConfirm(false);
      void navigate({ pathname: parent + '/' + r.data.id, search: l.search });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const close = () => {
    if (w.busy) return;
    if (sourceId || reason) setDiscard(true);
    else void navigate({ pathname: parent, search: l.search });
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
          title={t('split.newOrder')}
          description={t('split.offline')}
        />
        {!can.can ? (
          <p>{t('split.restricted')}</p>
        ) : (
          <form
            noValidate
            className='flex flex-col gap-6'
            onSubmit={(e) => {
              e.preventDefault();
              if (
                w.focus({
                  ...(!reason.trim() ? { reason: t('split.required') } : {}),
                })
              )
                setConfirm(true);
            }}
          >
            {w.error ? <BillingError error={w.error} /> : null}
            <Group title={t('split.sources')}>
              <Choice
                ariaLabel={t('split.fields.sourceKind')}
                value={kind}
                disabled={w.busy}
                onChange={(v) => {
                  setKind(v);
                  setSourceId('');
                  setPreview(undefined);
                  setPage(1);
                }}
                options={['bill', 'settlement'].map((value) => ({
                  value,
                  label: t(`split.roles.${value}`),
                }))}
              />
              <Field>
                <FieldLabel htmlFor='cashier-sourceId'>
                  {t('split.fields.sourceId')} *
                </FieldLabel>
                <RecordSearch
                  id='cashier-sourceId'
                  label={t('split.fields.sourceId') + ' *'}
                  value={sourceId}
                  scopeKey={'split-source:' + kind}
                  disabled={w.busy}
                  invalid={!!w.errors.sourceId}
                  loading={result.isFetching}
                  options={(result.isPlaceholderData
                    ? []
                    : (result.data?.data ?? [])
                  ).map((row) => ({
                    value: row.id,
                    label: sourceRecordLabel(row),
                  }))}
                  onSearch={(query) => {
                    setQ(query);
                    setPage(1);
                  }}
                  onChange={(id) => {
                    setSourceId(id);
                    setPreview(undefined);
                  }}
                  placeholder={t('hyl.copy.sourceSearch')}
                  status={
                    result.error ? (
                      <BillingError
                        error={result.error}
                        retry={() => void result.refetch()}
                      />
                    ) : undefined
                  }
                  footer={
                    result.data && result.data.meta.total > 10 ? (
                      <Paged
                        meta={result.data.meta}
                        busy={w.busy || result.isFetching}
                        onChange={setPage}
                      />
                    ) : undefined
                  }
                />
                {w.errors.sourceId ? (
                  <p className='text-destructive'>{w.errors.sourceId}</p>
                ) : null}
              </Field>
            </Group>
            <FormField
              name='reason'
              label={t('split.fields.reason')}
              value={reason}
              required
              error={w.errors.reason}
              disabled={w.busy}
              onChange={(v) => {
                setReason(v);
                setRequestId(crypto.randomUUID());
                if (w.attempted)
                  w.setErrors(v.trim() ? {} : { reason: t('split.required') });
              }}
            />
            {preview ? (
              <Group title={t('split.previewTitle')}>
                <SplitAmounts
                  values={{
                    sourceFundsCents: preview.sourceFundsCents,
                    shareBaseCents: preview.shareBaseCents,
                    remainingCents: preview.remainingCents,
                    recoveryCents: preview.recoveryCents,
                  }}
                />
                <RecipientTable lines={preview.lines} />
              </Group>
            ) : null}
            <div className='flex justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={close}
              >
                {t('split.cancel')}
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={() => void previewNow()}
              >
                {w.busy && pending === 'preview' ? <Spinner /> : null}
                {t('split.preview')}
              </Button>
              <Button type='submit' disabled={w.busy || !preview}>
                {w.busy && pending === 'save' ? <Spinner /> : null}
                {t('split.create')}
              </Button>
            </div>
          </form>
        )}
        <Confirm
          open={confirm}
          onOpenChange={setConfirm}
          busy={w.busy}
          title={t('split.confirm', {
            action: t('split.create'),
            number: preview?.sourceNumber ?? '',
          })}
          label={t('split.create')}
          onConfirm={() => void create()}
        >
          {t('split.offline')}
        </Confirm>
        <Confirm
          open={discard}
          onOpenChange={setDiscard}
          busy={w.busy}
          title={t('split.discardTitle')}
          label={t('split.discard')}
          destructive
          onConfirm={() =>
            void navigate({ pathname: parent, search: l.search })
          }
        >
          {t('split.discardHelp')}
        </Confirm>
      </PageContainer>
    </RouteChildPage>
  );
}
