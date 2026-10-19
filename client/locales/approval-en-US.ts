export default {
  searchRequests: 'Search document number or title',
  searchConfigs: 'Search project or business type',
  savedNamed: 'Saved “{{name}}”',
  discardConfig: 'Discard approval configuration changes',
  discardSubmit: 'Discard approval submission comments',
  discardOpinion: 'Discard unsent review comments',
  chooseProject: 'Choose a project.',
  nameInvalid: 'Enter a level name of 1–60 characters.',
  candidates: 'Review candidates',
  candidatesInvalid: 'Select 1–20 candidates for each level.',
  allRequests: 'View all approvals',
  noResults: 'No matching records',
  noResultsHint: 'Change the search or clear filters.',
  noConfigsTitle: 'No project approvals configured',
  noConfigsHint:
    'Configure project/business approval levels and candidates, then submit from a business document.',
  cancelForm: 'Cancel',

  snapshot: 'Submitted business snapshot',
  assetCount: '{{count}} assets',
  moveUp: 'Move level up',
  moveDown: 'Move level down',
  snapshotFields: {
    title: 'Contract title',
    start: 'Start date',
    end: 'End date',
    rent: 'Monthly rent',
    depositTarget: 'Target deposit',
    cycle: 'Settlement cycle',
    method: 'Billing method',
    assetIds: 'Proposed assets',
    amountCents: 'Document amount',
    dueDate: 'Due date',
    neededOn: 'Needed on',
    reason: 'Purchase reason',
  },
  title: 'Approvals',
  description:
    'Sequential review of new leases, draft bills and purchase requests.',
  requests: 'Approval requests',
  configs: 'Approval configuration',
  newConfig: 'Configure project approval',
  detail: 'Approval details',
  submit: 'Submit for approval',
  save: 'Save configuration',
  saved: 'Saved',
  retry: 'Retry same request',
  cancel: 'Back',
  clear: 'Clear filters',
  search: 'Search number, title or project',
  kind: 'Business type',
  status: 'Status',
  view: 'View',
  source: 'Source document',
  applicant: 'Applicant',
  level: 'Approval level',
  levels: 'Sequential levels',
  frozenLevels: 'Submitted approval levels',
  context: 'Submission details',
  project: 'Project',
  enabled: 'Enable approval',
  revision: 'Configuration revision',
  round: 'Submission round',
  sourceVersion: 'Submitted document version',
  comment: 'Submission / review comments',
  required: 'Please enter a comment.',
  createdAt: 'Created',
  updatedAt: 'Updated',
  history: 'Decision history',
  current: 'Current level',
  yes: 'Enabled',
  no: 'Disabled',
  inactive: 'Inactive',
  candidateCount: '{{count}} configured candidates',
  actionsTitle: 'Review this submission',
  openSource: 'Open source document',
  readOnly:
    'You can view progress and history. Only a current candidate can decide this level.',
  configReadOnly:
    'You can inspect these settings. Editing requires approval configuration permission for this project.',
  notRequired:
    'Approval is not enabled for this project and business type. Existing effective documents retain their state.',
  cannotSubmit:
    'This document is not currently available to submit. Refresh the source document to check its status and permissions.',
  freezeHint:
    'The first submission freezes the configuration and candidates. Resubmission keeps that configuration. New settings apply to new submissions only. Any candidate at each level may decide; the applicant cannot approve.',
  levelHint:
    'Configure 1–5 levels in order, with 1–20 alternative people per level. Disabled users, applicants and people without project/business review permission are excluded at submission. Each level must have an eligible candidate.',
  levelsInvalid:
    'Each level needs a name and 1–20 distinct people; enable 1–5 levels.',
  peopleSearch: 'Search enabled people',
  addLevel: 'Add next level',
  removeLevel: 'Remove level',
  empty: 'No matching approval requests',
  emptyHint:
    'Submit from a draft lease, bill or purchase request. Change the view to see submitted or completed requests.',
  noConfigs:
    'No matching configuration. Authorized administrators can configure approval by project and business type.',
  reload: 'Refresh document version; keep comments',
  useRevision: 'Load current revision; keep my draft',
  uncertain:
    'The result is unknown. Inputs are frozen. Retry the same request to recover its outcome.',
  discard: 'Discard unsaved changes',
  discardHint: 'Your unsaved comments or configuration will be discarded.',
  finalConfirm:
    'Passing this final level immediately applies the business action. Confirm the document and comments.',
  advanceConfirm:
    'Pass this level and send the submission to the next level. The source document remains ineffective.',
  rejectConfirm:
    'Reject this submission and unlock the source for amendment. Resubmission starts again at the first level.',
  cancelConfirm:
    'Cancel this approval request and unlock the source. History remains. A new submission uses current configuration.',
  newest: 'Newest event first',
  oldest: 'Oldest event first',
  kinds: {
    all: 'All business types',
    contracts: 'New lease activation',
    bills: 'Draft bill issue',
    purchases: 'Purchase request approval',
  },
  states: {
    all: 'All statuses',
    draft: 'Draft',
    pending: 'In approval',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  },
  views: {
    pending: 'My pending reviews',
    submitted: 'My submissions',
    all: 'All visible requests',
  },
  actions: {
    approve: 'Approve level',
    reject: 'Reject submission',
    cancel: 'Cancel approval',
    submit: 'Submitted',
    advance: 'Passed level',
  },
  permissions: {
    read: 'View approvals',
    configure: 'Configure project approvals',
    submit: 'Submit business approvals',
    decide: 'Decide current approval level',
    cancel: 'Cancel approval request',
  },
  effects: {
    contracts:
      'After every level passes, the new lease becomes active and binds its assets. Deposit, billing and settlement actions are unavailable before activation.',
    bills:
      'After every level passes, the draft bill is issued and becomes receivable. No collection or deposit deduction is allowed before issue.',
    purchases:
      'After every level passes, the purchase request is approved and may be converted into an order.',
  },
  errors: {
    APPROVAL_ACCESS_DENIED: 'You do not have approval permission.',
    APPROVAL_SOURCE_LOCKED:
      'This document is in approval. Reject or cancel approval before editing.',
    APPROVAL_REQUIRED: 'Complete the project approval workflow first.',
    APPROVAL_CONTRACT_DRAFT:
      'This contract is awaiting approval and cannot be used for financial operations.',
    APPROVAL_ACTIVE_LOCKED:
      'An active contract with bound assets cannot be changed into a new approval draft.',
    APPROVAL_NO_CANDIDATE:
      'A level has no eligible reviewer. Check enabled users, project permissions and applicant separation.',
    APPROVAL_PERSON_INVALID: 'A selected person is disabled or unavailable.',
    APPROVAL_SOURCE_CHANGED:
      'The source document changed. Refresh before submitting or reviewing.',
    APPROVAL_CHANGED:
      'The approval changed. Refresh its current level and version.',
    APPROVAL_CONFIGURATION_CONFLICT:
      'The configuration changed. Load the current revision, review your draft and save again.',
    APPROVAL_CONFIGURATION_INVALID: 'The approval configuration is invalid.',
    APPROVAL_CONFIGURATION_REQUEST_REUSED:
      'This save request was already used. Refresh and try again.',
    APPROVAL_REQUEST_REUSED:
      'This action request was used with different data.',
    APPROVAL_ONE_PROJECT_REQUIRED:
      'Approval requires all selected contract assets to belong to one project.',
    APPROVAL_PROJECT_REQUIRED: 'Select a project.',
    APPROVAL_NOT_FOUND: 'This approval is unavailable.',
    APPROVAL_SOURCE_MISSING: 'The source document is unavailable.',
    APPROVAL_NOT_YOUR_LEVEL:
      'Only a current candidate other than the applicant may decide.',
    APPROVAL_ALREADY_SUBMITTED:
      'This document already has an approval request.',
    APPROVAL_DISABLED: 'Approval is not enabled for this document.',
    APPROVAL_SOURCE_STATE:
      'The document is no longer in a state that permits this action.',
    APPROVAL_LEVELS_REQUIRED: 'Enable at least one approval level.',
  },
};
