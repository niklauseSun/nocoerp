import { invoiceFieldMessages } from './form-errors.js';
import { useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Checkbox } from '#components/ui/checkbox';
import { Field, FieldLabel } from '#components/ui/field';
import { useWork } from '../cashier/work.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  FormField,
  Choice,
  RecordPicker,
  Confirm,
  LoadingRows,
  BillingError,
  Metrics,
} from './common.js';
import type { Config, ConfigValues, Source } from './types.js';
const blankParty = {
  type: 'company' as const,
  name: '',
  taxNo: '',
  address: '',
  phone: '',
  bank: '',
  account: '',
  email: '',
};
const blank: ConfigValues = {
  enabled: true,
  autoIssue: false,
  buyer: blankParty,
  seller: blankParty,
  fees: [{ feeType: 'rent', taxItemName: '', code: '', rate: '0' }],
  notes: '',
};
type Info = {
  config?: Config;
  contract: { id: string; number: string };
  merchant: { name: string; creditCode: string };
  allowedActions: string[];
};
export default function ConfigForm() {
  useCoverFocus();
  const p = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    { t } = useTranslation(),
    can = useBusinessPermission('contracts', 'invoiceConfigure'),
    [selected, setSelected] = useState(''),
    source = useBusinessQuery<{ data: Source }>(
      'invoiceSources/' + p.invoiceSourceId,
      undefined,
      !!p.invoiceSourceId && can.can,
    ),
    config = useBusinessQuery<{ data: Config }>(
      'invoiceConfigs/' + p.invoiceConfigId,
      undefined,
      !!p.invoiceConfigId && can.can,
    ),
    contractId =
      p.id ??
      source.data?.data.contractId ??
      config.data?.data.contractId ??
      selected,
    info = useBusinessQuery<{ data: Info }>(
      'contracts/' + contractId + '/invoiceConfig',
      undefined,
      !!contractId && can.can,
    );
  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        {source.error || config.error ? (
          <>
            <BackButton
              to={{
                pathname: path.slice(0, path.lastIndexOf('/')),
                search: l.search,
              }}
            />
            <BillingError
              error={source.error ?? config.error}
              retry={() => {
                void source.refetch();
                void config.refetch();
              }}
            />
          </>
        ) : !can.can ? (
          <p>{t('invoice.restricted')}</p>
        ) : (p.invoiceSourceId && !source.data) ||
          (p.invoiceConfigId && !config.data) ? (
          <LoadingRows />
        ) : (
          <>
            {!contractId ? (
              <>
                <BackButton
                  to={{
                    pathname: path.slice(0, path.lastIndexOf('/')),
                    search: l.search,
                  }}
                />
                <PageHeader title={t('invoice.newConfig')} />
                <Field>
                  <FieldLabel htmlFor='cashier-contractId'>
                    {t('invoice.fields.contractId')} *
                  </FieldLabel>
                  <RecordPicker
                    kind='contracts'
                    id='cashier-contractId'
                    value={selected}
                    onChange={setSelected}
                  />
                </Field>
              </>
            ) : null}
            {contractId ? (
              info.error ? (
                <BillingError
                  error={info.error}
                  retry={() => void info.refetch()}
                />
              ) : !info.data ? (
                <LoadingRows />
              ) : (
                <ConfigEditor
                  key={contractId}
                  initial={info.data.data}
                  path={path}
                  reload={() => info.refetch().then((r) => r.data?.data)}
                />
              )
            ) : null}
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function ConfigEditor({
  initial,
  path,
  reload,
}: {
  initial: Info;
  path: string;
  reload: () => Promise<Info | undefined>;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    navigate = useNavigate(),
    l = useLocation(),
    w = useWork(),
    parent = path.slice(0, path.lastIndexOf('/')),
    [values, setValues] = useState<ConfigValues>(
      () =>
        initial.config?.payload ?? {
          ...blank,
          buyer: {
            ...blankParty,
            name: initial.merchant.name,
            taxNo: initial.merchant.creditCode,
          },
        },
    ),
    [version, setVersion] = useState(initial.config?.version ?? 0),
    [preview, setPreview] = useState<{
      expectedConfigVersion: number;
      sample: Record<string, string>[];
    }>(),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [pending, setPending] = useState(''),
    [stale, setStale] = useState(false);
  const validate = (v: ConfigValues) => {
    const errors: Record<string, string> = {};
    for (const party of ['buyer', 'seller'] as const)
      for (const key of ['name', 'taxNo'] as const)
        if (
          (key === 'name' || v[party].type === 'company') &&
          !v[party][key].trim()
        )
          errors[party + '.' + key] = t('invoice.required');
    if (!v.fees.length) errors.fees = t('invoice.required');
    for (const f of v.fees) {
      if (!f.taxItemName)
        errors[f.feeType + '.taxItemName'] = t('invoice.required');
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(f.rate) || Number(f.rate) > 100)
        errors[f.feeType + '.rate'] = t('invoice.positive');
    }
    for (const party of ['buyer', 'seller'] as const) {
      for (const [key, max] of Object.entries({
        name: 100,
        taxNo: 30,
        address: 200,
        phone: 50,
        bank: 100,
        account: 100,
      }))
        if (v[party][key as keyof typeof v.buyer].length > max)
          errors[party + '.' + key] = t('billing.invalidField');
      if (v[party].email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v[party].email))
        errors[party + '.email'] = t('billing.invalidField');
    }
    for (const f of v.fees) {
      if (f.taxItemName.length > 100)
        errors[f.feeType + '.taxItemName'] = t('billing.invalidField');
      if (f.code.length > 50)
        errors[f.feeType + '.code'] = t('billing.invalidField');
    }
    if (v.notes.length > 1000) errors.notes = t('billing.invalidField');
    return errors;
  };
  const update = (next: ConfigValues) => {
    setValues(next);
    setPreview(undefined);
    setDirty(true);
    setRequestId(crypto.randomUUID());
    if (w.attempted) w.setErrors(validate(next));
  };
  const close = () => {
    if (w.busy) return;
    if (dirty) setDiscard(true);
    else void navigate({ pathname: parent, search: l.search });
  };
  const run = async (save = false) => {
    if (!w.focus(validate(values))) return;
    w.setBusy(true);
    w.setError(undefined);
    setPending(save ? 'save' : 'preview');
    try {
      if (save) {
        if (!preview) return;
        const saved = await api.request<{ data: Config }>({
          path: 'contracts/' + initial.contract.id + '/invoiceConfig',
          method: 'PUT',
          json: { requestId, expectedVersion: version, values },
        });
        await cache.invalidateQueries({ queryKey: ['hyl'] });
        toast.show({
          title: t('invoice.configSaved', {
            number: initial.contract.number,
            version: saved.data.version,
          }),
          type: 'success',
        });
        await navigate({ pathname: parent, search: l.search });
      } else {
        const r = await api.request<{
          data: {
            expectedConfigVersion: number;
            sample: Record<string, string>[];
          };
        }>({
          path: 'contracts/' + initial.contract.id + '/previewInvoiceConfig',
          method: 'POST',
          json: values,
        });
        if (r.data.expectedConfigVersion !== version) {
          setStale(true);
          setPreview(undefined);
          return;
        }
        setPreview(r.data);
        setRequestId(crypto.randomUUID());
      }
    } catch (e) {
      w.fail(e);
      const fields = invoiceFieldMessages(e, t('billing.invalidField'), {
        fees: values.fees,
      });
      if (Object.keys(fields).length) w.focus(fields);
    } finally {
      w.setBusy(false);
    }
  };
  return (
    <>
      <BackButton
        to={{ pathname: parent, search: l.search }}
        onClick={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <PageHeader
        title={t('invoice.configuration')}
        description={initial.contract.number}
      />
      {w.error ? <BillingError error={w.error} /> : null}
      {stale ? (
        <p className='text-destructive'>
          {t('invoice.errors.INVOICE_CHANGED')}
        </p>
      ) : null}
      {w.conflict || stale ? (
        <Button
          variant='outline'
          onClick={() => {
            void reload().then((r) => {
              if (r) {
                setVersion(r.config?.version ?? 0);
                setStale(false);
                setPreview(undefined);
                setRequestId(crypto.randomUUID());
                w.setError(undefined);
              }
            });
          }}
        >
          {t('invoice.reload')}
        </Button>
      ) : null}
      <Group title={t('invoice.settings')}>
        {(['enabled', 'autoIssue'] as const).map((k) => (
          <label key={k} className='flex items-center gap-2'>
            <Checkbox
              checked={values[k]}
              disabled={
                w.busy ||
                (k === 'autoIssue' &&
                  !initial.allowedActions.includes('invoiceIssue'))
              }
              onCheckedChange={(v) => update({ ...values, [k]: !!v })}
            />
            {t('invoice.' + k)}
          </label>
        ))}
      </Group>
      {(['seller', 'buyer'] as const).map((party) => (
        <Group key={party} title={t('invoice.fields.' + party)}>
          {party === 'buyer' ? (
            <Field>
              <FieldLabel>{t('invoice.fields.type')}</FieldLabel>
              <Choice
                value={values.buyer.type}
                disabled={w.busy}
                onChange={(v) =>
                  update({
                    ...values,
                    buyer: {
                      ...values.buyer,
                      type: v as 'company' | 'individual',
                    },
                  })
                }
                options={['company', 'individual'].map((value) => ({
                  value,
                  label: t('invoice.' + value),
                }))}
              />
            </Field>
          ) : null}
          <div className='grid gap-4 sm:grid-cols-2'>
            {(
              [
                'name',
                'taxNo',
                'address',
                'phone',
                'bank',
                'account',
                'email',
              ] as const
            ).map((k) => (
              <FormField
                key={k}
                name={party + '.' + k}
                label={t('invoice.fields.' + k)}
                required={
                  k === 'name' ||
                  (k === 'taxNo' && values[party].type === 'company')
                }
                value={values[party][k]}
                error={w.errors[party + '.' + k]}
                disabled={w.busy}
                onChange={(v) =>
                  update({ ...values, [party]: { ...values[party], [k]: v } })
                }
              />
            ))}
          </div>
        </Group>
      ))}
      <Group title={t('invoice.fees')}>
        {['rent', 'property', 'water', 'electricity', 'gas', 'other'].map(
          (fee) => {
            const current = values.fees.find((f) => f.feeType === fee);
            return (
              <div
                key={fee}
                className='flex flex-col gap-3 rounded-lg border p-4'
              >
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={!!current}
                    disabled={w.busy}
                    onCheckedChange={(v) =>
                      update({
                        ...values,
                        fees: v
                          ? [
                              ...values.fees,
                              {
                                feeType: fee as 'rent',
                                taxItemName: '',
                                code: '',
                                rate: '0',
                              },
                            ]
                          : values.fees.filter((f) => f.feeType !== fee),
                      })
                    }
                  />
                  {t('billing.fees.' + fee)}
                </label>
                {current ? (
                  <div className='grid gap-4 sm:grid-cols-3'>
                    {(['taxItemName', 'code', 'rate'] as const).map((k) => (
                      <FormField
                        key={k}
                        name={fee + '.' + k}
                        label={t('invoice.fields.' + k)}
                        required={k !== 'code'}
                        value={current[k]}
                        disabled={w.busy}
                        error={w.errors[fee + '.' + k]}
                        decimal={k === 'rate'}
                        onChange={(v) =>
                          update({
                            ...values,
                            fees: values.fees.map((f) =>
                              f.feeType === fee ? { ...f, [k]: v } : f,
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          },
        )}
        {w.errors.fees ? (
          <p className='text-destructive'>{w.errors.fees}</p>
        ) : null}
      </Group>
      <FormField
        name='notes'
        label={t('invoice.fields.notes')}
        value={values.notes}
        onChange={(v) => update({ ...values, notes: v })}
        disabled={w.busy}
        multiline
      />
      {preview ? (
        <Group title={t('invoice.sample')}>
          {preview.sample.map((r) => (
            <div key={r.feeType} className='flex flex-col gap-2'>
              <p>{t('billing.fees.' + r.feeType)}</p>
              <Metrics row={r} keys={['grossCents', 'netCents', 'taxCents']} />
            </div>
          ))}
        </Group>
      ) : null}
      <div className='flex justify-end gap-2'>
        <Button variant='outline' disabled={w.busy} onClick={close}>
          {t('invoice.cancel')}
        </Button>
        <Button variant='outline' disabled={w.busy} onClick={() => void run()}>
          {w.busy && pending === 'preview' ? <Spinner /> : null}
          {t('invoice.preview')}
        </Button>
        <Button disabled={w.busy || !preview} onClick={() => void run(true)}>
          {w.busy && pending === 'save' ? <Spinner /> : null}
          {t('invoice.save')}
        </Button>
      </div>
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        title={t('invoice.discard')}
        label={t('invoice.discardAction')}
        busy={w.busy}
        destructive
        onConfirm={() => void navigate({ pathname: parent, search: l.search })}
      >
        {t('invoice.discardHelp')}
      </Confirm>
    </>
  );
}
