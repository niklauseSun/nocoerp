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
import type { BusinessRow } from './model.js';
type Option = { value: string; label: string };
const option = (row: BusinessRow): Option => ({
  value: row.id,
  label: `${row.name} · ${row.number}`,
});
export function MerchantPicker({
  value,
  onChange,
  id,
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<Option | null>(null);
  const composingRef = useRef(false);
  const selected = useBusinessQuery<{ data: BusinessRow }>(
    `merchants/${value}`,
    undefined,
    !!value,
  );
  const result = useBusinessQuery<{
    data: BusinessRow[];
    meta: { total: number };
  }>('merchants', { q, page, pageSize: 20 });
  const rows = result.isFetching ? [] : (result.data?.data ?? []);
  const selectedRow =
    selected.data?.data.id === value
      ? selected.data.data
      : rows.find((row) => row.id === value);
  const current = selectedRow
    ? option(selectedRow)
    : chosen?.value === value
      ? chosen
      : null;
  const items = rows.map(option);
  const search = (input: string) => {
    setQ(input);
    setPage(1);
    if (value) onChange('');
  };
  return (
    <div className='flex flex-col gap-2'>
      <Combobox
        modal={false}
        items={items}
        value={current}
        filter={null}
        disabled={disabled}
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
          onChange(item?.value ?? '');
          setQ('');
          setPage(1);
        }}
      >
        <ComboboxInput
          id={id}
          aria-label={t('hyl.fields.merchantId')}
          aria-required
          aria-invalid={invalid}
          className='w-full'
          placeholder={t('hyl.copy.searchMerchant')}
          disabled={disabled}
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
            <ComboboxTrigger
              aria-label={t('hyl.copy.chooseMerchant')}
              disabled={disabled}
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
              {t('hyl.copy.loadingMerchants')}
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
                  {t(q ? 'hyl.copy.noResults' : 'hyl.copy.noMerchant')}
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
      {selected.error ? (
        <ErrorPanel
          error={selected.error}
          retry={() => void selected.refetch()}
        />
      ) : null}
    </div>
  );
}
