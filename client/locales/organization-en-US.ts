export default {
  newEmployee: 'New employee',
  editEmployee: 'Edit employee',
  resetEmployeePassword: 'Reset employee password',
  resetPassword: 'Reset password',
  username: 'Username (optional)',
  initialPassword: 'Initial password',
  newPassword: 'New password',
  confirmPassword: 'Confirm password',
  createEmployeeHint:
    'Create an employee account and assign available roles. Maintain department and project access in their organization sections.',
  editEmployeeNamed:
    'Update identity details for {{name}} ({{email}}). Manage role grants in User roles.',
  resetEmployeePasswordHint:
    'Set a new password for {{name}} ({{email}}). Existing sessions will be revoked.',
  disableEmployeeNamed: 'Disable employee {{name}}?',
  enableEmployeeNamed: 'Enable employee {{name}}?',
  disableEmployeeHint:
    'The employee will be signed out and cannot sign in. Historical records remain.',
  enableEmployeeHint:
    'The employee can sign in again with their existing role and data access configuration.',
  employeeCreated: 'Created employee {{name}}.',
  employeeUpdated: 'Updated employee {{name}}.',
  employeeDisabled: 'Disabled employee {{name}}.',
  employeeEnabled: 'Enabled employee {{name}}.',
  employeePasswordReset: 'Reset the password for {{name}}.',
  staffNameRequired: 'Enter the employee name.',
  staffEmailInvalid: 'Enter a valid email address.',
  staffPasswordRequired: 'Enter a password that meets the system requirements.',
  staffPasswordMismatch: 'The passwords do not match.',
  staffRoleRequired: 'Select {{name}}.',
  staffRoleChanged: 'Available roles have changed. Select roles again.',
  staffRolesHint:
    'Only assignable roles are listed. Without a role, only a sign-in account is created; business access is not granted automatically.',
  chooseStaffRole: 'Choose a role',
  noAssignableStaffRoles:
    'No assignable roles. Contact your permissions administrator.',
  staffMissingTitle: 'Employee not found in this list',
  staffMissingHint:
    'The employee may have changed or is outside the current filtered page. Close this dialog and search again.',
  staffErrors: {
    USER_IDENTITY_CONFLICT: 'The email or username is already in use.',
    USER_EMAIL_CONFLICT: 'The email is already in use.',
    PASSWORD_TOO_SHORT: 'The password is too short.',
    PASSWORD_TOO_LONG: 'The password is too long.',
    ROLE_SCOPE_REQUIRED: 'Select the required role.',
    INVALID_ROLE_SCOPE_VALUE: 'Select a valid role.',
    ROLE_SCOPE_NOT_FOUND: 'Role configuration has changed. Reopen the dialog.',
    PROTECTED_ROLE_ASSIGNMENT: 'This protected role cannot be assigned here.',
    LAST_ASSIGNMENT:
      'This employee is the last active member of a protected role and cannot be disabled.',
    INVALID_INPUT: 'Check the identity fields and try again.',
  },

  edit: 'Edit',

  editDepartment: 'Edit department',
  departmentActions: 'Department actions for {{name}}',
  editDepartmentMissing:
    'This department no longer exists. Close the dialog and select another.',
  saveBeforeDepartmentStatus:
    'Save or cancel your edits before changing the department status.',

  add: 'Add',

  memberInDepartment: '{{name}} · {{department}}',
  selectMemberHelp:
    'Choose an account to add. Existing department members and disabled accounts are excluded.',
  noEligibleMembersOnPage:
    'No eligible accounts on this page. Try another search or page.',

  addMemberToDepartment: 'Add a member to {{name}}',
  memberDepartmentRequired: 'Return to the list and select a department.',

  addDepartmentMember: 'Add member',
  setPrimaryDepartment: 'Set as primary department',
  unsetPrimaryDepartment: 'Unset primary department',

  searchEmployees: 'Search employees by name or email',
  tablePage: 'Page {{page}} of {{total}}, {{count}} employees',
  previousPage: 'Previous',
  nextPage: 'Next',
  employeeActions: 'Actions for {{name}}',

  collapseDepartment: 'Collapse {{name}}',
  expandDepartment: 'Expand {{name}}',
  memberCount: '{{count}} members (including subdepartments)',
  directMembersOnly: 'Direct members only',
  memberScopeHint:
    'Includes all subdepartments by default, with one row per employee. All department memberships are shown; at most one active primary department is allowed.',
  departmentMembers: '{{name}} · Employees',
  employeeName: 'Employee name',
  membershipType: 'Membership',
  secondaryDepartment: 'Secondary department',
  actions: 'Actions',
  unavailable: 'Unavailable',
  manageMembers: 'Add or update department members',
  addMemberHelp:
    'These are accounts available to add, not the current department roster. Select an account and save.',

  emptyMembersHelp:
    'Click “Add member” to choose an account if you have permission; otherwise contact your organization administrator.',
  emptyProjectsHelp:
    'If you can grant access, select a project and user or department below. Otherwise contact your organization administrator.',
  emptyRolesHelp:
    'If you can create roles, use New role to configure responsibilities. Otherwise contact your authorization administrator.',
  emptyAssignmentsHelp:
    'If you can assign this role, select a user or department below. Otherwise contact your authorization administrator.',

  cancel: 'Cancel',
  nameRequired: 'Enter a non-empty department name.',
  reload: 'Reload latest',
  reloadHint:
    'Reloading the latest configuration discards your unsaved changes.',
  discardChanges: 'Discard changes',
  disableNamed: 'Disable “{{name}}”?',
  enableNamed: 'Enable “{{name}}”?',
  removeMemberNamed: 'Remove “{{name}}” from “{{department}}”?',
  revokeNamed: 'Revoke access for “{{name}}”?',
  enableHint:
    'Enabling restores this department’s inherited roles and project access for active descendants.',
  directRoles: 'Direct roles',
  userManagement: 'User administration',
  userActions: {
    read: 'Read users',
    create: 'Create users',
    update: 'Update users',
    disable: 'Disable users',
    enable: 'Enable users',
    'assign-role': 'Assign user roles',
    'reset-password': 'Reset passwords',
    'revoke-sessions': 'Revoke sessions',
  },
  searchDepartments: 'Search departments by name',
  confirm: 'Confirm',
  title: 'Organization & permissions',
  description:
    'Maintain departments, job roles and authorized projects. Function grants and record scopes are checked separately.',
  sections: 'Organization sections',
  departments: 'Departments',
  projects: 'Project access',
  roles: 'Roles',
  users: 'Users',
  read: 'Read organization',
  update: 'Maintain organization',
  projectScope: 'My authorized projects',
  denied: 'You do not have access to this section.',
  name: 'Name',
  parent: 'Parent department',
  noParent: 'No parent',
  department: 'Department',
  user: 'User',
  subject: 'Grantee',
  subjectType: 'Grantee type',
  project: 'Project',
  chooseUser: 'Choose a user',
  chooseProject: 'Choose a project',
  chooseSubject: 'Choose a grantee',
  newDepartment: 'New department',
  basic: 'Basic information',
  departmentHint:
    'Changes to the parent or active state affect inheritance throughout the subtree.',
  inheritHint:
    'Members inherit roles and project access from active ancestor departments.',
  memberHint:
    'A user can belong to multiple departments and has at most one primary department.',
  members: 'Members',
  primary: 'Primary department',
  addMember: 'Add or update member',
  noMembers: 'No active members in this department.',
  noDepartments: 'No departments yet. Create a department to start.',
  active: 'Active',
  inactive: 'Disabled',
  status: 'Status',
  email: 'Email',
  save: 'Save',
  saving: 'Saving…',
  create: 'Create',
  disable: 'Disable',
  enable: 'Enable',
  remove: 'Remove',
  revoke: 'Revoke',
  grant: 'Grant access',
  confirmNamed: 'Confirm change for “{{name}}”',
  disableHint:
    'Disabling removes inherited access for this department and its descendants. Independent direct grants remain.',
  removeHint:
    'Remove this department membership. Independent direct grants remain.',
  revokeHint: 'Revoke this source of access. Other independent grants remain.',
  saved: 'Saved “{{name}}”.',
  projectHint:
    'Project access supplies the data scope; a role must also grant the business action with “My authorized projects”.',
  noAssignments: 'No access assignments yet.',
  direct: 'Direct',
  inherited: 'Department inheritance',
  searchUsers: 'Search users by name or email',
  clear: 'Clear filters',
  roleHint:
    'A role describes a job. Assign it to users or departments; choose the data scope independently for each action.',
  noRoles: 'No roles yet.',
  newRole: 'New role',
  roleKey: 'Role key',
  functionalPermissions: 'Function permissions',
  scopeWarning:
    'Grants from every role are combined. “All records” in another role can broaden access beyond authorized projects. Existing custom scopes are preserved until explicitly changed.',
  pages: 'Pages',
  access: 'Access page',
  noRecords: 'No records',
  storedScope: 'Stored custom selection (preserved)',
  searchPermissions: 'Search categories, groups or permissions',
  enabledOnly: 'Enabled only',
  noPermissions: 'No permissions to configure',
  noResults: 'No matching results',
  permissionCategories: 'Permission categories',
  all: 'All',
  levelFor: 'Data scope for {{name}}',
  enabledCount: '{{enabled}} of {{total}} enabled',
  assignments: 'Role assignments',
  roleAssignmentHint:
    'Assign this role directly to a user or inherit it through a department. Each assignment is independent.',
  userHint:
    'Direct roles are shown here. Department inheritance adds roles on each request; assign and revoke in the role details.',
  noUsers: 'No users.',
  discard: 'Discard unsaved changes?',
  discardHint: 'Your unsaved changes will be lost.',
  errors: {
    LAST_ASSIGNMENT: 'Keep at least one active system administrator.',
    PROTECTED_PERMISSION_SET:
      'This role is protected and cannot be changed this way.',
    ASSIGNMENT_NOT_FOUND: 'The assignment no longer exists. Reload the role.',
    ORG_USER_UNAVAILABLE: 'Choose an enabled user.',
    ORG_PROJECT_UNAVAILABLE: 'Choose an active project.',
    ORG_DEPARTMENT_DISABLED:
      'Choose an active department with active ancestors.',
    ORG_NOT_FOUND: 'The department no longer exists.',
    ORG_STALE:
      'The configuration changed. Reload the latest version and try again.',
    ORG_CYCLE:
      'A department cannot be its own ancestor. Choose another parent.',
    ORG_PARENT_MISSING: 'The parent department no longer exists.',
  },
};
