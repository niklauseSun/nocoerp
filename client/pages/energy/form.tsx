import { useBusinessIdentity } from '../hyl/hooks.js';
import { LegacyPicker } from './legacy-picker.js';
import { scalar, kindFrom, useEnergyCan } from './helpers.js';
import { useState, useEffect, useRef } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Field, FieldLabel } from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import { Checkbox } from '#components/ui/checkbox';
import { useWork } from '../cashier/work.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  type Item,
  type Page,
  Picker,
  Group,
  Values,
  Money,
  FormField,
  DateField,
  Choice,
  Confirm,
  LoadingRows,
  BillingError,
  Paged,
  Search,
  Day,
  Quantity,
} from './common.js';
type Fields = Record<string, string>;
type Mode =
  | 'newMeter'
  | 'editMeter'
  | 'newReading'
  | 'editReading'
  | 'submit'
  | 'reject'
  | 'void'
  | 'assign'
  | 'handover'
  | 'stop'
  | 'adopt'
  | 'generate';
function modeOf(path: string): Mode {
  const last = path.split('/').at(-1);
  if (last === 'new')
    return kindFrom(path) === 'meters' ? 'newMeter' : 'newReading';
  if (last === 'readingNew') return 'newReading';
  if (last === 'edit')
    return kindFrom(path) === 'meters' ? 'editMeter' : 'editReading';
  return last as Mode;
}
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    new Date(),
  );
export default function EnergyForm() {
  const [revision, setRevision] = useState(0),
    cache = useQueryClient();
  useCoverFocus();
  const path = useResolvedPath('.').pathname,
    p = useParams(),
    l = useLocation(),
    mode = modeOf(path),
    { t } = useTranslation(),
    permission = [
      'newMeter',
      'editMeter',
      'assign',
      'handover',
      'stop',
      'adopt',
    ].includes(mode)
      ? 'meterWrite'
      : mode === 'generate'
        ? 'billGenerate'
        : mode === 'reject'
          ? 'readingReview'
          : 'readingWrite',
    can = useEnergyCan(permission),
    existing = [
      'editMeter',
      'editReading',
      'submit',
      'reject',
      'void',
      'assign',
      'handover',
      'stop',
    ].includes(mode),
    id =
      mode === 'editReading' || ['submit', 'reject', 'void'].includes(mode)
        ? p.energyReadingId
        : p.energyMeterId,
    record = useBusinessQuery<{ data: Item }>(
      (['editReading', 'submit', 'reject', 'void'].includes(mode)
        ? 'energyReadings/'
        : 'energyMeters/') + id,
      undefined,
      existing && !!id && can.can,
    );
  useEffect(() => {
    if (record.error instanceof ApiClientError && record.error.status === 404)
      void cache.invalidateQueries({
        queryKey: [
          'hyl',
          ['editReading', 'submit', 'reject', 'void'].includes(mode)
            ? 'energyReadings'
            : 'energyMeters',
        ],
      });
  }, [record.error, cache, mode]);
  return !can.can ? (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={{
            pathname: path.slice(0, path.lastIndexOf('/')),
            search: l.search,
          }}
        />
        <p>{t('energy.restricted')}</p>
      </PageContainer>
    </RouteChildPage>
  ) : existing &&
    (!record.data ||
      record.isPlaceholderData ||
      (record.error instanceof ApiClientError &&
        [403, 404].includes(record.error.status))) ? (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={{
            pathname: path.slice(0, path.lastIndexOf('/')),
            search: l.search,
          }}
        />
        {record.error ? (
          <BillingError
            error={record.error}
            retry={() => void record.refetch()}
          />
        ) : (
          <LoadingRows />
        )}
      </PageContainer>
    </RouteChildPage>
  ) : (
    <Editor
      key={path + ':' + revision}
      mode={mode}
      initial={record.data?.data}
      path={path}
      onReload={async () => {
        if (existing) await record.refetch();
        else await cache.invalidateQueries({ queryKey: ['hyl'] });
        setRevision((v) => v + 1);
      }}
    />
  );
}
function Editor({
  mode,
  initial: initialRecord,
  path,
  onReload,
}: {
  mode: Mode;
  initial?: Item;
  path: string;
  onReload: () => Promise<void>;
}) {
  const [initial] = useState(initialRecord),
    mayCloseRef = useRef(false);
  const p = useParams(),
    l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    cache = useQueryClient(),
    identity = useBusinessIdentity(),
    toast = useToaster(),
    { t } = useTranslation(),
    w = useWork(),
    [q] = useSearchParams(),
    parent = path.slice(0, path.lastIndexOf('/')),
    [values, setValues] = useState<Fields>(() => ({
      ...Object.fromEntries(
        Object.entries(initial?.payload ?? {}).map(([k, v]) => [k, scalar(v)]),
      ),
      code: scalar(initial?.code),
      name: scalar(initial?.name),
      type: scalar(initial?.type) || 'water',
      assetId:
        initial?.assetId ??
        p.assetId ??
        (path.startsWith('/assets/') ? p.id : '') ??
        '',
      contractId:
        initial?.contractId ??
        q.get('energyContractId') ??
        (path.startsWith('/contracts/') ? p.id : '') ??
        '',
      meterId: initial?.meterId ?? p.energyMeterId ?? '',
      assignmentId: scalar(initial?.assignmentId),
      start: initial?.start ?? '',
      end: initial?.end ?? '',
      current: scalar(initial?.current),
      installedOn: scalar(initial?.installedOn) || today(),
      openingReading: scalar(initial?.openingReading) || '0',
      multiplier: scalar(initial?.multiplier) || '1',
      openingEvidence: scalar(initial?.openingEvidence),
      evidence: scalar(initial?.evidence),
      notes: scalar(initial?.notes),
      reason: '',
      nextContractId: '',
      readingId: '',
      meterCode: '',
      feeType: 'water',
      month: today().slice(0, 7),
      part: 'month',
      dueDate: today(),
      zeroReason: '',
      zeroEvidence: '',
    })),
    [selected, setSelected] = useState<string[]>(
      (q.get('energyReadingIds') ?? '').split(',').filter(Boolean),
    ),
    [sourcePage, setSourcePage] = useState(1),
    [assignmentPage, setAssignmentPage] = useState(1),
    [assignmentSearch, setAssignmentSearch] = useState(''),
    [handoverPage, setHandoverPage] = useState(1),
    [handoverSearch, setHandoverSearch] = useState(''),
    [requiresZero, setRequiresZero] = useState(false),
    [preview, setPreview] = useState<Record<string, unknown>>(),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false),
    [reloadConfirm, setReloadConfirm] = useState(false),
    [dirty, setDirty] = useState(false),
    [unknown, setUnknown] = useState(false),
    [pending, setPending] = useState('');
  const meter = useBusinessQuery<{ data: Item }>(
      'energyMeters/' + values.meterId,
      undefined,
      !!values.meterId &&
        ['newReading', 'editReading', 'submit'].includes(mode),
    ),
    assignments = useBusinessQuery<Page<Item>>(
      'energyAssignments',
      {
        meterId: values.meterId || initial?.id || '',
        q: assignmentSearch,
        page: assignmentPage,
        pageSize: 20,
        ...(mode === 'handover' ? { status: 'active' } : {}),
      },
      ['newReading', 'editReading', 'submit', 'handover'].includes(mode) &&
        !!(values.meterId || initial?.id),
    ),
    handoverReadings = useBusinessQuery<Page<Item>>(
      'energyReadings',
      {
        meterId: initial?.id ?? '',
        assignmentId: values.assignmentId,
        status: 'approved',
        q: handoverSearch,
        page: handoverPage,
        pageSize: 20,
      },
      mode === 'handover' && !!initial?.id,
    ),
    sources = useBusinessQuery<Page<Item>>(
      'energyBillingSources',
      {
        contractId: values.contractId,
        billingStatus: 'unbilled',
        page: sourcePage,
        pageSize: 20,
      },
      mode === 'generate' && !!values.contractId,
    );
  const readingMode = ['newReading', 'editReading', 'submit'].includes(mode),
    meterMode = ['newMeter', 'editMeter'].includes(mode),
    small =
      ['assign', 'reject', 'void'].includes(mode) ||
      (mode === 'stop' &&
        (initial?.readings as Page<Item> | undefined)?.meta.total === 0 &&
        (initial?.assignments as Page<Item> | undefined)?.meta.total === 0),
    previewMode = ['assign', 'handover', 'stop', 'adopt', 'generate'].includes(
      mode,
    ),
    disabled = w.busy || unknown;
  const required = meterMode
    ? [
        'code',
        'name',
        'assetId',
        'installedOn',
        'openingReading',
        'multiplier',
        'openingEvidence',
      ]
    : readingMode
      ? [
          'meterId',
          'start',
          'end',
          ...(mode === 'submit' ? ['current', 'evidence'] : []),
        ]
      : mode === 'assign'
        ? ['contractId', 'start', 'openingReading', 'evidence']
        : mode === 'handover'
          ? ['assignmentId', 'end', 'readingId', 'evidence']
          : mode === 'adopt'
            ? [
                'contractId',
                'assetId',
                'meterCode',
                'name',
                'start',
                'openingReading',
                'multiplier',
                'evidence',
              ]
            : mode === 'generate'
              ? [
                  'contractId',
                  'month',
                  'part',
                  'dueDate',
                  ...(requiresZero ? ['zeroReason', 'zeroEvidence'] : []),
                ]
              : mode === 'stop'
                ? ['end', 'reason', 'evidence']
                : ['reason'];
  function validate(v: Fields) {
    const errors: Fields = {};
    for (const k of required)
      if (!v[k]?.trim()) errors[k] = t('energy.required');
    for (const k of ['current', 'openingReading', 'multiplier'])
      if (v[k] && !/^\d{1,12}(\.\d{1,4})?$/.test(v[k]))
        errors[k] = t('energy.invalidNumber');
    if (v.multiplier && Number(v.multiplier) <= 0)
      errors.multiplier = t('energy.positiveMultiplier');
    if (v.start && v.end && v.start > v.end)
      errors.end = t('energy.invalidDate');
    for (const [k, value] of Object.entries(v)) {
      const limit = [
        'evidence',
        'openingEvidence',
        'reason',
        'zeroReason',
        'zeroEvidence',
      ].includes(k)
        ? 500
        : k === 'notes'
          ? 1000
          : ['name', 'code', 'meterCode'].includes(k)
            ? 100
            : undefined;
      if (limit && value.length > limit) errors[k] = t('energy.invalidLength');
    }
    if (mode === 'adopt' && Number(v.legacyDraftCount || '0') > 0)
      errors.meterCode = t('energy.legacyDraftBlocked');
    if (mode === 'generate' && !selected.length)
      errors.readingIds = t('energy.required');
    return errors;
  }
  function update(k: string, v: string) {
    const next = { ...values, [k]: v };
    if (k === 'contractId') {
      setSelected([]);
      setSourcePage(1);
      setRequiresZero(false);
    }
    if (k === 'meterId') {
      next.assignmentId = '';
      setAssignmentPage(1);
      setAssignmentSearch('');
    }
    if (k === 'assignmentId') {
      next.readingId = '';
      setHandoverPage(1);
      setHandoverSearch('');
    }
    setValues(next);
    setDirty(true);
    setPreview(undefined);
    setRequestId(crypto.randomUUID());
    if (w.attempted) w.setErrors(validate(next));
  }
  const search = () => {
      const n = new URLSearchParams(l.search);
      n.delete('energyReadingIds');
      n.delete('energyContractId');
      return n.toString();
    },
    exit = () => void navigate({ pathname: parent, search: search() }),
    close = () => {
      if (w.busy) return;
      if (dirty || unknown) setDiscard(true);
      else exit();
    };
  function payload() {
    const pick = (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, values[k] ?? '']));
    if (meterMode)
      return pick([
        'code',
        'name',
        'type',
        'assetId',
        'installedOn',
        'openingReading',
        'multiplier',
        'openingEvidence',
        'notes',
      ]);
    if (readingMode)
      return {
        ...pick([
          'meterId',
          'assignmentId',
          'start',
          'end',
          'evidence',
          'notes',
        ]),
        current: values.current || null,
      };
    if (mode === 'assign')
      return pick([
        'contractId',
        'start',
        'openingReading',
        'evidence',
        'notes',
      ]);
    if (mode === 'handover')
      return pick([
        'assignmentId',
        'end',
        'readingId',
        'evidence',
        'nextContractId',
        'notes',
      ]);
    if (mode === 'adopt')
      return pick([
        'contractId',
        'assetId',
        'meterCode',
        'feeType',
        'name',
        'start',
        'openingReading',
        'multiplier',
        'evidence',
      ]);
    if (mode === 'stop') return pick(['end', 'reason', 'evidence']);
    if (mode === 'generate')
      return {
        ...pick([
          'contractId',
          'month',
          'part',
          'dueDate',
          'zeroReason',
          'zeroEvidence',
          'notes',
        ]),
        readingIds: selected,
      };
    return undefined;
  }
  async function run(write = true) {
    if (!w.focus(validate(values))) return;
    if (write && previewMode && !preview?.previewHash) return;
    w.setBusy(true);
    w.setError(undefined);
    setPending(write ? 'save' : 'preview');
    const meterId = initial?.id,
      readingId = initial?.id;
    let endpoint: string,
      method: 'POST' | 'PATCH' = 'POST';
    if (mode === 'newMeter') endpoint = 'energyMeters';
    else if (mode === 'editMeter') {
      endpoint = 'energyMeters/' + meterId;
      method = 'PATCH';
    } else if (mode === 'newReading') endpoint = 'energyReadings';
    else if (mode === 'editReading') {
      endpoint = 'energyReadings/' + readingId;
      method = 'PATCH';
    } else if (['submit', 'reject', 'void'].includes(mode))
      endpoint = 'energyReadings/' + readingId + '/' + mode;
    else if (mode === 'adopt')
      endpoint = 'energyMeters/' + (write ? 'adopt' : 'previewAdoption');
    else if (mode === 'generate')
      endpoint = 'energyBilling' + (write ? '' : '/preview');
    else
      endpoint =
        'energyMeters/' +
        meterId +
        '/' +
        (mode === 'assign'
          ? write
            ? 'assignments'
            : 'previewAssignment'
          : mode === 'handover'
            ? write
              ? 'handover'
              : 'previewHandover'
            : write
              ? 'stop'
              : 'previewStop');
    const op = {
        requestId,
        expectedVersion: initial?.version ?? 0,
        previewHash: write ? scalar(preview?.previewHash) : '',
        reason: values.reason,
        expectedMeterVersion: meter.data?.data.version ?? initial?.meterVersion,
      },
      json =
        mode === 'newMeter'
          ? { ...payload(), ...op }
          : { ...op, ...(payload() ? { values: payload() } : {}) };
    try {
      const response = await api.request<{ data: Record<string, unknown> }>({
        path: endpoint,
        method,
        json,
      });
      if (!write) {
        setPreview(response.data);
        setRequiresZero(!!response.data.requiresZeroEvidence);
        setRequestId(crypto.randomUUID());
        return;
      }
      setUnknown(false);
      setConfirm(false);
      if (initial) {
        const meterRecord = [
          'editMeter',
          'assign',
          'handover',
          'stop',
        ].includes(mode);
        const latest = meterRecord
          ? (
              await api.request<{ data: Item }>({
                path: 'energyMeters/' + initial.id,
              })
            ).data
          : response.data;
        cache.setQueriesData(
          {
            predicate: (q) =>
              q.queryKey[3] === identity[0] && q.queryKey[4] === identity[1],
            queryKey: [
              'hyl',
              (meterRecord ? 'energyMeters/' : 'energyReadings/') + initial.id,
            ],
          },
          (old: { data: Item } | undefined) =>
            old ? { ...old, data: { ...old.data, ...latest } } : old,
        );
      }
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toast.show({
        title: t(mode === 'generate' ? 'energy.generated' : 'energy.saved', {
          number: scalar(response.data.number) || initial?.number,
        }),
        type: 'success',
      });
      mayCloseRef.current = true;
      setDirty(false);
      w.setBusy(false);
      exit();
    } catch (e) {
      w.fail(e);
      if (e instanceof ApiClientError) {
        const fields = (
          e.payload as { error?: { fieldViolations?: { field: string }[] } }
        )?.error?.fieldViolations;
        if (fields?.length)
          w.focus(
            Object.fromEntries(
              fields.map((v) => [
                v.field.replace(/^(json|body)\./, '').replace(/^values\./, ''),
                t('energy.invalidField'),
              ]),
            ),
          );
      }
      if (write && (!(e instanceof ApiClientError) || e.status >= 500))
        setUnknown(true);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  }
  const field = (name: string, decimal = false, multiline = false) => (
    <FormField
      key={name}
      name={name}
      label={t('energy.fields.' + name)}
      required={required.includes(name)}
      value={values[name] ?? ''}
      onChange={(v) => update(name, v)}
      disabled={
        disabled || (mode === 'editMeter' && !['name', 'notes'].includes(name))
      }
      error={w.errors[name]}
      decimal={decimal}
      multiline={multiline}
    />
  );
  const date = (name: string) => (
    <Field key={name}>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('energy.fields.' + name)}
        {required.includes(name) ? ' *' : ''}
      </FieldLabel>
      <DateField
        id={'cashier-' + name}
        value={values[name] ?? ''}
        onChange={(v) => update(name, v)}
        disabled={disabled}
      />
      {w.errors[name] ? (
        <p className='text-destructive'>{w.errors[name]}</p>
      ) : null}
    </Field>
  );
  const picker = (
    name: string,
    kind: 'assets' | 'contracts' | 'energyMeters',
  ) => (
    <Picker
      key={name}
      name={name}
      kind={kind}
      value={values[name] ?? ''}
      onChange={(v) => update(name, v)}
      required={name !== 'nextContractId'}
      disabled={
        disabled ||
        mode === 'editMeter' ||
        (readingMode && mode !== 'newReading' && name === 'meterId')
      }
      error={w.errors[name]}
    />
  );
  const actionKey =
    mode === 'generate'
      ? 'generateDraft'
      : mode === 'newMeter'
        ? 'newMeter'
        : mode === 'newReading'
          ? 'saveDraft'
          : mode === 'editReading' || mode === 'editMeter'
            ? 'save'
            : mode;
  const formId = 'energy-operation-form';
  const attemptWrite = () => {
    if (w.busy) return;
    if (!w.focus(validate(values))) return;
    if (previewMode && !preview?.previewHash) return;
    if (unknown) void run(true);
    else if (previewMode || ['reject', 'void'].includes(mode)) setConfirm(true);
    else void run(true);
  };
  const footer = (
    <div className='flex flex-wrap justify-end gap-2'>
      <Button
        type='button'
        variant='outline'
        disabled={disabled}
        onClick={close}
      >
        {t('energy.cancel')}
      </Button>
      {previewMode ? (
        <Button
          type='button'
          variant='outline'
          disabled={disabled}
          onClick={() => void run(false)}
        >
          {w.busy && pending === 'preview' ? <Spinner /> : null}
          {t('energy.preview')}
        </Button>
      ) : null}
      <Button
        disabled={w.busy || (previewMode && !preview?.previewHash)}
        type='submit'
        form={formId}
      >
        {w.busy && pending === 'save' ? <Spinner /> : null}
        {t('energy.' + actionKey)}
      </Button>
    </div>
  );
  const form = (
    <>
      {!small ? (
        <PageHeader
          title={t('energy.formTitles.' + mode, {
            number: initial?.number ?? '',
          })}
          description={initial?.number ?? t('energy.description')}
        />
      ) : null}
      {w.error ? <BillingError error={w.error} /> : null}
      {unknown ? <p>{t('energy.unknown')}</p> : null}
      {w.conflict ? (
        <Button
          variant='outline'
          disabled={w.busy}
          onClick={() => setReloadConfirm(true)}
        >
          {t('energy.reload')}
        </Button>
      ) : null}
      {meterMode ? (
        <>
          <Group title={t('energy.basic')}>
            {field('code')}
            {field('name')}
            <Choice
              value={values.type}
              disabled={disabled || mode === 'editMeter'}
              onChange={(v) => update('type', v)}
              ariaLabel={t('energy.fields.type')}
              options={['water', 'electricity'].map((value) => ({
                value,
                label: t('energy.types.' + value),
              }))}
            />
            {picker('assetId', 'assets')}
            {date('installedOn')}
          </Group>
          <Group title={t('energy.calibration')}>
            {field('openingReading', true)}
            {field('multiplier', true)}
            {field('openingEvidence', false, true)}
          </Group>
        </>
      ) : null}
      {readingMode ? (
        <>
          <Group title={t('energy.basic')}>
            {picker('meterId', 'energyMeters')}
            <Search
              value={assignmentSearch}
              onChange={(v) => {
                setAssignmentSearch(v);
                setAssignmentPage(1);
              }}
              placeholder={t('energy.searchAssignment')}
            />
            {assignments.error ? (
              <BillingError error={assignments.error} />
            ) : (
              <Choice
                ariaLabel={t('energy.fields.assignmentId')}
                value={values.assignmentId}
                disabled={disabled || mode !== 'newReading'}
                onChange={(v) => {
                  update('assignmentId', v);
                  setValues((old) => ({
                    ...old,
                    assignmentCaption: v
                      ? ((assignments.data?.data.find((a) => a.id === v)
                          ?.payload.contractNumber as string) ?? '')
                      : t('energy.publicMeter'),
                  }));
                }}
                options={[
                  { value: '', label: t('energy.publicMeter') },
                  ...(assignments.data?.data ?? []).map((a) => ({
                    value: a.id,
                    label: [a.number, a.contractNumber, a.start, a.end]
                      .map(scalar)
                      .join(' · '),
                  })),
                ]}
              />
            )}
            {values.assignmentCaption ? (
              <p className='text-sm text-muted-foreground'>
                {values.assignmentCaption}
              </p>
            ) : null}
            {assignments.data ? (
              <Paged
                meta={assignments.data.meta}
                busy={assignments.isFetching}
                onChange={setAssignmentPage}
              />
            ) : null}
            <Values
              values={{
                previous:
                  initial?.previous ??
                  meter.data?.data.latestReading ??
                  meter.data?.data.openingReading,
                multiplier: meter.data?.data.multiplier,
                unit: meter.data?.data.unit,
              }}
            />
            {date('start')}
            {date('end')}
            {field('current', true)}
            <p className='text-sm text-muted-foreground'>
              {t('energy.submitRequired')}
            </p>
            {field('evidence', false, true)}
          </Group>
        </>
      ) : null}
      {mode === 'assign' ? (
        <>
          {picker('contractId', 'contracts')}
          {date('start')}
          {field('openingReading', true)}
          {field('evidence', false, true)}
        </>
      ) : null}
      {mode === 'handover' ? (
        <>
          <Group title={t('energy.assignments')}>
            <Search
              value={assignmentSearch}
              onChange={(v) => {
                setAssignmentSearch(v);
                setAssignmentPage(1);
              }}
              placeholder={t('energy.searchAssignment')}
            />
            <Choice
              id='cashier-assignmentId'
              ariaLabel={t('energy.fields.assignmentId')}
              value={values.assignmentId}
              disabled={disabled}
              onChange={(v) => {
                update('assignmentId', v);
                setValues((old) => ({
                  ...old,
                  assignmentCaption: v
                    ? ((assignments.data?.data.find((a) => a.id === v)?.payload
                        .contractNumber as string) ?? '')
                    : t('energy.publicMeter'),
                }));
              }}
              options={(assignments.data?.data ?? [])
                .filter((a) => !a.end)
                .map((a) => ({
                  value: a.id,
                  label: scalar(a.contractNumber) + ' · ' + a.start,
                }))}
            />
            {values.assignmentCaption ? (
              <p className='text-sm text-muted-foreground'>
                {values.assignmentCaption}
              </p>
            ) : null}
            {assignments.data ? (
              <Paged
                meta={assignments.data.meta}
                busy={assignments.isFetching}
                onChange={setAssignmentPage}
              />
            ) : null}
            {w.errors.assignmentId ? (
              <p className='text-destructive'>{w.errors.assignmentId}</p>
            ) : null}
            {date('end')}
            <Search
              value={handoverSearch}
              onChange={(v) => {
                setHandoverSearch(v);
                setHandoverPage(1);
              }}
              placeholder={t('energy.searchFinalReading')}
            />
            <Field>
              <FieldLabel htmlFor='cashier-readingId'>
                {t('energy.fields.readingId')} *
              </FieldLabel>
              <Choice
                id='cashier-readingId'
                value={values.readingId}
                disabled={disabled}
                onChange={(v) => {
                  const chosen = handoverReadings.data?.data.find(
                    (r) => r.id === v,
                  );
                  update('readingId', v);
                  setValues((old) => ({
                    ...old,
                    readingCaption: chosen
                      ? chosen.number +
                        ' · ' +
                        chosen.end +
                        ' · ' +
                        scalar(chosen.current)
                      : '',
                    end: chosen?.end ?? old.end,
                  }));
                }}
                options={(handoverReadings.data?.data ?? [])
                  .filter((r) => scalar(r.assignmentId) === values.assignmentId)
                  .map((r) => ({
                    value: r.id,
                    label: [r.number, r.start, r.end, scalar(r.current)].join(
                      ' · ',
                    ),
                  }))}
              />
              {handoverReadings.error ? (
                <BillingError error={handoverReadings.error} />
              ) : null}
              {w.errors.readingId ? (
                <p className='text-destructive'>{w.errors.readingId}</p>
              ) : null}
            </Field>
            {values.readingCaption ? (
              <p className='text-sm text-muted-foreground'>
                {values.readingCaption}
              </p>
            ) : null}
            {handoverReadings.data ? (
              <Paged
                meta={handoverReadings.data.meta}
                busy={handoverReadings.isFetching}
                onChange={setHandoverPage}
              />
            ) : null}
            {field('evidence', false, true)}
          </Group>
          <Group title={t('energy.nextAssignment')}>
            {picker('nextContractId', 'contracts')}
            <p className='text-sm text-muted-foreground'>
              {t('energy.handoverHelp')}
            </p>
          </Group>
        </>
      ) : null}
      {mode === 'adopt' ? (
        <>
          {picker('contractId', 'contracts')}
          <LegacyPicker
            key={values.contractId}
            contractId={values.contractId}
            disabled={disabled}
            onSelect={(candidate) => {
              setValues((old) => ({
                ...old,
                assetId: candidate.assetId,
                assetName: candidate.assetName,
                meterCode: candidate.meterCode,
                feeType: candidate.feeType,
                start: candidate.start,
                openingReading: candidate.openingReading,
                multiplier: candidate.multiplier,
                name: candidate.meterCode,
                legacyDraftCount: String(candidate.draftCount),
              }));
              setDirty(true);
              setPreview(undefined);
              setRequestId(crypto.randomUUID());
            }}
          />
          <Group title={t('energy.calibration')}>
            <Values
              values={{
                asset: values.assetName,
                meterCode: values.meterCode,
                type: t('energy.types.' + values.feeType),
                start: values.start,
                openingReading: values.openingReading,
                multiplier: values.multiplier,
              }}
            />
            {field('name')}
            {field('evidence', false, true)}
          </Group>
        </>
      ) : null}
      {mode === 'stop' ? (
        <>
          {date('end')}
          {field('reason', false, true)}
          {field('evidence', false, true)}
        </>
      ) : null}
      {mode === 'reject' || mode === 'void'
        ? field('reason', false, true)
        : null}
      {mode === 'generate' ? (
        <>
          <Group title={t('energy.basic')}>
            {picker('contractId', 'contracts')}
            <Field>
              <FieldLabel htmlFor='cashier-month'>
                {t('energy.fields.month')} *
              </FieldLabel>
              <DateField
                id='cashier-month'
                month
                value={values.month}
                onChange={(v) => update('month', v)}
                disabled={disabled}
              />
            </Field>
            <Choice
              ariaLabel={t('energy.fields.part')}
              value={values.part}
              disabled={disabled}
              onChange={(v) => update('part', v)}
              options={['month', 'first', 'second'].map((value) => ({
                value,
                label: t('billing.parts.' + value),
              }))}
            />
            {date('dueDate')}
          </Group>
          <Group title={t('energy.sources')}>
            <div
              id='cashier-readingIds'
              tabIndex={-1}
              className='text-sm text-muted-foreground'
            >
              {t('energy.selectionHelp')}
            </div>
            {sources.error ? (
              <BillingError
                error={sources.error}
                retry={() => void sources.refetch()}
              />
            ) : !sources.data ? (
              <p>{t('energy.chooseContract')}</p>
            ) : (
              <>
                {sources.data.data.map((r) => (
                  <label key={r.id} className='flex items-center gap-2'>
                    <Checkbox
                      checked={selected.includes(r.id)}
                      disabled={
                        disabled ||
                        (selected.length >= 50 && !selected.includes(r.id))
                      }
                      onCheckedChange={(v) => {
                        setSelected((old) =>
                          v ? [...old, r.id] : old.filter((id) => id !== r.id),
                        );
                        setPreview(undefined);
                        setDirty(true);
                        setRequestId(crypto.randomUUID());
                      }}
                    />
                    {r.number} · {scalar(r.meterCode)} · <Day value={r.start} />{' '}
                    – <Day value={r.end} /> · <Quantity value={r.usage} />
                  </label>
                ))}
                <Paged
                  meta={sources.data.meta}
                  busy={sources.isFetching}
                  onChange={(page) => {
                    setSourcePage(page);
                    setSelected([]);
                    setPreview(undefined);
                  }}
                />
              </>
            )}
            {w.errors.readingIds ? (
              <p className='text-destructive'>{w.errors.readingIds}</p>
            ) : null}
          </Group>
          {requiresZero ? (
            <Group title={t('energy.zeroHelp')}>
              {field('zeroReason', false, true)}
              {field('zeroEvidence', false, true)}
            </Group>
          ) : null}
        </>
      ) : null}
      {!['reject', 'void', 'stop', 'adopt'].includes(mode)
        ? field('notes', false, true)
        : null}
      {preview ? (
        <Group title={t('energy.preview')}>
          {mode === 'generate' ? (
            <>
              <Money cents={scalar(preview.amountCents) || '0'} />
              {(
                preview.lines as
                  | {
                      payload: Record<string, unknown>;
                      feeType: string;
                      amountCents: string;
                    }[]
                  | undefined
              )?.map((line) => (
                <div
                  key={scalar(line.payload.readingId)}
                  className='rounded-lg border p-4'
                >
                  <Values
                    values={{
                      number: line.payload.readingNumber,
                      type: t('energy.types.' + line.feeType),
                      previous: line.payload.previous,
                      current: line.payload.current,
                      multiplier: line.payload.multiplier,
                      usage: line.payload.usage,
                      unitPrice: line.payload.unitPrice,
                    }}
                  />
                  <Money cents={line.amountCents} />
                </div>
              ))}
            </>
          ) : mode === 'handover' ? (
            <Values
              values={{
                contract: scalar(
                  (preview.assignment as Item | undefined)?.payload
                    .contractNumber,
                ),
                end: (preview.r as Item | undefined)?.end,
                closingReading: (preview.r as Item | undefined)?.payload
                  .current,
                billingStatus: t(
                  preview.finalBilled
                    ? 'energy.states.issued'
                    : 'energy.states.unbilled',
                ),
                nextContract:
                  preview.nextContractNumber || t('energy.noNextContract'),
                nextStart: (preview.next as Item | undefined)?.start,
                nextOpening: (preview.next as Item | undefined)?.payload
                  .openingReading,
              }}
            />
          ) : (
            <Values
              values={{
                number:
                  (preview.meter as Item | undefined)?.number ?? preview.number,
                start: preview.start ?? values.start,
                end: preview.end ?? values.end,
                openingReading: values.openingReading,
                contract:
                  scalar(preview.contractNumber) ||
                  values.contractNumber ||
                  '—',
              }}
            />
          )}
        </Group>
      ) : null}
      {small ? null : footer}

      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        busy={w.busy}
        destructive={['stop', 'reject', 'void'].includes(mode)}
        title={t(
          initial?.number || values.meterCode
            ? 'energy.confirmActionNamed'
            : 'energy.confirmAction',
          {
            action: t('energy.' + actionKey),
            number: initial?.number ?? values.meterCode ?? '',
          },
        )}
        label={t('energy.' + actionKey)}
        onConfirm={() => void run(true)}
      >
        {t('energy.confirmHelp.' + mode)}
      </Confirm>
      <Confirm
        open={reloadConfirm}
        onOpenChange={setReloadConfirm}
        busy={w.busy}
        destructive
        title={t('energy.reloadTitle')}
        label={t('energy.reload')}
        onConfirm={() => void onReload()}
      >
        {t('energy.reloadHelp')}
      </Confirm>
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        busy={w.busy}
        destructive
        title={t('energy.discardTitle')}
        label={t('energy.discard')}
        onConfirm={() => {
          mayCloseRef.current = true;
          exit();
        }}
      >
        {t('energy.discardHelp')}
      </Confirm>
    </>
  );
  return small ? (
    <RouteDialog
      className={mode === 'assign' ? 'sm:max-w-2xl' : 'sm:max-w-md'}
      beforeClose={() => {
        if (mayCloseRef.current) return true;
        if (w.busy) return false;
        if (dirty || unknown) {
          setDiscard(true);
          return false;
        }
        return true;
      }}
      title={t('energy.formTitles.' + mode, { number: initial?.number ?? '' })}
      footer={footer}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          attemptWrite();
        }}
        className='flex flex-col gap-4'
      >
        <fieldset disabled={w.busy} className='contents'>
          {form}
        </fieldset>
      </form>
    </RouteDialog>
  ) : (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        <BackButton
          to={{ pathname: parent, search: search() }}
          onClick={(e) => {
            e.preventDefault();
            close();
          }}
        />
        <form
          id={formId}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            attemptWrite();
          }}
          className='flex flex-col gap-4'
        >
          <fieldset disabled={w.busy} className='contents'>
            {form}
          </fieldset>
        </form>
      </PageContainer>
    </RouteChildPage>
  );
}
