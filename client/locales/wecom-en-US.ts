export default {
  intent: 'Previous intended data',
  delivery: 'WeCom delivery',
  notSent: 'Not sent (disabled or unmapped)',
  configurationMismatch:
    'Corporate or app configuration changed; delivery blocked',
  title: 'WeCom',
  description:
    'Connect an internal app to synchronize people, departments and reminders.',
  new: 'New mapping',
  check: 'Check connection',
  saved: 'Operation completed',
  connection: 'Connection status',
  configHelp:
    'A deployment administrator configures the wecom section in server config.yml and restarts the service.',
  configKeys:
    'Keys: corpId, agentId, appSecret, contactsSecret, readSecret (optional), enabled, autoSync, notifications. Message links also require app.publicOrigin.',
  scopeHelp:
    'Synchronize the root department, then children and people. Automatic sync handles established mappings only; initial creation is manual. Roles and project permissions stay local.',
  config: {
    enabled: 'Integration enabled',
    corpId: 'Corporate ID',
    agentId: 'Agent ID',
    directoryRead: 'Directory read credential configured',
    directoryWrite: 'Directory write credential configured',
    messages: 'WeCom notifications enabled',
    autoSync: 'Automatic two-way sync',
  },
  on: 'Yes',
  off: 'No',
  search: 'Search local or WeCom ID',
  kind: 'Type',
  all: 'All types',
  department: 'Department',
  user: 'Person',
  clear: 'Clear filters',
  identity: 'Mapped identity',
  state: 'Status',
  updatedAt: 'Updated',
  empty: 'No mappings yet',
  emptyHelp:
    'Configure the integration, then link local and WeCom records. Management permission is required to add mappings.',
  noResults: 'No matching mappings',
  states: {
    new: 'Awaiting initial sync',
    synced: 'Synchronized',
    busy: 'Running or awaiting verification',
    unknown: 'Outcome unknown',
    failed: 'Failed',
    created: 'Mapping created',
    conflict: 'Conflict',
  },
  directions: {
    pull: 'WeCom → Local',
    push: 'Local → WeCom',
    equal: 'Matching',
    conflict: 'Choose which side to use',
    auto: 'Automatic',
    link: 'Link',
    reconcile: 'Reconcile',
  },
  direction: 'Direction',
  mappingHelp:
    'Establish explicit identities. Accounts are never merged automatically by name or email.',
  local: 'Local record',
  remote: 'WeCom ID',
  baseline: 'Last synchronized data',
  createLocal: 'Create local record from WeCom',
  userSearch: 'Search local name or email',
  requiredId: 'Select a local record or enter a WeCom ID.',
  idHelp:
    'Use a numeric department ID or a person’s UserID. A local record alone creates a WeCom record on first push; a WeCom ID alone imports it. Map parents and memberships first.',
  compareHelp:
    'Compare both sides, then choose a direction. If both changed, explicitly choose which side to use.',
  comparison: 'Compare data',
  reconcileHelp:
    'The previous operation may have succeeded. Reconciliation reads actual data without resending writes. Wait at least two minutes for running operations; if data differs from the original intent, inspect both systems first.',
  reconcile: 'Reconcile outcome',
  absent: 'Not created yet',
  pull: 'Pull to local',
  push: 'Push to WeCom',
  history: 'Execution history',
  historyHelp:
    'Latest 20 entries, newest first. Older entries remain in the database.',
  noHistory: 'No execution history',
  actor: 'Actor',
  confirm: 'Synchronize “{{name}}”?',
  pullHelp:
    'Apply WeCom name, email, memberships or enabled state to the local record. Existing values may be overwritten. Business roles are unchanged.',
  pushHelp:
    'Apply local name, email, memberships or enabled state to WeCom. This may affect the employee’s access to WeCom.',
  fields: {
    name: 'Name',
    parent: 'Parent (local ID)',
    email: 'Email',
    departments: 'Departments (local IDs)',
    primary: 'Primary department (local ID)',
    enabled: 'Enabled',
  },
  errors: {
    WECOM_NOT_CONFIGURED: 'Configure and enable WeCom on the server first.',
    WECOM_CONNECTION_FAILED:
      'Connection check failed. Check credentials, application visibility and trusted IPs.',
    WECOM_INVALID_ID: 'A WeCom department ID must be numeric.',
    WECOM_DUPLICATE: 'The local or WeCom record is already mapped.',
    WECOM_MAP_PARENT: 'Map and synchronize the parent department first.',
    WECOM_MAP_DEPARTMENTS: 'Map and synchronize all memberships first.',
    WECOM_LOCAL_MISSING:
      'The local record is missing or is not a person account.',
    WECOM_REMOTE_MISSING:
      'WeCom record not found. Check its ID and visibility.',
    WECOM_REMOTE_READ:
      'Cannot read WeCom data. Check credentials and directory permissions.',
    WECOM_INCOMPLETE_DIRECTORY:
      'WeCom returned incomplete data. Check access to names, email and complete memberships. Missing fields will not overwrite local data.',
    WECOM_STALE: 'Data changed. Refresh the comparison before continuing.',
    WECOM_BUSY:
      'An operation is running. Refresh later; after two minutes you can reconcile its outcome.',
    WECOM_CONFLICT: 'Both sides changed. Choose a direction.',
    WECOM_SOURCE_MISSING:
      'The source does not exist yet. Choose the other direction.',
    WECOM_RECONCILE_REQUIRED:
      'Reconcile the previous outcome before writing again.',
    WECOM_UNKNOWN:
      'Outcome remains uncertain. Check that both systems match the original intended values before reconciling.',
    WECOM_SYNC_FAILED:
      'Sync did not complete. Check the target, duplicate emails and WeCom permissions, then refresh.',
    WECOM_WRITE_NOT_CONFIGURED:
      'Configure a credential with directory write permission.',
    WECOM_DEPARTMENT_STATE:
      'The WeCom root or an inactive department cannot be pushed.',
    WECOM_SELF_DISABLE: 'You cannot disable your own account through sync.',
  },
};
