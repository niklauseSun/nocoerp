import { DiscardDialog } from './discard-dialog.js';
import { drafts } from './drafts.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useBusinessQuery } from './hooks.js';
import { useState, useRef, useEffect } from 'react';
import {
  useOutletContext,
  useParams,
  useLocation,
  useNavigate,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Spinner } from '#components/ui/spinner';
import { useToaster } from '@nocobase/app-client';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { ErrorPanel, Choice, DateField, LoadingRows } from './common.js';
import type { Kind, BusinessRow, Values } from './model.js';

export default function BusinessAction() {
  const toaster = useToaster();
  const { kind } = useOutletContext<{ kind: Kind }>(),
    { id } = useParams();
  const location = useLocation(),
    navigate = useNavigate();
  const action = location.pathname.split('/').at(-1) ?? '',
    { t } = useTranslation(),
    api = useApiClient(),
    client = useQueryClient();
  const latest = useBusinessQuery<{ data: BusinessRow }>(`${kind}/${id}`);
  const row = latest.data?.data;
  const { session } = useAuthentication();
  const draftKey = `${session?.user.id}/${kind}/${id}/${action}`;
  const [discard, setDiscard] = useState(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [values, setValues] = useState<Values>(
      () =>
        drafts.get(draftKey)?.values ?? {
          confirmation: 'online',
          method: 'bank',
        },
    );
  const dirty = Object.keys(values).some(
    (key) => !['confirmation', 'method'].includes(key) && !!values[key],
  );
  useEffect(() => {
    if (dirty) drafts.set(draftKey, { values });
  }, [dirty, draftKey, values]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const mode = row?.confirmationModes?.includes(String(values.confirmation))
    ? String(values.confirmation)
    : (row?.confirmationModes?.[0] ?? '');
  const keys =
    action === 'pay'
      ? ['amount', 'date', 'reference', 'method', 'notes']
      : action === 'confirm'
        ? [
            'confirmation',
            ...(mode === 'offline' ? ['confirmedBy', 'evidence'] : []),
          ]
        : ['dispute', 'return', 'cancel'].includes(action)
          ? ['reason']
          : [];
  const close = () =>
    void navigate(
      { pathname: '..', search: location.search },
      { replace: true },
    );
  const submit = async () => {
    if (pending || !row) return;
    const errors: Record<string, string> = {};
    for (const key of keys)
      if (
        key !== 'notes' &&
        key !== 'confirmation' &&
        !String(values[key] ?? '').trim()
      )
        errors[key] = t('hyl.errors.required');
    if (
      action === 'pay' &&
      (!/^\d{1,12}(\.\d{1,2})?$/.test(String(values.amount ?? '')) ||
        Number(values.amount) <= 0)
    )
      errors.amount = t('hyl.errors.positive');
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      formRef.current
        ?.querySelector<HTMLElement>(`#hyl-action-${first}`)
        ?.focus();
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: BusinessRow }>({
        path: `${kind}/${id}/${action === 'pay' ? 'payments' : action}`,
        method: 'POST',
        json: {
          ...values,
          confirmation: mode || undefined,
          expectedVersion: row.version,
        },
      });
      client.setQueryData(['hyl', `${kind}/${id}`, undefined], {
        data: response.data,
      });
      await client.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('hyl.copy.done', { name: row.number }),
        type: 'success',
      });
      drafts.delete(draftKey);
      close();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  };
  const title = t('hyl.copy.actionTitle', {
    action: t(`hyl.actions.${action}`),
    name: row?.number ?? '',
  });
  const footer = (
    <>
      <Button
        variant='outline'
        disabled={pending}
        onClick={() => {
          if (dirty) setDiscard(true);
          else close();
        }}
      >
        {t('hyl.actions.back')}
      </Button>
      <Button disabled={pending || !row} type='submit' form='hyl-action-form'>
        {pending ? <Spinner /> : null}
        {t(`hyl.actions.${action}`)}
      </Button>
    </>
  );
  const fields = (
    <FieldGroup>
      {keys.map((key) => (
        <Field key={key} data-invalid={!!fieldErrors[key]}>
          <FieldLabel htmlFor={`hyl-action-${key}`}>
            {t(`hyl.fields.${key}`)}
            {key !== 'notes' ? ' *' : ''}
          </FieldLabel>
          {key === 'confirmation' || key === 'method' ? (
            <Choice
              id={`hyl-action-${key}`}
              disabled={pending}
              value={key === 'confirmation' ? mode : String(values[key] ?? '')}
              onChange={(v) =>
                setValues((previous) => ({ ...previous, [key]: v }))
              }
              options={(key === 'confirmation'
                ? (row?.confirmationModes ?? [])
                : ['bank', 'cash', 'other']
              ).map((v) => ({ value: v, label: t(`hyl.enums.${v}`) }))}
            />
          ) : key === 'date' ? (
            <DateField
              id={`hyl-action-${key}`}
              disabled={pending}
              value={String(values[key] ?? '')}
              onChange={(v) =>
                setValues((previous) => ({ ...previous, [key]: v }))
              }
            />
          ) : ['reason', 'notes', 'evidence'].includes(key) ? (
            <Textarea
              id={`hyl-action-${key}`}
              disabled={pending}
              value={String(values[key] ?? '')}
              onChange={(e) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: e.target.value,
                }))
              }
            />
          ) : (
            <Input
              id={`hyl-action-${key}`}
              disabled={pending}
              value={String(values[key] ?? '')}
              onChange={(e) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: e.target.value,
                }))
              }
            />
          )}
          {fieldErrors[key] ? (
            <FieldError>{fieldErrors[key]}</FieldError>
          ) : null}
        </Field>
      ))}
    </FieldGroup>
  );
  if (action === 'cancel')
    return (
      <AlertDialog
        open
        onOpenChange={(v) => {
          if (!v && !pending) close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('hyl.copy.cancelHelp')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <>
              <ErrorPanel error={error} />
              <Button
                variant='outline'
                type='button'
                onClick={() => void latest.refetch()}
              >
                {t('hyl.actions.refresh')}
              </Button>
            </>
          ) : null}
          {fields}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('hyl.actions.back')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || !row}
              variant='destructive'
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {pending ? <Spinner /> : null}
              {t('hyl.actions.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  return (
    <RouteDialog
      title={title}
      beforeClose={() => {
        if (pending) return false;
        if (dirty) {
          setDiscard(true);
          return false;
        }
        return true;
      }}
      footer={footer}
    >
      {latest.isPending ? (
        <LoadingRows />
      ) : latest.error ? (
        <ErrorPanel error={latest.error} />
      ) : (
        <form
          ref={formRef}
          id='hyl-action-form'
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className='flex flex-col gap-4'
        >
          {action === 'pay' || action === 'confirm' ? (
            <Alert>
              <AlertDescription>
                {t(
                  `hyl.copy.${action === 'pay' ? 'paymentNotice' : 'confirmationHelp'}`,
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <>
              <ErrorPanel error={error} />
              <Button
                variant='outline'
                type='button'
                onClick={() => void latest.refetch()}
              >
                {t('hyl.actions.refresh')}
              </Button>
            </>
          ) : null}
          {fields}
        </form>
      )}
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={() => {
          drafts.delete(draftKey);
          close();
        }}
      />
    </RouteDialog>
  );
}
