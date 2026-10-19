import { useBusinessIdentity } from '../hyl/hooks.js';
import { LongText } from '#components/long-text';
import { useMissingRecord } from './helpers.js';
import { str, today, endpoint, useInspectionCan } from './helpers.js';
import { useRef, useState } from 'react';
import {
  useParams,
  useLocation,
  useResolvedPath,
  useNavigate,
} from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useWork } from '../cashier/work.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useLeave } from './leave.js';
import {
  Choice,
  FormField,
  Group,
  DateField,
  Picker,
  Confirm,
  BillingError,
  LoadingRows,
  type Row,
  type Kind,
  type Item,
  type Answer,
} from './common.js';
export default function Form({ kind }: { kind: Kind }) {
  const p = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    { t } = useTranslation(),
    mode = path.split('/').at(-1)!,
    action =
      mode === 'new'
        ? 'manage'
        : kind === 'plans'
          ? 'manage'
          : ['pass', 'return'].includes(mode)
            ? 'review'
            : ['assign', 'toRepair'].includes(mode)
              ? 'manage'
              : kind === 'tasks'
                ? 'execute'
                : 'rectify',
    can = useInspectionCan(action),
    record = useBusinessQuery<{ data: Row }>(
      endpoint(kind) +
        '/' +
        p[
          kind === 'plans'
            ? 'inspectionPlanId'
            : kind === 'tasks'
              ? 'inspectionTaskId'
              : 'inspectionIssueId'
        ],
      undefined,
      mode !== 'new' && can.can,
    ),
    [revision, setRevision] = useState(0);
  useMissingRecord(record.error, kind);
  const back = {
    pathname: path.slice(0, path.lastIndexOf('/')),
    search: l.search,
  };
  if (
    !can.can ||
    (mode !== 'new' &&
      (record.error || !record.data || !record.isFetchedAfterMount))
  )
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton to={back} />
          {!can.can ? (
            <p>{t('inspection.restricted')}</p>
          ) : record.error ? (
            <BillingError
              error={record.error}
              retry={() => void record.refetch()}
            />
          ) : (
            <LoadingRows />
          )}
        </PageContainer>
      </RouteChildPage>
    );
  return (
    <Body
      key={path + revision}
      kind={kind}
      mode={mode}
      row={mode === 'new' ? undefined : record.data?.data}
      reload={async () => {
        await record.refetch();
        setRevision((v) => v + 1);
      }}
    />
  );
}
function Body({
  kind,
  mode,
  row,
  reload,
}: {
  kind: Kind;
  mode: string;
  row?: Row;
  reload: () => Promise<void>;
}) {
  useCoverFocus();
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    navigate = useNavigate(),
    api = useApiClient(),
    toast = useToaster(),
    cache = useQueryClient(),
    identity = useBusinessIdentity(),
    manage = useInspectionCan('manage'),
    w = useWork();
  const [baseline] = useState(row),
    [data, setData] = useState<Record<string, string>>(() => ({
      title: row?.title ?? '',
      type: row?.type ?? 'inspection',
      frequency: str(row?.payload.frequency) || 'daily',
      start: str(row?.payload.start) || today(),
      end: str(row?.payload.end) || today(),
      assigneeId: row?.assigneeId ?? '',
      notes: str(row?.payload.notes),
      day: today(),
      dueOn: row?.dueOn || today(),
      note: '',
      description: '',
      evidence: '',
      severity: 'normal',
      itemId: ((row?.payload.items ?? []) as Item[])[0]?.id ?? '',
    })),
    [assets, setAssets] = useState<string[]>(
      () => (row?.payload.assetIds ?? []) as string[],
    ),
    [items, setItems] = useState<Item[]>(
      () =>
        (row?.payload.items ?? [
          { id: 'item-1', name: '', standard: '' },
        ]) as Item[],
    ),
    [answers, setAnswers] = useState<Answer[]>(
      () => (row?.payload.results ?? []) as Answer[],
    ),
    [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false),
    [unknown, setUnknown] = useState(false),
    intentRef = useRef<Record<string, unknown> | undefined>(undefined);
  const leave = useLeave(dirty, w.busy),
    big = mode === 'new' || mode === 'edit' || mode === 'save',
    back = { pathname: path.slice(0, path.lastIndexOf('/')), search: l.search },
    title = t(mode === 'new' ? 'inspection.new' : 'inspection.confirmTitle', {
      action: t('inspection.actions.' + (mode === 'new' ? 'create' : mode)),
      name: row?.number,
    });
  const change = (key: string, value: string) => {
    if (w.busy || unknown) return;
    setDirty(true);
    const next = { ...data, [key]: value };
    setData(next);
    if (w.attempted) w.setErrors(validate(next));
  };
  const required =
    mode === 'new' || mode === 'edit'
      ? ['title', 'type', 'frequency', 'start', 'end', 'assigneeId']
      : mode === 'report'
        ? ['itemId', 'severity', 'description', 'assigneeId', 'dueOn']
        : mode === 'assign'
          ? ['assigneeId', 'dueOn', 'note']
          : mode === 'generate'
            ? ['day']
            : mode === 'save'
              ? []
              : mode === 'rectify'
                ? ['note', 'evidence']
                : ['note'];
  const validate = (
    nextData = data,
    nextAssets = assets,
    nextItems = items,
    nextAnswers = answers,
  ) => {
    const e: Record<string, string> = {};
    for (const k of required)
      if (!nextData[k]?.trim()) e[k] = t('inspection.required');
    if (mode === 'new' || mode === 'edit') {
      if (!nextAssets.length) e.assets = t('inspection.required');
      if (nextData.end < nextData.start) e.end = t('inspection.invalid');
      nextItems.forEach((i, n) => {
        if (!i.name.trim() || i.name.length > 100)
          e['item' + n] = t('inspection.invalid');
        if (!i.standard.trim() || i.standard.length > 500)
          e['item' + n + 'standard'] = t('inspection.invalid');
      });
    }
    if (mode === 'save')
      nextAnswers.forEach((a) => {
        if (
          (a.result === 'notApplicable' && !a.note.trim()) ||
          a.note.length > 1000
        )
          e['answer' + a.itemId] = t('inspection.invalid');
      });
    for (const [k, v] of Object.entries(nextData)) {
      const max =
        k === 'title'
          ? 100
          : k === 'description' || (k === 'note' && mode === 'rectify')
            ? 4000
            : 2000;
      if (v.length > max) e[k] = t('inspection.invalid');
    }
    return e;
  };
  const changeAssets = (v: string[]) => {
    setAssets(v);
    if (w.attempted) w.setErrors(validate(data, v));
  };
  const changeItems = (change: (v: Item[]) => Item[]) => {
    const next = change(items);
    setItems(next);
    if (w.attempted) w.setErrors(validate(data, assets, next));
  };
  const changeAnswers = (change: (v: Answer[]) => Answer[]) => {
    const next = change(answers);
    setAnswers(next);
    if (w.attempted) w.setErrors(validate(data, assets, items, next));
  };
  const send = async () => {
    if (w.busy) return;
    if (!w.focus(validate())) return;
    if (
      ['pass', 'return', 'archive', 'cancel', 'toRepair'].includes(mode) &&
      !confirm
    ) {
      setConfirm(true);
      return;
    }
    w.setBusy(true);
    w.setError(undefined);
    try {
      if (!intentRef.current) {
        let b: Record<string, unknown> = {};
        if (mode === 'new' || mode === 'edit')
          b = {
            values: {
              title: data.title,
              type: data.type,
              frequency: data.frequency,
              start: data.start,
              end: data.end,
              assigneeId: data.assigneeId,
              notes: data.notes,
              assetIds: assets,
              items: items.map((i) => ({ name: i.name, standard: i.standard })),
            },
          };
        else if (mode === 'save') b = { results: answers };
        else if (mode === 'generate') b = { day: data.day };
        else if (mode === 'report')
          b = Object.fromEntries(
            [
              'itemId',
              'severity',
              'description',
              'evidence',
              'assigneeId',
              'dueOn',
            ].map((k) => [k, data[k]]),
          );
        else if (mode === 'assign')
          b = Object.fromEntries(
            ['assigneeId', 'dueOn', 'note'].map((k) => [k, data[k]]),
          );
        else if (mode === 'rectify')
          b = { note: data.note, evidence: data.evidence };
        else b = { note: data.note };
        intentRef.current = {
          ...b,
          requestId: crypto.randomUUID(),
          ...(mode === 'new'
            ? {}
            : { action: mode, expectedVersion: baseline?.version }),
        };
      }
      const result = await api.request<{ data: Row }>({
        path:
          endpoint(kind) +
          (mode === 'new' ? '' : '/' + baseline?.id + '/actions'),
        method: 'POST',
        json: intentRef.current,
      });
      cache.setQueriesData<{ data: Row }>(
        {
          predicate: (q) =>
            q.queryKey[0] === 'hyl' &&
            q.queryKey[1] === endpoint(kind) + '/' + result.data.id &&
            q.queryKey[3] === identity[0] &&
            q.queryKey[4] === identity[1],
        },
        (old) => ({ data: { ...result.data, events: old?.data.events } }),
      );
      await cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'hyl' &&
          /^inspection|^repairOrders/.test(String(q.queryKey[1])),
      });
      leave.allow();
      setDirty(false);
      w.setBusy(false);
      setConfirm(false);
      toast.show({
        title: t('inspection.success', {
          name: result.data.number,
          action: t('inspection.actions.' + (mode === 'new' ? 'create' : mode)),
        }),
      });
      void navigate(back);
    } catch (e) {
      w.fail(e);
      if (!(e instanceof ApiClientError) || e.status >= 500) setUnknown(true);
      else {
        intentRef.current = undefined;
        setUnknown(false);
      }
      w.setBusy(false);
    }
  };
  const f = (name: string, multiline = false) => (
    <FormField
      key={name}
      name={name}
      label={t('inspection.fields.' + name)}
      value={data[name]}
      onChange={(v) => change(name, v)}
      required={required.includes(name)}
      error={w.errors[name]}
      multiline={multiline}
    />
  );
  const choice = (name: string, values: string[], group: string) => (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('inspection.fields.' + name)} *
      </FieldLabel>
      <Choice
        id={'cashier-' + name}
        value={data[name]}
        onChange={(v) => change(name, v)}
        options={values.map((v) => ({
          value: v,
          label: t('inspection.' + group + '.' + v),
        }))}
      />
      <FieldError>{w.errors[name]}</FieldError>
    </Field>
  );
  const date = (name: string) => (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('inspection.fields.' + name)} *
      </FieldLabel>
      <DateField
        id={'cashier-' + name}
        value={data[name]}
        onChange={(v) => change(name, v)}
      />
      <FieldError>{w.errors[name]}</FieldError>
    </Field>
  );
  const picker = (
    <>
      <Picker
        kind='inspectionAssignees'
        value={data.assigneeId ? [data.assigneeId] : []}
        caption={str(row?.payload.assigneeName)}
        onChange={(v) => change('assigneeId', v[0] ?? '')}
      />
      <FieldError>{w.errors.assigneeId}</FieldError>
    </>
  );
  const errors = (
    <>
      {w.error ? <BillingError error={w.error} /> : null}
      {unknown ? <p role='alert'>{t('inspection.unknown')}</p> : null}
      {w.conflict ? (
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            leave.allow();
            void reload();
          }}
        >
          {t('inspection.reload')}
        </Button>
      ) : null}
    </>
  );
  const body = (
    <form
      id='inspection-form'
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {errors}
      <fieldset
        disabled={w.busy || unknown || w.conflict}
        className='flex min-w-0 flex-col gap-4'
      >
        {mode === 'new' || mode === 'edit' ? (
          <>
            <Group title={t('inspection.basic')}>
              {f('title')}
              {choice('type', ['inspection', 'security', 'cleaning'], 'types')}
              {choice(
                'frequency',
                ['once', 'daily', 'weekly', 'monthly'],
                'frequencies',
              )}
              {date('start')}
              {date('end')}
              {picker}
              {f('notes', true)}
            </Group>
            <Group title={t('inspection.assets')}>
              <Picker
                kind='inspectionAssets'
                multiple
                value={assets}
                captions={Object.fromEntries(
                  (
                    (row?.payload.assets ?? []) as {
                      id: string;
                      name: string;
                      number: string;
                    }[]
                  ).map((a) => [a.id, a.number + ' · ' + a.name]),
                )}
                onChange={(v) => {
                  changeAssets(v);
                  setDirty(true);
                }}
              />
              <FieldError>{w.errors.assets}</FieldError>
            </Group>
            <Group title={t('inspection.checklist')}>
              {items.map((item, n) => (
                <div
                  key={item.id}
                  className='flex flex-col gap-3 border-b pb-3'
                >
                  {(['name', 'standard'] as const).map((k) => (
                    <FormField
                      key={k}
                      name={'item' + n + (k === 'name' ? '' : k)}
                      label={t('inspection.fields.' + k) + ' ' + (n + 1)}
                      required
                      value={item[k]}
                      error={
                        w.errors['item' + n + (k === 'name' ? '' : 'standard')]
                      }
                      multiline={k === 'standard'}
                      onChange={(v) => {
                        setDirty(true);
                        changeItems((a) =>
                          a.map((x, i) => (i === n ? { ...x, [k]: v } : x)),
                        );
                      }}
                    />
                  ))}
                  <Button
                    type='button'
                    variant='outline'
                    disabled={items.length === 1}
                    onClick={() => {
                      setDirty(true);
                      changeItems((a) => a.filter((_, i) => i !== n));
                    }}
                  >
                    {t('inspection.remove')}
                  </Button>
                </div>
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={items.length >= 20}
                onClick={() => {
                  setDirty(true);
                  changeItems((a) => [
                    ...a,
                    { id: crypto.randomUUID(), name: '', standard: '' },
                  ]);
                }}
              >
                {t('inspection.addItem')}
              </Button>
            </Group>
          </>
        ) : mode === 'save' ? (
          <>
            <p>{t('inspection.partialHelp')}</p>
            {items.map((item) => {
              const a = answers.find((a) => a.itemId === item.id);
              return (
                <Group key={item.id} title={item.name}>
                  <LongText>{item.standard || '—'}</LongText>
                  <Field>
                    <FieldLabel htmlFor={'cashier-answer' + item.id}>
                      {t('inspection.fields.result')}
                    </FieldLabel>
                    <Choice
                      id={'cashier-answer' + item.id}
                      disabled={a?.result === 'abnormal'}
                      value={a?.result ?? ''}
                      onChange={(v) => {
                        setDirty(true);
                        changeAnswers((all) =>
                          v
                            ? [
                                ...all.filter((x) => x.itemId !== item.id),
                                {
                                  itemId: item.id,
                                  result: v,
                                  note: a?.note ?? '',
                                },
                              ]
                            : all.filter((x) => x.itemId !== item.id),
                        );
                      }}
                      options={[
                        { value: '', label: t('inspection.unanswered') },
                        ...[
                          'normal',
                          'notApplicable',
                          ...(a?.result === 'abnormal' ? ['abnormal'] : []),
                        ].map((v) => ({
                          value: v,
                          label: t('inspection.results.' + v),
                        })),
                      ]}
                    />
                    <FieldError>{w.errors['answer' + item.id]}</FieldError>
                  </Field>
                  {a ? (
                    <FormField
                      name={'note' + item.id}
                      label={t('inspection.fields.note')}
                      value={a.note}
                      multiline
                      required={a.result === 'notApplicable'}
                      onChange={(v) => {
                        setDirty(true);
                        changeAnswers((all) =>
                          all.map((x) =>
                            x.itemId === item.id ? { ...x, note: v } : x,
                          ),
                        );
                      }}
                    />
                  ) : null}
                </Group>
              );
            })}
          </>
        ) : (
          <>
            {mode === 'generate' ? date('day') : null}
            {mode === 'assign' ? (
              <>
                {picker}
                {date('dueOn')}
              </>
            ) : null}
            {mode === 'report' ? (
              <>
                <Field>
                  <FieldLabel htmlFor='cashier-itemId'>
                    {t('inspection.fields.itemId')} *
                  </FieldLabel>
                  <Choice
                    id='cashier-itemId'
                    value={data.itemId}
                    onChange={(v) => change('itemId', v)}
                    options={items.map((i) => ({ value: i.id, label: i.name }))}
                  />
                </Field>
                {choice(
                  'severity',
                  ['low', 'normal', 'high', 'urgent'],
                  'severities',
                )}
                {f('description', true)}
                {f('evidence', true)}
                {manage.can ? (
                  picker
                ) : (
                  <p>
                    {t('inspection.noDirectory')} ·{' '}
                    {str(row?.payload.assigneeName)}
                  </p>
                )}
                {date('dueOn')}
              </>
            ) : null}
            {!['report', 'generate'].includes(mode) ? f('note', true) : null}
            {mode === 'rectify' ? f('evidence', true) : null}
          </>
        )}
      </fieldset>
    </form>
  );
  const footer = (
    <>
      <Button
        variant='outline'
        disabled={w.busy}
        onClick={() =>
          void Promise.resolve(leave.guard()).then((ok) => {
            if (ok) void navigate(back);
          })
        }
      >
        {t('inspection.cancel')}
      </Button>
      <Button
        type='submit'
        form='inspection-form'
        disabled={w.busy || w.conflict}
      >
        {t(
          w.busy
            ? 'inspection.saving'
            : big
              ? 'inspection.save'
              : 'inspection.actions.' + mode,
        )}
      </Button>
    </>
  );
  const confirmations = (
    <>
      <Confirm
        open={leave.discard}
        onOpenChange={(v) => {
          if (!v) leave.dismiss();
        }}
        title={t('inspection.discardTitle')}
        label={t('inspection.discard')}
        destructive
        busy={false}
        onConfirm={() => {
          setDirty(false);
          leave.accept(() => void navigate(back));
        }}
      >
        {t('inspection.discardHelp')}
      </Confirm>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={title}
        label={t('inspection.actions.' + (mode === 'new' ? 'create' : mode))}
        busy={w.busy}
        destructive={['return', 'archive', 'cancel'].includes(mode)}
        rich
        onConfirm={() => void send()}
      >
        <p>
          {t(
            ['pass', 'return', 'archive', 'cancel', 'toRepair'].includes(mode)
              ? 'inspection.consequences.' +
                  (mode === 'pass'
                    ? kind === 'issues'
                      ? 'passIssue'
                      : 'passTask'
                    : mode)
              : 'inspection.confirmHelp',
          )}
        </p>
        {errors}
      </Confirm>
    </>
  );
  return big ? (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={back}
          onClick={(e) => {
            e.preventDefault();
            void Promise.resolve(leave.guard()).then((ok) => {
              if (ok) void navigate(back);
            });
          }}
        />
        <PageHeader title={title} description={t('inspection.description')} />
        <div className='flex max-w-3xl flex-col gap-4'>
          {body}
          <div className='flex justify-end gap-2'>{footer}</div>
        </div>
        {confirmations}
      </PageContainer>
    </RouteChildPage>
  ) : (
    <RouteDialog
      title={title}
      closeTo={back}
      beforeClose={leave.guard}
      className={
        ['report', 'assign', 'rectify'].includes(mode)
          ? undefined
          : 'sm:max-w-md'
      }
      footer={footer}
    >
      {body}
      {confirmations}
    </RouteDialog>
  );
}
