import {
  useRecordSearchScope,
  useRecordSearchState,
} from '#hooks/use-record-search';
import { useRef, useState, useId, type ReactNode } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { X } from 'lucide-react';
import {
  Combobox,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxList,
  ComboboxGroup,
  ComboboxItem,
  ComboboxEmpty,
} from '#components/ui/combobox';
import { InputGroupAddon, InputGroupButton } from '#components/ui/input-group';
import { Spinner } from '#components/ui/spinner';
export type SearchOption = { value: string; label: string };
/** Queries and validation stay in the owning business wrapper. Never filter remote pages locally. */
export function RecordSearch({
  id,
  label,
  value,
  options,
  caption,
  onChange,
  onSearch,
  placeholder,
  disabled = false,
  loading = false,
  invalid = false,
  status,
  footer,
  scopeKey,
  hasSelection = false,
  onClear,
}: {
  id?: string;
  label?: string;
  value: string;
  options: SearchOption[];
  caption?: string;
  onChange: (id: string, label: string) => void;
  onSearch: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  status?: ReactNode;
  footer?: ReactNode;
  scopeKey: string;
  hasSelection?: boolean;
  onClear?: () => void;
}) {
  const { t } = useTranslation(),
    generatedId = useId();
  const inputId = id || generatedId,
    scope = useRecordSearchScope(scopeKey);
  const [cache, setCache] = useState<{ scope: string; option?: SearchOption }>({
    scope,
  });
  if (cache.scope !== scope) setCache({ scope });
  // Typing invalidates the selected ID; retain the draft across that parent update.
  // Tag it with its source so an authorization/source change cannot reuse it.
  const [draft, setDraft] = useState<{
    scope: string;
    text?: string;
    origin?: string;
  }>({ scope });
  if (draft.scope !== scope) setDraft({ scope });
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const items = loading || status ? [] : options;
  const selected = value
    ? items.find((o) => o.value === value) ||
      (cache.scope === scope && cache.option?.value === value
        ? cache.option
        : undefined) || { value, label: caption || value }
    : null;
  const inputValue =
    draft.scope === scope &&
    draft.text !== undefined &&
    (!value || value === draft.origin)
      ? draft.text
      : selected?.label || '';
  const clear = () => {
    setCache({ scope });
    setDraft({ scope, text: '', origin: value });
    onSearch('');
    if (onClear) onClear();
    else onChange('', '');
    document.getElementById(inputId)?.focus();
    setOpen(false);
  };
  const search = (query: string) => {
    onSearch(query);
    if (value) onChange('', '');
  };
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Combobox
        key={scope}
        modal={false}
        open={open}
        onOpenChange={setOpen}
        items={items}
        filter={null}
        value={selected}
        inputValue={inputValue}
        disabled={disabled}
        isItemEqualToValue={(a, b) => a.value === b.value}
        onInputValueChange={(query, details) => {
          if (
            ['input-change', 'input-clear', 'clear-press'].includes(
              details.reason,
            )
          ) {
            setDraft({ scope, text: query, origin: value });
            if (!composingRef.current) search(query);
          }
        }}
        onValueChange={(option) => {
          if (
            ((loading || status) && option) ||
            (composingRef.current && !option)
          )
            return;
          if (!option && draft.scope === scope && draft.text) return;
          setDraft({ scope });
          setCache({ scope, option: option || undefined });
          onChange(option?.value || '', option?.label || '');
          onSearch('');
        }}
      >
        <ComboboxInput
          id={inputId}
          aria-label={label}
          aria-invalid={invalid}
          placeholder={placeholder || t('hyl.copy.search')}
          disabled={disabled}
          showTrigger={false}
          className='w-full'
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            setDraft({ scope, text: event.currentTarget.value, origin: value });
            search(event.currentTarget.value);
          }}
        >
          <InputGroupAddon align='inline-end'>
            {(value || hasSelection) && !disabled ? (
              <InputGroupButton
                type='button'
                variant='ghost'
                size='icon-xs'
                aria-label={t('hyl.copy.clearRecord', {
                  name: label?.replace(/\s*\*$/, '') || t('hyl.copy.record'),
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  clear();
                }}
              >
                <X className='pointer-events-none size-4' />
              </InputGroupButton>
            ) : null}
            <ComboboxTrigger
              disabled={disabled}
              aria-label={t('hyl.copy.chooseRecord', {
                name: label?.replace(/\s*\*$/, '') || t('hyl.copy.record'),
              })}
              render={<InputGroupButton variant='ghost' size='icon-xs' />}
            />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent>
          {status}
          {loading ? (
            <p
              role='status'
              className='flex items-center gap-2 p-3 text-sm text-muted-foreground'
            >
              <Spinner />
              {t('hyl.copy.load')}
            </p>
          ) : null}
          {!loading && !status ? (
            <ComboboxEmpty>{t('hyl.copy.noResults')}</ComboboxEmpty>
          ) : null}
          <ComboboxList>
            <ComboboxGroup>
              {items.map((option) => (
                <ComboboxItem
                  key={option.value}
                  value={option}
                  className='whitespace-normal break-words'
                >
                  {option.label}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          </ComboboxList>
          {footer && !status ? (
            <div className='border-t p-2'>{footer}</div>
          ) : null}
        </ComboboxContent>
      </Combobox>
      {!open ? status : null}
    </div>
  );
}

/** In-memory snapshots (e.g. a contract's signed assets) are filtered locally. */
export function LocalRecordSearch(
  props: Omit<Parameters<typeof RecordSearch>[0], 'onSearch'>,
) {
  const { q, setQ } = useRecordSearchState(props.scopeKey);
  return (
    <RecordSearch
      {...props}
      options={props.options.filter((o) =>
        o.label.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
      )}
      onSearch={setQ}
    />
  );
}
