import { useCoverFocus } from './focus.js';
import { Spinner } from '#components/ui/spinner';
import { useWork } from '../cashier/work.js';
import { useState } from 'react';
import {
  Outlet,
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
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Checkbox } from '#components/ui/checkbox';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  FormField,
  Confirm,
  DateField,
  RecordPicker,
  Choice,
  LoadingRows,
  BillingError,
  Money,
  Paged,
  Search,
} from './common.js';
import type { Rule, RuleValues } from './types.js';
export default function SplitRuleForm() {
  useCoverFocus();
  const p = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    { t } = useTranslation(),
    can = useBusinessPermission('contracts', 'splitConfigure'),
    [readVersion] = useState(() => crypto.randomUUID());
  const source = useBusinessQuery<{ data: Rule }>(
    `splitRules/${p.ruleId}`,
    { readVersion },
    !!p.ruleId && can.can,
  );
  return l.pathname !== path ? (
    <Outlet />
  ) : (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        {!can.can ? (
          <p>{t('split.restricted')}</p>
        ) : p.ruleId && !source.data ? (
          source.error ? (
            <BillingError
              error={source.error}
              retry={() => void source.refetch()}
            />
          ) : (
            <LoadingRows />
          )
        ) : (
          <RuleForm initial={source.data?.data} path={path} />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function RuleForm({ initial, path }: { initial?: Rule; path: string }) {
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    cache = useQueryClient(),
    toaster = useToaster(),
    w = useWork(),
    copy = path.endsWith('/copy') || path.includes('/copy/');
  const [contractId, setContractId] = useState(
      copy ? '' : (initial?.contractId ?? p.id ?? ''),
    ),
    [values, setValues] = useState<RuleValues>(
      () =>
        initial?.payload ?? {
          enabled: false,
          effectiveFrom: '',
          billFeeTypes: ['rent', 'property'],
          recipients: [
            {
              key: crypto.randomUUID(),
              kind: 'project',
              name: '',
              accountLabel: '',
              rate: '100',
            },
          ],
          notes: '',
        },
    ),
    [preview, setPreview] = useState<{
      version: number;
      sample: Record<string, string>;
    }>(),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [discard, setDiscard] = useState(false),
    [confirm, setConfirm] = useState(false);
  const parent = path
    .replace(/\/(new|newVersion|copy|splitRuleNew)$/, '')
    .replace(/\/copy\/[^/]+$/, '');
  const validate = (v = values) => {
    const e: Record<string, string> = {};
    if (!contractId) e.contractId = t('split.required');
    if (!v.effectiveFrom) e.effectiveFrom = t('split.required');
    let sum = 0;
    v.recipients.forEach((r, i) => {
      for (const k of ['name', 'accountLabel'] as const)
        if (!r[k].trim()) e[`recipients.${i}.${k}`] = t('split.required');
      if (
        !/^\d{1,3}(\.\d{1,2})?$/.test(r.rate) ||
        Number(r.rate) <= 0 ||
        Number(r.rate) > 100
      )
        e[`recipients.${i}.rate`] = t('split.rateHelp');
      sum += Math.round(Number(r.rate) * 100);
    });
    if (
      sum !== 10000 ||
      v.recipients.filter((r) => r.kind === 'project').length !== 1
    )
      e.recipients = t('split.rateHelp');
    return e;
  };
  const update = (v: RuleValues) => {
    setValues(v);
    setPreview(undefined);
    setRequestId(crypto.randomUUID());
    if (w.attempted) w.setErrors(validate(v));
  };
  const close = () => {
    if (w.busy) return;
    setDiscard(true);
  };
  const [pending, setPending] = useState('');
  const previewNow = async () => {
    setPending('preview');
    if (!w.focus(validate())) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      if (copy) {
        const target = await api.request<{
          data: { payload: { predecessorId?: string } };
        }>({ path: `contracts/${contractId}/leaseSummary` });
        if (target.data.payload.predecessorId !== initial?.contractId) {
          w.focus({ contractId: t('split.noRenewal') });
          return;
        }
      }
      const r = await api.request<{
        data: { version: number; sample: Record<string, string> };
      }>({
        path: `contracts/${contractId}/previewSplitRule`,
        method: 'POST',
        json: { ...values, ...(copy ? { copyFromRuleId: initial?.id } : {}) },
      });
      setPreview(r.data);
      setRequestId(crypto.randomUUID());
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  const save = async () => {
    setPending('save');
    if (!preview) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: Rule }>({
        path: `contracts/${contractId}/splitRules`,
        method: 'PUT',
        json: {
          ...values,
          ...(copy ? { copyFromRuleId: initial?.id } : {}),
          expectedVersion: preview.version,
          requestId,
        },
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('split.saved', { number: r.data.version }),
        type: 'success',
      });
      w.setBusy(false);
      setConfirm(false);
      let destination: string;
      if (copy) destination = path + '/result/' + r.data.id;
      else if (path.endsWith('splitRuleNew'))
        destination = parent + '/splitRule/' + r.data.id;
      else if (path.endsWith('newVersion'))
        destination = parent.replace(/\/[^/]+$/, '') + '/' + r.data.id;
      else destination = parent + '/' + r.data.id;
      void navigate({ pathname: destination, search: l.search });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const changeRecipient = (i: number, k: string, v: string) =>
    update({
      ...values,
      recipients: values.recipients.map((r, j) =>
        i === j ? { ...r, [k]: v } : r,
      ),
    });
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
        title={t(
          copy ? 'split.copy' : initial ? 'split.newVersion' : 'split.newRule',
        )}
        description={t('split.versionHelp')}
      />
      <form
        noValidate
        className='flex flex-col gap-6'
        onSubmit={(e) => {
          e.preventDefault();
          if (preview) setConfirm(true);
          else void previewNow();
        }}
      >
        {w.error ? <BillingError error={w.error} /> : null}
        {w.conflict ? (
          <Button
            type='button'
            variant='outline'
            onClick={() => void previewNow()}
          >
            {t('split.latest')}
          </Button>
        ) : null}
        <Group title={t('split.rules')}>
          <Field>
            <FieldLabel htmlFor='cashier-contractId'>
              {t('split.fields.contractId')} *
            </FieldLabel>
            {copy && initial ? (
              <RenewalPicker
                sourceContractId={initial.contractId}
                value={contractId}
                busy={w.busy}
                onChange={(id, start) => {
                  setContractId(id);
                  update({ ...values, effectiveFrom: start });
                }}
              />
            ) : (
              <RecordPicker
                id='cashier-contractId'
                kind='contracts'
                value={contractId}
                disabled={w.busy || !!p.id || (!!initial && !copy)}
                onChange={(id) => {
                  setContractId(id);
                  setPreview(undefined);
                }}
              />
            )}
            {w.errors.contractId ? (
              <FieldError>{w.errors.contractId}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor='cashier-effectiveFrom'>
              {t('split.fields.effectiveFrom')} *
            </FieldLabel>
            <DateField
              id='cashier-effectiveFrom'
              value={values.effectiveFrom}
              disabled={w.busy}
              onChange={(effectiveFrom) => update({ ...values, effectiveFrom })}
            />
            {w.errors.effectiveFrom ? (
              <FieldError>{w.errors.effectiveFrom}</FieldError>
            ) : null}
          </Field>
          <label className='flex gap-2'>
            <Checkbox
              checked={values.enabled}
              disabled={w.busy}
              onCheckedChange={(v) => update({ ...values, enabled: !!v })}
            />
            {t('split.fields.enabled')}
          </label>
          <div className='flex flex-wrap gap-4'>
            {['rent', 'property', 'water', 'electricity', 'gas', 'other'].map(
              (k) => (
                <label key={k} className='flex gap-2'>
                  <Checkbox
                    checked={values.billFeeTypes.includes(k)}
                    disabled={w.busy}
                    onCheckedChange={(v) =>
                      update({
                        ...values,
                        billFeeTypes: v
                          ? [...values.billFeeTypes, k]
                          : values.billFeeTypes.filter((f) => f !== k),
                      })
                    }
                  />
                  {t(`billing.fees.${k}`)}
                </label>
              ),
            )}
          </div>
        </Group>
        <Group title={t('split.recipients')}>
          <p
            id='cashier-recipients'
            tabIndex={-1}
            className={
              w.errors.recipients ? 'text-destructive' : 'text-muted-foreground'
            }
          >
            {w.errors.recipients || t('split.rateHelp')}
          </p>
          {values.recipients.map((r, i) => (
            <div
              key={r.key}
              className='flex flex-col gap-3 rounded-lg border p-4'
            >
              <Field>
                <FieldLabel>{t('split.fields.kind')} *</FieldLabel>
                <Choice
                  ariaLabel={t('split.fields.kind')}
                  value={r.kind}
                  disabled={w.busy}
                  onChange={(v) => changeRecipient(i, 'kind', v)}
                  options={['project', 'partner'].map((value) => ({
                    value,
                    label: t(`split.roles.${value}`),
                  }))}
                />
              </Field>
              {(['name', 'accountLabel', 'rate'] as const).map((k) => (
                <FormField
                  key={k}
                  name={`recipients.${i}.${k}`}
                  label={t(`split.fields.${k}`)}
                  value={r[k]}
                  onChange={(v) => changeRecipient(i, k, v)}
                  required
                  disabled={w.busy}
                  error={w.errors[`recipients.${i}.${k}`]}
                />
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={w.busy || values.recipients.length === 1}
                onClick={() =>
                  update({
                    ...values,
                    recipients: values.recipients.filter(
                      (x) => x.key !== r.key,
                    ),
                  })
                }
              >
                {t('split.remove')}
              </Button>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            disabled={w.busy || values.recipients.length >= 11}
            onClick={() =>
              update({
                ...values,
                recipients: [
                  ...values.recipients,
                  {
                    key: crypto.randomUUID(),
                    kind: 'partner',
                    name: '',
                    accountLabel: '',
                    rate: '',
                  },
                ],
              })
            }
          >
            {t('split.add')}
          </Button>
        </Group>
        <FormField
          name='notes'
          label={t('split.fields.notes')}
          value={values.notes}
          onChange={(notes) => update({ ...values, notes })}
          disabled={w.busy}
          multiline
        />
        {preview ? (
          <Group title={t('split.previewTitle')}>
            <p>{t('split.sampleHelp')}</p>
            <p>
              {t('split.fields.version')}: {preview.version + 1}
            </p>
            {values.recipients.map((r) => (
              <p key={r.key}>
                {r.name} · {r.accountLabel} · {r.rate}% ·{' '}
                <Money cents={preview.sample?.[r.key] ?? '0'} />
              </p>
            ))}
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
            {t('split.save')}
          </Button>
        </div>
      </form>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        busy={w.busy}
        title={t('split.confirm', {
          action: t('split.save'),
          number: contractId,
        })}
        label={t('split.save')}
        onConfirm={() => void save()}
      >
        {t('split.versionHelp')}
      </Confirm>
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        busy={w.busy}
        title={t('split.discardTitle')}
        label={t('split.discard')}
        destructive
        onConfirm={() => void navigate({ pathname: parent, search: l.search })}
      >
        {t('split.discardHelp')}
      </Confirm>
    </>
  );
}

function RenewalPicker({
  sourceContractId,
  value,
  busy,
  onChange,
}: {
  sourceContractId: string;
  value: string;
  busy: boolean;
  onChange: (id: string, start: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const result = useBusinessQuery<{
    data: { id: string; number: string; payload: { start: string } }[];
    meta: { page: number; pageSize: number; total: number };
  }>(`contracts/${sourceContractId}/splitRenewals`, { q, page });
  return (
    <>
      <Search
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('split.search')}
      />
      {result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !result.data ? (
        <LoadingRows />
      ) : !result.data.meta.total ? (
        <p>{t('split.noRenewal')}</p>
      ) : (
        <>
          <Choice
            id='cashier-contractId'
            value={value}
            disabled={busy}
            ariaLabel={t('split.fields.contractId')}
            options={result.data.data.map((r) => ({
              value: r.id,
              label: r.number,
            }))}
            onChange={(id) => {
              const r = result.data.data.find((r) => r.id === id);
              if (r) onChange(id, r.payload.start);
            }}
          />
          <Paged
            meta={result.data.meta}
            busy={result.isFetching}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}
