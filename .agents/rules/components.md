# Components and styling

Read this before adding or changing a component, a shadcn primitive, a UI Library item, or the application's visual design.

## Imports

Use package-local imports such as `#components/ui/button` and `#extensions/nocobase-auth-forms/form-parts`. `package.json#imports` declares their targets, and `components.json` uses the same prefixes for shadcn generation. Keep directory entry points explicitly mapped to their index files. Do not add a Vite alias or TypeScript `paths` mapping for these imports.

## shadcn/ui primitives

Use shadcn/ui for UI. The template ships only the primitives its shell and compositions use: `button`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `spinner`, `toast` and `tooltip`. Check `client/components/ui/` first; if the primitive is not there, add it from the shadcn registry rather than writing your own. `yes n |` answers "no" when the CLI offers to overwrite a primitive that is already installed; without an answer, a non-interactive run stops at that question. Format the files it created and translate the English a few primitives carry, as [the shadcn guide](../skills/nocobase-app-development/references/frontend/references/shadcn.md) lists; otherwise keep them as the CLI writes them:

```bash
yes n | pnpm exec shadcn add card
pnpm exec prettier --write client/components/ui/card.tsx
```

Build your own components by composing these primitives, and put them in `client/components/`. A page below another one — a covering child page, a record's own page — leaves by the header's breadcrumb when its route declares `breadcrumb` or the page declares its trail with `usePageBreadcrumb`, and otherwise by `BackButton` (`client/components/back-button.tsx`) above its heading; never both.

**Look components up in the shadcn skill.** The development Skill carries the shadcn/ui skill, unchanged from shadcn 4.21.0, in `.agents/skills/nocobase-app-development/references/frontend/shadcn/`. Read [the shadcn guide](../skills/nocobase-app-development/references/frontend/references/shadcn.md) first: it routes to the skill's rules and states where this application departs from them, among others `pnpm exec shadcn` instead of `npx shadcn@latest`, no `shadcn apply` or `--preset`, and create, edit and detail as `RouteDialog` or `RouteDrawer` child routes rather than a `Sheet`. `pnpm exec shadcn docs <name>` gives one primitive's documentation and examples for the Base UI version. For a whole page, start from the worked example that [the example index](../skills/nocobase-app-development/references/frontend/references/example.md) indexes.

## UI Library items

`PageContainer`, `PageHeader`, `RouteDialog`, `RouteDrawer`, `RouteChildPage` and `useRouteOverlay` in `client/components/` come from the NocoBase UI Library, as do the authentication blocks in `client/extensions/nocobase-auth-forms/`, `nocobase-auth-methods/`, `nocobase-auth-split-layout/` and `nocobase-device-approval/` that `client/pages/auth/` composes, and the inbox block in `client/extensions/nocobase-inbox/` that `client/pages/inbox.tsx` renders on `/inbox`; like the rest of the source, they belong to the application. `yes n | pnpm exec shadcn add @nocobase/<item>` adds another item from the library: a single component lands in `client/components/`, a complete feature in `client/extensions/nocobase-<item>/`. A date field and a list's `DataTable` are the application's own components: compose `DatePicker` in `client/components/date-picker.tsx` from the `calendar` and `popover` primitives, following shadcn's Date Picker guide, and build `DataTable` in `client/components/` from the `table` primitive and `@tanstack/react-table`, following shadcn's Data Table guide. The CLI adds the packages an item or primitive needs to `dependencies`: move the new ones, such as `react-day-picker` for `calendar`, to `devDependencies`, as [where to declare a dependency](../skills/nocobase-app-development/references/dependencies.md) explains for everything client code imports, but leave `@nocobase/i18n` in `dependencies`, where the server needs it, and put back the `^` of its range, which the CLI pins.

## Styling and visual consistency

Style with the semantic Tailwind tokens — `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary` — so pages follow the light and dark themes. Do not hard-code colors like `bg-white` or `text-gray-900`; they break the moment someone switches theme.

**Visual consistency is a whole-application property.** Match the surrounding code's spacing, typography, and component choices. If a change genuinely calls for a different look, change the application's design tokens in `client/theme/themes/*.css` so every page moves together. Never restyle only the part you are working on — a page that looks different from the rest is a defect, not a customization.

The default brand palette and density live in `client/theme/themes/*.css`; shared hover/cursor and Badge geometry live in `client/styles.css`, outside generated shadcn primitives. For semantic status labels, use `StatusBadge` from `client/components/status-badge.tsx` with `neutral`, `info`, `warning`, or `success`; choose the tone by meaning and keep the visible status text. A badge beside a title or on a dense card is the small one, `size='sm'` on `StatusBadge` or `data-size='sm'` on `Badge`. Reuse these shared components and tokens in new pages so template upgrades can carry the design consistently.

**Follow the UI guidelines.** [The UI guidelines](../skills/nocobase-app-development/references/frontend/ui-guidelines.md) set the conventions every page follows, among them the page header and the single placement of the primary action, empty states, row actions behind one "…" menu, dates picked from a `Calendar` in a `Popover` rather than a native date input, and medium-width drawers; the frontend workflow says how much of it to read for a change.

## Linked-record search

- 合同、资产、供应商等关联记录选择统一复用 `client/components/record-search.tsx`：远端分页使用 `RecordSearch`，已有完整快照使用 `LocalRecordSearch`；不要重新拼“搜索框 + 独立 Select”。单个输入框输入搜索，选中后右侧 × 清空；枚举状态/类型仍使用 Choice。
- 业务包装层负责原 API、记录范围、详情回显、依赖清空、禁用和分页；公共组件不读取业务表或修改授权。`client/hooks/use-record-search.ts` 将查询、分页和标签缓存按来源条件、登录用户和授权版本隔离，来源变化立即重置。远端搜索不在客户端二次过滤、不展示加载中的旧页选项。
- 业务表单提交/未知结果/冲突时显式向选择器传 disabled；原生 fieldset 不覆盖传送到 portal 的选项。必填选择器可清空，但仍由原表单校验阻止空值提交；多选保留原限制和逐项移除，并提供输入框 × 清空全部。清空旧表计、续租合同等来源时同步清除带入字段并使预览失效，不删除正式绑定或历史台账。

- 合同选项文案统一用 `client/pages/hyl/contract-label.ts`：`payload.title` 非空时显示“合同名称 · 编号”，否则使用合同记录 `name` 中的商户快照。通用 RecordPicker、能耗 Picker、报修 Picker、续租分账选择共同复用；能耗绑定通过已有权限校验的合同投影 `contractTitle`/`contractMerchantName` 渲染，仍保留绑定日期，不混用绑定编号与合同编号。

- 财务来源选项统一复用 `source-record-label.ts` 与 `RecordSearch`：展示已有权限 DTO 的商户、合同快照名称/编号、单据编号和期间；快照优先于当前合同标题。单选清空使预览失效；多选搜索添加后保留金额明细，达到上限仅禁止新增，不禁用根控件以保留 ×。收银清空来源同步清空合同分摊但保留支付信息；退款清空来源和关联核销/详情缓存；显示元数据不得进入严格校验的业务请求。
