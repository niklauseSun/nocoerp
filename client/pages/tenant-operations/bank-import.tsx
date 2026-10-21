import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useApiClient } from '@nocobase/app-client';
import { Input } from '#components/ui/input';
import { Button } from '#components/ui/button';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  Choice,
  BillingError,
  Money,
  Day,
  Truncated,
} from '../billing/common.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import {
  csvTable,
  mappingSchema,
  type BankMapping,
} from '../../../server/tenant-operations/bank-import.js';
import {
  importSchema,
  type BankRow,
} from '../../../server/tenant-operations/model.js';
import { bankSample } from './csv.js';
import { Cover } from './delivery-common.js';
import { useDeliveryWrite } from './delivery-hooks.js';
const standard: BankMapping = {
  externalId: 'externalId',
  date: 'date',
  reference: 'reference',
  method: 'method',
  amount: 'amountCents',
  unit: 'cents',
  defaultMethod: 'bank',
};
type Preview = {
  total: number;
  rows: BankRow[];
  issues: { row: number; code: string }[];
};
export default function BankImport() {
  const w = useDeliveryWrite(),
    l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    [requestId] = useState(() => crypto.randomUUID()),
    accountRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(''),
    [headers, setHeaders] = useState<string[]>([]),
    [account, setAccount] = useState(''),
    [mapping, setMapping] = useState<BankMapping>(standard),
    [template, setTemplate] = useState('standard'),
    [split, setSplit] = useState(false),
    [preview, setPreview] = useState<Preview>(),
    [csvError, setCsvError] = useState(''),
    [attempted, setAttempted] = useState(false);
  const leave = useLeave(!!text || !!account, w.busy),
    back = { pathname: '/tenantOperations', search: l.search },
    close = () => {
      leave.allow();
      void navigate(back);
    };
  const choices = [
    { value: '', label: w.t('operations.none') },
    ...headers.map((h) => ({ value: h, label: h })),
  ];
  const update = (key: string, value: string) =>
    setMapping((m) => ({ ...m, [key]: value || undefined }));
  const preset = (value: string) => {
    setTemplate(value);
    setSplit(value === 'bank');
    setPreview(undefined);
    const expected =
      value === 'bank'
        ? {
            externalId: '流水',
            date: '日期',
            reference: '参考',
            income: '收入',
            expense: '支出',
            unit: 'yuan',
            defaultMethod: 'bank',
          }
        : value === 'platform'
          ? {
              externalId: 'ID',
              date: 'Date',
              reference: 'Ref',
              amount: 'Net',
              unit: 'yuan',
              defaultMethod: 'bank',
            }
          : standard;
    setMapping(
      Object.fromEntries(
        Object.entries(expected).map(([k, v]) =>
          ['unit', 'defaultMethod'].includes(k) ||
          (typeof v === 'string' && headers.includes(v))
            ? [k, v]
            : [k, undefined],
        ),
      ) as BankMapping,
    );
  };
  const previewFile = async () => {
    setAttempted(true);
    setCsvError('');
    const parsed = mappingSchema.safeParse(mapping);
    if (!account.trim() || !text || !parsed.success) {
      accountRef.current?.focus();
      return;
    }
    w.setError(undefined);
    w.setBusy(true);
    try {
      const r = await api.request<{ data: Preview }>({
        path: 'tenantOperations/reconciliation/previewImport',
        method: 'POST',
        json: { text, mapping: parsed.data },
      });
      setPreview(r.data);
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  const submit = async () => {
    if (!preview?.rows.length) return;
    const body = importSchema.parse({ requestId, account, rows: preview.rows });
    const r = await w.write(
      'tenantOperations/reconciliation/import',
      body,
      w.t('operations.operationSaved', { name: account }),
    );
    if (r) close();
  };
  return (
    <>
      <Cover
        title={w.t('operations.importTitle')}
        description={w.t('operations.mappingHelp')}
        actions={
          <>
            <Button
              variant='outline'
              disabled={w.busy}
              onClick={() =>
                void (async () => {
                  if (await leave.guard()) close();
                })()
              }
            >
              {w.t('operations.cancel')}
            </Button>
            {preview?.rows.length ? (
              <Button disabled={w.busy} onClick={() => void submit()}>
                {w.busy
                  ? w.t('hyl.copy.saving')
                  : w.t('operations.confirmImport')}
              </Button>
            ) : (
              <Button
                disabled={w.busy || !text}
                onClick={() => void previewFile()}
              >
                {w.busy
                  ? w.t('hyl.copy.saving')
                  : w.t('operations.previewBank')}
              </Button>
            )}
          </>
        }
      >
        {w.error ? <BillingError error={w.error} /> : null}
        {!preview ? (
          <>
            <div className='max-w-4xl flex flex-col gap-4'>
              <Field>
                <FieldLabel htmlFor='bank-import-account'>
                  {w.t('operations.account')}
                </FieldLabel>
                <Input
                  ref={accountRef}
                  id='bank-import-account'
                  value={account}
                  maxLength={100}
                  disabled={w.busy}
                  onChange={(e) => setAccount(e.target.value)}
                  aria-invalid={attempted && !account.trim()}
                />
                {attempted && !account.trim() ? (
                  <FieldError>{w.t('operations.requiredField')}</FieldError>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor='bank-import-file'>
                  {w.t('operations.file')}
                </FieldLabel>
                <Input
                  id='bank-import-file'
                  type='file'
                  accept='.csv,text/csv'
                  disabled={w.busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setText('');
                    setHeaders([]);
                    setCsvError('');
                    if (!file) return;
                    w.setBusy(true);
                    void (async () => {
                      try {
                        if (file.size > 2_000_000) throw Error('CSV_TOO_LARGE');
                        const raw = new TextDecoder('utf-8', {
                            fatal: true,
                          }).decode(await file.arrayBuffer()),
                          table = csvTable(raw);
                        setText(raw);
                        setHeaders(table[0]);
                        setMapping(standard);
                        setTemplate('standard');
                        setSplit(false);
                      } catch (error) {
                        const code =
                          error instanceof Error ? error.message : '';
                        setCsvError(
                          [
                            'CSV_TOO_LARGE',
                            'CSV_COLUMNS',
                            'CSV_QUOTE',
                            'CSV_ROWS',
                          ].includes(code)
                            ? code
                            : 'CSV_FIELD',
                        );
                      } finally {
                        w.setBusy(false);
                      }
                    })();
                  }}
                />
                {csvError ? (
                  <FieldError>
                    {w.t('operations.csvIssues.' + csvError)}
                  </FieldError>
                ) : null}
              </Field>
              <Button
                variant='outline'
                className='w-fit'
                onClick={() => {
                  const url = URL.createObjectURL(
                      new Blob([bankSample], {
                        type: 'text/csv;charset=utf-8',
                      }),
                    ),
                    a = document.createElement('a');
                  a.href = url;
                  a.download = 'TEST-bank-example.csv';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {w.t('operations.sample')}
              </Button>
              {headers.length ? (
                <>
                  <Field>
                    <FieldLabel>{w.t('operations.template')}</FieldLabel>
                    <Choice
                      ariaLabel={w.t('operations.template')}
                      value={template}
                      onChange={preset}
                      disabled={w.busy}
                      options={['standard', 'bank', 'platform'].map((v) => ({
                        value: v,
                        label: w.t('operations.templates.' + v),
                      }))}
                    />
                  </Field>
                  <div className='grid gap-4 sm:grid-cols-2'>
                    {(
                      ['externalId', 'date', 'reference', 'method'] as const
                    ).map((k) => (
                      <Field key={k}>
                        <FieldLabel>
                          {w.t('operations.mappingFields.' + k)}
                          {k !== 'method' ? ' *' : ''}
                        </FieldLabel>
                        <Choice
                          ariaLabel={w.t('operations.mappingFields.' + k)}
                          value={
                            headers.includes(mapping[k] ?? '')
                              ? (mapping[k] ?? '')
                              : ''
                          }
                          onChange={(v) => update(k, v)}
                          disabled={w.busy}
                          options={choices}
                        />
                      </Field>
                    ))}
                    <Field>
                      <FieldLabel>{w.t('operations.direction')} *</FieldLabel>
                      <Choice
                        ariaLabel={w.t('operations.direction')}
                        value={split ? 'split' : 'signed'}
                        onChange={(v) => {
                          setSplit(v === 'split');
                          setMapping((m) =>
                            v === 'split'
                              ? {
                                  ...m,
                                  amount: undefined,
                                  income: headers.includes('收入')
                                    ? '收入'
                                    : '',
                                  expense: headers.includes('支出')
                                    ? '支出'
                                    : '',
                                }
                              : {
                                  ...m,
                                  income: undefined,
                                  expense: undefined,
                                  amount: '',
                                },
                          );
                        }}
                        disabled={w.busy}
                        options={['signed', 'split'].map((v) => ({
                          value: v,
                          label: w.t('operations.directions.' + v),
                        }))}
                      />
                    </Field>
                    {(split
                      ? (['income', 'expense'] as const)
                      : (['amount'] as const)
                    ).map((k) => (
                      <Field key={k}>
                        <FieldLabel>
                          {w.t('operations.mappingFields.' + k)} *
                        </FieldLabel>
                        <Choice
                          ariaLabel={w.t('operations.mappingFields.' + k)}
                          value={
                            headers.includes(mapping[k] ?? '')
                              ? (mapping[k] ?? '')
                              : ''
                          }
                          disabled={w.busy}
                          onChange={(v) => update(k, v)}
                          options={choices}
                        />
                      </Field>
                    ))}
                    <Field>
                      <FieldLabel>{w.t('operations.unit')} *</FieldLabel>
                      <Choice
                        ariaLabel={w.t('operations.unit')}
                        value={mapping.unit}
                        onChange={(v) => update('unit', v)}
                        disabled={w.busy}
                        options={['cents', 'yuan'].map((v) => ({
                          value: v,
                          label: w.t('operations.units.' + v),
                        }))}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{w.t('operations.defaultMethod')}</FieldLabel>
                      <Choice
                        ariaLabel={w.t('operations.defaultMethod')}
                        value={mapping.defaultMethod}
                        onChange={(v) => update('defaultMethod', v)}
                        disabled={w.busy}
                        options={['bank', 'cash', 'other', 'unclassified'].map(
                          (v) => ({
                            value: v,
                            label: w.t('operations.methods.' + v),
                          }),
                        )}
                      />
                    </Field>
                  </div>
                </>
              ) : null}
              {attempted &&
              (!mappingSchema.safeParse(mapping).success || !text) ? (
                <FieldError>{w.t('operations.requiredField')}</FieldError>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Button
              variant='outline'
              className='w-fit'
              disabled={w.busy}
              onClick={() => setPreview(undefined)}
            >
              {w.t('operations.previousStep')}
            </Button>
            <p>{w.t('operations.previewTotal', { count: preview.total })}</p>
            {preview.issues.length ? (
              <div
                role='alert'
                className='flex flex-col gap-2 text-sm text-destructive'
              >
                {preview.issues.map((i) => (
                  <p key={i.row}>
                    {w.t('operations.rowIssue', {
                      row: i.row,
                      reason: w.t('operations.csvIssues.' + i.code),
                    })}
                  </p>
                ))}
              </div>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['name', 'date', 'detail', 'amount'].map((k) => (
                        <TableHead
                          key={k}
                          className={k === 'amount' ? 'text-right' : undefined}
                        >
                          {w.t('operations.' + k)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.slice(0, 20).map((r) => (
                      <TableRow key={r.externalId}>
                        <TableCell>
                          <Truncated>{r.externalId}</Truncated>
                        </TableCell>
                        <TableCell>
                          <Day value={r.date} />
                        </TableCell>
                        <TableCell>
                          <Truncated>
                            {`${r.reference} · ${w.t('operations.methods.' + r.method)}`}
                          </Truncated>
                        </TableCell>
                        <TableCell className='text-right'>
                          <Money cents={r.amountCents} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Cover>
      <DiscardDialog
        open={leave.discard}
        onOpenChange={(v) => {
          if (!v) leave.dismiss();
        }}
        onConfirm={() => leave.accept(close)}
      />
    </>
  );
}
