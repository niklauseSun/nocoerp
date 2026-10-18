import { Spinner } from '#components/ui/spinner';
import { type ReactNode } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
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
import { Money } from '../billing/common.js';
export {
  Money,
  Day,
  Search,
  Choice,
  DateField,
  BillingError,
  LoadingRows,
  Paged,
  Refresh,
  RecordPicker,
  Truncated,
} from '../billing/common.js';
export function FormField({
  name,
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  error,
  multiline = false,
  decimal = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  multiline?: boolean;
  decimal?: boolean;
}) {
  const Control = multiline ? Textarea : Input;
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={`cashier-${name}`}>
        {label}
        {required ? ' *' : ''}
      </FieldLabel>
      <Control
        id={`cashier-${name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `cashier-error-${name}` : undefined}
        {...(!multiline && decimal ? { inputMode: 'decimal' as const } : {})}
      />
      {error ? (
        <FieldError id={`cashier-error-${name}`}>{error}</FieldError>
      ) : null}
    </Field>
  );
}
export function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>{children}</CardContent>
    </Card>
  );
}
export function Amounts({
  values,
  labels,
}: {
  values: Record<string, string>;
  labels?: Record<string, string>;
}) {
  const { t } = useTranslation();
  return (
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
      {Object.entries(values).map(([key, value]) => (
        <Card key={key}>
          <CardContent className='flex flex-col gap-2'>
            <span className='text-sm text-muted-foreground'>
              {t(labels?.[key] ?? `cashier.fields.${key}`)}
            </span>
            <span className='text-lg font-medium'>
              <Money cents={value} />
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
export function Confirm({
  open,
  onOpenChange,
  title,
  children,
  onConfirm,
  busy,
  destructive = false,
  label,
  rich = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  busy: boolean;
  destructive?: boolean;
  rich?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={rich ? <div /> : undefined}>
            {children}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('cashier.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={destructive ? 'destructive' : 'default'}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? <Spinner /> : null}
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function Footer({
  busy,
  onCancel,
  onPreview,
  onSave,
  reviewed,
  label,
}: {
  busy: boolean;
  onCancel: () => void;
  onPreview: () => void;
  onSave?: () => void;
  reviewed: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap justify-end gap-2'>
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        onClick={onCancel}
      >
        {t('cashier.cancel')}
      </Button>
      {reviewed && onSave ? (
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={onSave}
        >
          {t('cashier.saveDraft')}
        </Button>
      ) : null}
      <Button
        type='submit'
        disabled={busy}
        onClick={
          reviewed
            ? undefined
            : (e) => {
                e.preventDefault();
                onPreview();
              }
        }
      >
        {busy ? t('hyl.copy.load') : reviewed ? label : t('cashier.preview')}
      </Button>
    </div>
  );
}

/** Labels here are already translated by their owning cashier page. */
export function Value({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className='text-sm text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 break-words'>{children ?? '—'}</dd>
    </>
  );
}

export function RecordedAt({ value }: { value?: string }) {
  const { i18n } = useTranslation();
  return (
    <>
      {value
        ? new Intl.DateTimeFormat(i18n.language, {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          }).format(new Date(value))
        : '—'}
    </>
  );
}
