import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useApiClient } from '@nocobase/app-client';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Choice,
  DateField,
  BillingError,
  LoadingRows,
} from '../billing/common.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import { today } from '../financial-reports/hooks.js';
import { batchCreateSchema } from '../../../server/tenant-operations/delivery-model.js';
import { Cover, Reason } from './delivery-common.js';
import { useDeliveryWrite, toggleSelection } from './delivery-hooks.js';
interface Preview {
  items: {
    id: string;
    number: string;
    name: string;
    canGenerate: boolean;
    reason: string;
  }[];
  projects: { id: string; name: string }[];
}
export default function BatchForm() {
  const l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    w = useDeliveryWrite(),
    [id] = useState(() => crypto.randomUUID());
  const [month, setMonth] = useState(
      () => new URLSearchParams(l.search).get('month') || today().slice(0, 7),
    ),
    [part, setPart] = useState('first'),
    [projectId, setProjectId] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview>(),
    [attempted, setAttempted] = useState(false);
  const options = useBusinessQuery<{ data: Preview }>(
      'tenantOperations/batches/options',
      { month, part },
    ),
    leave = useLeave(!!preview || selected.length > 0, w.busy);
  const showPreview = async () => {
    w.setBusy(true);
    w.setError(undefined);
    setAttempted(false);
    try {
      const r = await api.request<{ data: Preview }>({
        path: 'tenantOperations/batches/preview',
        method: 'POST',
        json: { month, part, ...(projectId ? { projectId } : {}) },
      });
      setPreview(r.data);
      setSelected([]);
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  const submit = async () => {
    setAttempted(true);
    const body = batchCreateSchema.safeParse({
      requestId: id,
      month,
      part,
      ...(projectId ? { projectId } : {}),
      contractIds: selected,
    });
    if (!body.success) {
      document.getElementById('batch-preview')?.focus();
      return;
    }
    const result = await w.write<{ id: string; number: string }>(
      'tenantOperations/batches',
      body.data,
      (result) => w.t('operations.batchCreated', { name: result.number }),
    );
    if (result) {
      leave.allow();
      void navigate(
        { pathname: '/tenantOperations/batch/' + result.id, search: l.search },
        { replace: true },
      );
    }
  };
  const invalidate = () => {
    setPreview(undefined);
    setSelected([]);
  };
  return (
    <>
      <Cover
        title={w.t('operations.createBatch')}
        description={w.t('operations.batchHelp')}
        actions={
          preview ? (
            <Button
              disabled={w.busy || !selected.length}
              onClick={() => void submit()}
            >
              {w.busy ? w.t('hyl.copy.saving') : w.t('operations.createBatch')}
            </Button>
          ) : undefined
        }
      >
        {options.error ? (
          <BillingError
            error={options.error}
            retry={() => void options.refetch()}
          />
        ) : options.isPending ? (
          <LoadingRows />
        ) : (
          <>
            <div className='grid gap-4 sm:grid-cols-3'>
              <Field>
                <FieldLabel htmlFor='batch-month'>
                  {w.t('operations.month')} *
                </FieldLabel>
                <DateField
                  id='batch-month'
                  month
                  value={month}
                  disabled={w.busy}
                  onChange={(v) => {
                    setMonth(v);
                    invalidate();
                  }}
                />
              </Field>
              <Field>
                <FieldLabel>{w.t('operations.period')} *</FieldLabel>
                <Choice
                  ariaLabel={w.t('operations.period')}
                  value={part}
                  disabled={w.busy}
                  onChange={(v) => {
                    setPart(v);
                    invalidate();
                  }}
                  options={['month', 'first', 'second'].map((v) => ({
                    value: v,
                    label: w.t('operations.parts.' + v),
                  }))}
                />
              </Field>
              <Field>
                <FieldLabel>{w.t('operations.project')}</FieldLabel>
                <Choice
                  ariaLabel={w.t('operations.project')}
                  value={projectId}
                  disabled={w.busy}
                  onChange={(v) => {
                    setProjectId(v);
                    invalidate();
                  }}
                  options={[
                    { value: '', label: w.t('operations.allProjects') },
                    ...(options.data?.data.projects ?? []).map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                />
              </Field>
            </div>
            <Button
              id='batch-preview'
              variant={preview ? 'outline' : 'default'}
              className='w-fit'
              disabled={w.busy}
              onClick={() => void showPreview()}
            >
              {w.busy ? w.t('hyl.copy.saving') : w.t('operations.previewBatch')}
            </Button>
            {preview ? (
              <>
                <p className='text-sm text-muted-foreground'>
                  {w.t('operations.selected', { count: selected.length })}
                </p>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{w.t('operations.selection')}</TableHead>
                        <TableHead>{w.t('operations.contract')}</TableHead>
                        <TableHead>{w.t('operations.tenant')}</TableHead>
                        <TableHead>{w.t('operations.reasonLabel')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>
                            <Checkbox
                              aria-label={
                                w.t('operations.selection') + ' ' + i.number
                              }
                              disabled={
                                w.busy ||
                                !i.canGenerate ||
                                (!selected.includes(i.id) &&
                                  selected.length >= 30)
                              }
                              checked={selected.includes(i.id)}
                              onCheckedChange={(v) =>
                                setSelected((s) =>
                                  toggleSelection(s, i.id, !!v),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>{i.number}</TableCell>
                          <TableCell>{i.name}</TableCell>
                          <TableCell>
                            {i.canGenerate ? (
                              w.t('operations.ready')
                            ) : (
                              <Reason reason={i.reason} />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!preview.items.length ? (
                  <p>{w.t('operations.noResults')}</p>
                ) : null}
              </>
            ) : null}
          </>
        )}
        {attempted && !selected.length ? (
          <FieldError>{w.t('operations.selectionRequired')}</FieldError>
        ) : null}
        {w.error ? <BillingError error={w.error} /> : null}
      </Cover>
      <DiscardDialog
        open={leave.discard}
        onOpenChange={(v) => {
          if (!v) leave.dismiss();
        }}
        onConfirm={() =>
          leave.accept(
            () =>
              void navigate({
                pathname: '/tenantOperations',
                search: l.search,
              }),
          )
        }
      />
    </>
  );
}
