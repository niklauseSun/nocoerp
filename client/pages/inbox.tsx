import { useTranslation } from '@nocobase/i18n/client';
import { Nav } from './messages/common.js';
import type { ReactElement } from 'react';

import { InboxPage as InboxBlock } from '#extensions/nocobase-inbox/inbox-page';

/** Shared inbox keeps official persistent read/unread and realtime behavior. Business work has a separate, freshly authorized list. */
export default function InboxPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <InboxBlock
      title={t('messages.title')}
      description={t('messages.inboxDescription')}
      listFooter={<Nav />}
    />
  );
}
