import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxEmpty,
  ComboboxTrigger,
} from '#components/ui/combobox';
import { InputGroupAddon, InputGroupButton } from '#components/ui/input-group';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { useBusinessQuery } from './hooks.js';
import { ErrorPanel } from './common.js';
import { useCan } from '@nocobase/app-plugin-authorization/client';
type RecordOption = {
  id: string;
  name: string;
  number?: string;
  email?: string;
  username?: string;
  address?: string;
  floor?: string;
  location?: string;
};
type Option = { value: string; label: string };
const option = (row: RecordOption): Option => ({
  value: row.id,
  label: [
    row.name,
    row.number || row.email || row.username,
    row.address,
    row.floor,
    row.location,
  ]
    .filter(Boolean)
    .join(' · '),
});
export function AssociationPicker({
  value,
  onChange,
  id,
  disabled = false,
  invalid = false,
  kind,
  fallback = '',
}: {
  value: string;
  onChange: (value: string, label: string) => void;
  id: string;
  disabled?: boolean;
  invalid?: boolean;
  kind: 'asset' | 'user';
  fallback?: string;
}) {
  const { t } = useTranslation();
  const can = useCan({
    resource:
      kind === 'user'
        ? { type: 'user', id: '*' }
        : { type: 'composite', id: 'hyl.assets' },
    action: 'read',
  });
  const endpoint = kind === 'user' ? 'users' : 'assets';
  const label = t(kind === 'user' ? 'hyl.fields.userId' : 'hyl.fields.unit');
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<Option | null>(null);
  const composingRef = useRef(false);
  const selected = useBusinessQuery<{ data: RecordOption }>(
    `${endpoint}/${value}`,
    undefined,
    !!value && can.can && kind === 'asset',
  );
  const result = useBusinessQuery<{
    data: RecordOption[];
    meta: { total: number };
  }>(
    endpoint,
    {
      q,
      page,
      pageSize: 20,
      ...(kind === 'asset'
        ? { type: 'leaf', state: 'normal' }
        : { status: 'enabled' }),
    },
    can.can,
  );
  const rows = result.isFetching ? [] : (result.data?.data ?? []);
  const selectedRow =
    selected.data?.data.id === value
      ? selected.data.data
      : rows.find((row) => row.id === value);
  const current = selectedRow
    ? option(selectedRow)
    : chosen?.value === value
      ? chosen
      : fallback
        ? { value, label: fallback }
        : null;
  const items = rows.map(option);
  const search = (input: string) => {
    setQ(input);
    setPage(1);
    if (value) onChange('', '');
  };
  return (
    <div className='flex flex-col gap-2'>
      <Combobox
        modal={false}
        items={items}
        value={current}
        filter={null}
        disabled={disabled || !can.can}
        isItemEqualToValue={(item, selectedValue) =>
          item.value === selectedValue.value
        }
        onInputValueChange={(input, details) => {
          if (
            ['input-change', 'input-clear', 'clear-press'].includes(
              details.reason,
            ) &&
            !composingRef.current
          )
            search(input);
        }}
        onValueChange={(item) => {
          setChosen(item);
          onChange(item?.value ?? '', item?.label ?? '');
          setQ('');
          setPage(1);
        }}
      >
        <ComboboxInput
          id={id}
          aria-label={label}
          aria-invalid={invalid}
          className='w-full'
          placeholder={t(
            kind === 'asset'
              ? 'hyl.profile.searchAsset'
              : 'hyl.profile.searchUser',
          )}
          disabled={disabled || !can.can}
          showTrigger={false}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            search(event.currentTarget.value);
          }}
        >
          <InputGroupAddon align='inline-end'>
            {(value || fallback) && !disabled ? (
              <InputGroupButton
                type='button'
                variant='ghost'
                size='icon-xs'
                aria-label={t(
                  kind === 'user'
                    ? 'hyl.profile.unlinkAccount'
                    : 'hyl.profile.clearAsset',
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  setChosen(null);
                  setQ('');
                  setPage(1);
                  onChange('', '');
                  document.getElementById(id)?.focus();
                }}
              >
                <X className='pointer-events-none size-4' />
              </InputGroupButton>
            ) : null}
            <ComboboxTrigger
              aria-label={label}
              disabled={disabled || !can.can}
              render={<InputGroupButton variant='ghost' size='icon-xs' />}
            />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent>
          {result.isFetching ? (
            <p
              role='status'
              className='flex items-center gap-2 p-3 text-sm text-muted-foreground'
            >
              <Spinner />
              {t('hyl.copy.load')}
            </p>
          ) : null}
          {result.error ? (
            <ErrorPanel
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : (
            <>
              {!result.isFetching ? (
                <ComboboxEmpty>
                  {t(q ? 'hyl.copy.noResults' : 'hyl.copy.noResults')}
                </ComboboxEmpty>
              ) : null}
              <ComboboxList>
                <ComboboxGroup>
                  {items.map((item) => (
                    <ComboboxItem
                      key={item.value}
                      value={item}
                      className='whitespace-normal break-words'
                    >
                      {item.label}
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              </ComboboxList>
            </>
          )}
          {(result.data?.meta.total ?? 0) > 20 ? (
            <div className='flex flex-wrap items-center gap-2 border-t p-2'>
              <Button
                type='button'
                variant='outline'
                disabled={page === 1 || result.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t('hyl.actions.previous')}
              </Button>
              <span className='text-sm text-muted-foreground'>
                {t('hyl.copy.count', { total: result.data?.meta.total, page })}
              </span>
              <Button
                type='button'
                variant='outline'
                disabled={
                  page * 20 >= (result.data?.meta.total ?? 0) ||
                  result.isFetching
                }
                onClick={() => setPage(page + 1)}
              >
                {t('hyl.actions.next')}
              </Button>
            </div>
          ) : null}
        </ComboboxContent>
      </Combobox>
      {!can.can ? (
        <p className='text-sm text-muted-foreground'>
          {t('hyl.profile.pickerDenied')}
        </p>
      ) : null}
      {selected.error ? (
        <ErrorPanel
          error={selected.error}
          retry={() => void selected.refetch()}
        />
      ) : null}
    </div>
  );
}
