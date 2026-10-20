/** Only a bank follow-up opened from that same bank row can return to its match view. */
export function followupBack(
  kind: string | undefined,
  id: string | undefined,
  search: string,
) {
  const query = new URLSearchParams(search),
    match = query.get('returnMatch');
  query.delete('returnMatch');
  return {
    pathname:
      kind === 'bank' && match === id && /^[0-9a-f-]{36}$/i.test(match)
        ? '/tenantOperations/match/' + encodeURIComponent(match)
        : '/tenantOperations',
    search: query.toString(),
  };
}
export function matchFollowupSearch(id: string, search: string) {
  const query = new URLSearchParams(search);
  query.set('returnMatch', id);
  return query.toString();
}
