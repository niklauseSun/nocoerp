import { Spinner } from '#components/ui/spinner';
import { useBusinessQuery } from './hooks.js';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Field, FieldLabel } from '#components/ui/field';
import { useWork } from '../cashier/work.js';
import { useLeave } from '../inspections/leave.js';
import { preferenceValues } from '../../../server/messages/schema.js';
import {
  Nav,
  Group,
  FormField,
  Confirm,
  Choice,
  BillingError,
  DetailsSkeleton,
  Refresh,
  RecordedAt,
  type Prefs,
} from './common.js';
type Draft = Pick<
  Prefs,
  'enabled' | 'contracts' | 'bills' | 'repairs' | 'purchases' | 'locale'
> & { contractDays: string; billDays: string };
const draft = (p: Prefs): Draft => ({
  enabled: p.enabled,
  contracts: p.contracts,
  bills: p.bills,
  repairs: p.repairs,
  purchases: p.purchases,
  contractDays: String(p.contractDays),
  billDays: String(p.billDays),
  locale: p.locale,
});
export default function Preferences() {
  const { t } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    navigate = useNavigate(),
    l = useLocation(),
    back = { pathname: '/messageTodos', search: l.search },
    w = useWork(),
    r = useBusinessQuery<{ data: Prefs }>('messagePreferences');
  const [base, setBase] = useState<Prefs>(),
    [values, setValues] = useState<Draft>();
  // One fresh baseline: refetches never replace an unsaved draft.
  if (!base && r.data && r.isFetchedAfterMount) {
    setBase(r.data.data);
    setValues(draft(r.data.data));
  }
  const dirty = !!(
      base &&
      values &&
      JSON.stringify(draft(base)) !== JSON.stringify(values)
    ),
    leave = useLeave(dirty, w.busy);
  const valid = (v: Draft) => {
    const parsed = preferenceValues.safeParse({
      ...v,
      contractDays: Number(v.contractDays),
      billDays: Number(v.billDays),
    });
    const blank = ['contractDays', 'billDays'].find(
      (k) => !/^\d+$/.test(v[k as 'contractDays' | 'billDays']),
    );
    if (blank) return { [blank]: t('messages.bounds.' + blank) };
    return parsed.success
      ? {}
      : (Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0]),
            t('messages.bounds.' + String(i.path[0])),
          ]),
        ) as Record<string, string>);
  };
  const change = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    if (!values) return;
    const next = { ...values, [k]: v };
    setValues(next);
    if (w.attempted) w.setErrors(valid(next));
  };
  const reload = async () => {
    const fresh = await r.refetch();
    if (fresh.data) {
      setBase(fresh.data.data);
      setValues(draft(fresh.data.data));
      w.setError(undefined);
      w.setErrors({});
    }
  };
  const save = async () => {
    if (!values || !base || w.busy) return;
    if (!w.focus(valid(values))) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const out = await api.request<{ data: Prefs }>({
        path: 'messagePreferences',
        method: 'POST',
        json: {
          expectedVersion: base.version,
          values: {
            ...values,
            contractDays: Number(values.contractDays),
            billDays: Number(values.billDays),
          },
        },
      });
      setBase(out.data);
      setValues(draft(out.data));
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toast.show({ title: t('messages.saved') });
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  return (
    <PageContainer>
      <BackButton to={back} />
      <PageHeader
        title={t('messages.preferences')}
        description={t('messages.preferenceDescription')}
        actions={
          <Refresh
            busy={r.isFetching}
            onClick={() => {
              if (!dirty) void reload();
              else void r.refetch();
            }}
          />
        }
      />
      <Nav />
      {r.error ? (
        <BillingError error={r.error} retry={() => void r.refetch()} />
      ) : null}
      {w.error ? (
        <BillingError error={w.error} retry={() => void save()} />
      ) : null}
      {w.conflict ? (
        <Button
          variant='outline'
          disabled={w.busy}
          onClick={() => void reload()}
        >
          {t('messages.reload')}
        </Button>
      ) : null}
      {!values || !base ? (
        r.error ? null : (
          <DetailsSkeleton form />
        )
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className='flex flex-col gap-4'
        >
          <Group title={t('messages.subscriptions')}>
            <p className='text-sm text-muted-foreground'>
              {t('messages.saveHint')}
            </p>
            {(
              ['enabled', 'contracts', 'bills', 'repairs', 'purchases'] as const
            ).map((k) => (
              <Field key={k} orientation='horizontal'>
                <Checkbox
                  id={'messages-' + k}
                  checked={values[k]}
                  disabled={w.busy}
                  onCheckedChange={(v) => change(k, v === true)}
                />
                <FieldLabel htmlFor={'messages-' + k}>
                  {t('messages.fields.' + k)}
                </FieldLabel>
              </Field>
            ))}
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                name='contractDays'
                label={t('messages.fields.contractDays')}
                value={values.contractDays}
                onChange={(v) => change('contractDays', v)}
                disabled={w.busy}
                required
                error={w.errors.contractDays}
              />
              <FormField
                name='billDays'
                label={t('messages.fields.billDays')}
                value={values.billDays}
                onChange={(v) => change('billDays', v)}
                disabled={w.busy}
                required
                error={w.errors.billDays}
              />
            </div>
            <Field>
              <FieldLabel>{t('messages.fields.locale')}</FieldLabel>
              <Choice
                value={values.locale}
                onChange={(v) =>
                  change('locale', v === 'en-US' ? 'en-US' : 'zh-CN')
                }
                disabled={w.busy}
                ariaLabel={t('messages.fields.locale')}
                options={[
                  { value: 'zh-CN', label: t('messages.chinese') },
                  { value: 'en-US', label: t('messages.english') },
                ]}
              />
            </Field>
            <div className='flex flex-wrap justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={() => {
                  void Promise.resolve(leave.guard()).then((ok) => {
                    if (ok) void navigate(back);
                  });
                }}
              >
                {t('messages.cancel')}
              </Button>
              <Button
                type='submit'
                aria-busy={w.busy}
                disabled={w.busy || !dirty}
              >
                {w.busy ? <Spinner /> : null}
                {t('messages.save')}
              </Button>
            </div>
          </Group>
          <Group title={t('messages.checkHistory')}>
            <p className='text-sm'>
              <RecordedAt value={r.data?.data.lastCheckedAt} />
            </p>
            {r.data?.data.lastError ? (
              <p className='text-sm text-destructive'>
                {t('messages.errors.' + r.data.data.lastError)}
              </p>
            ) : null}
          </Group>
        </form>
      )}
      <Confirm
        open={leave.discard}
        onOpenChange={(v) => {
          if (!v) leave.dismiss();
        }}
        title={t('messages.discardTitle')}
        label={t('messages.discard')}
        busy={w.busy}
        onConfirm={() =>
          leave.accept(() => {
            void navigate(back);
          })
        }
      >
        {t('messages.discardHelp')}
      </Confirm>
    </PageContainer>
  );
}
