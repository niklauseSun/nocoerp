# Application shell

Read this before changing the layouts, header, sidebar, breadcrumbs, account menu or loading indicators under `client/layouts/`, `client/routing/` and `client/components/`.

## Breadcrumbs and layouts

Layouts own breadcrumb route context and render the current page's trail in the header after the sidebar toggle (`client/components/breadcrumbs.tsx`): the route trail by default, or the trail a page declares with `usePageBreadcrumb` from `@nocobase/app-client` when it names records. Pages do not render breadcrumbs themselves. `AppRouter` selects routes and layouts. See [pages and routes](../skills/nocobase-app-development/references/frontend/references/page.md) for each layout's scope.

## Header and sidebar

`client/layouts/components/layout-header.tsx` is a presentation container accepting children. The sidebar is shadcn's Sidebar: `components/app-sidebar.tsx` wraps its provider, desktop icon mode and phone sheet, and `components/navigation-menu.tsx` draws the permission-filtered route tree with `SidebarMenu*`: a top-level group with no page of its own is a section, its entries always shown under a `SidebarGroupLabel` heading, while clickable parents and nested groups are controlled `Collapsible` sub-menus, and an item `client/lib/navigation-transform.ts` marks `section` deeper in the tree is a heading over its direct links inside that menu; a count beside an entry, such as unread items, is passed by the App layout in `NavigationMenu`'s `badges`, keyed by route name. Leave `client/components/ui/sidebar.tsx` as the shadcn CLI writes it and customize from outside: widths go through the provider's `style` in spacing units, the phone sheet is rendered in `app-sidebar.tsx` with a translated title, and the provider's Ctrl/Cmd+B shortcut is stopped at `document`. The App layout owns menus, branding, permissions and redirects. Desktop icon mode hides top-level section headings and keeps their entries' icons, shows leaf labels as zero-delay tooltips and opens groups in hover and keyboard-focus popovers, preserving filtered navigation, parent-page links, nested groups and the selected group's highlight. Keep this behavior aligned across layouts. Desktop collapse state is shared through `useSidebarPreference` at `nocobase:sidebar:collapsed` across applications on the same origin; whether the phone sheet is open stays local to each layout.

The header carries no Settings or Inbox entry. An application has no separate settings area: a page that configures something is an ordinary route in `client/routes.ts` with `navigation`, placed in the sidebar like any other page, for example under a Settings navigation group. The `/inbox` page declares no navigation; give it an entry where the application wants one.

`client/lib/navigation-transform.ts` is the application-owned hook for customizing the permission-filtered navigation tree. The shared sidebar supports static section labels with direct links as well as collapsible groups.

本应用在该transform中把已授权的应用入口按“工作入口、租户经营、物业服务、收支财务、系统管理”重排；AppLayout传`sections={false}`使用现有可折叠菜单。组仅存在于导航树，不注册虚拟路径、不移动真实路由、不改变page id或授权；不要为菜单归组重写业务路径。空组不显示，未知/插件入口保留原顺序，不凭空授予页面权限。组标题使用应用navigationGroups locale；“手机工作台”统一显示为“工作台”，保留/workbench与原mobile-workbench名称。

Navigation groups retain their expanded or collapsed state while the navigation tree stays mounted. Selecting a new page expands its ancestor groups without collapsing other groups; users can still collapse the active group manually.

## Account menu and session

The account menu checks Better Auth sign-out results before refreshing the session and shows a localized error toast for API or network failures. Preserve this behavior when upgrading the shell; navigation alone does not revoke a session.

The authorization provider clears the permission snapshot before rendering a new session. Route navigation and page guards subscribe to the authorization revision; preserve these checks when customizing the shell so account changes and permission updates take effect without a reload. Pending checks hide protected content, and failed checks deny access.

The account menu language control in `client/layouts/components/language-switcher.tsx` uses a shadcn submenu with radio items. Render it inside `DropdownMenuContent` to preserve menu keyboard navigation and selection semantics.

## Branded loading

Use `Loading` for page or panel waits and `Spinner` (the shadcn-compatible adapter to `BrandSpinner`) for inline pending actions, uploads, and refresh indicators. Both share the stable NocoBase mark and orbit animation; do not introduce independent Lucide spinners for application loading. Keep skeletons for content placeholders and progress bars for determinate progress. `index.html` has the matching pre-JavaScript mark and must stay visually consistent. All animations respect reduced motion.

The shared list of shell behaviors to keep when customizing is in [customizing the shell](../skills/nocobase-app-development/references/frontend/references/shell.md).

## 手机租户流程与可视键盘

本应用已提供手机底栏与`ResponsiveTable`卡片分支（768px断点）。报送/结算列表、结算子表及租户服务复用原单元格与操作；`ResponsiveTable.enabled`只让目标平面表启用，含Fragment的其他业务表不要直接转卡片。工作台通过原page和composite权限显示报送、待确认结算和服务入口，入口不授予权限。

共享`RouteOverlay`传入`useVisualViewport`的高度/offsetTop变量，`styles.css`仅在手机分支限制位置和高度，使虚拟键盘只影响弹窗可视区域而不改表单状态。内核默认`100dvh`不能覆盖iOS仅改变visualViewport的情况，因此这是应用保留的定制；桌面仍用组件默认定位。保留resize/scroll卸载清理与无visualViewport的window fallback，更新模板时不要删掉这层。

报送分组和sticky保存区、结算/服务单列详情使用md断点，与手机卡片一致；覆盖页复用useCoverFocus，Action基准版本必须显式刷新，read权限不能代替confirm权限。说明与验收边界见`docs/手机浏览器租户流程.md`。本轮浏览器工具拒绝观察，本次只有源码/组件证据，不能声称真机375px、主题、IME或软键盘已验收。

工作台现为直接URL/手机底栏入口：`/workbench`保留登录要求和原子路由，但不声明`navigation`，不出现在桌面侧栏或手机“全部功能”菜单。不要因其在分组映射中预留了名称就重新添加侧栏入口；手机首页跳转与底栏仍可进入。
