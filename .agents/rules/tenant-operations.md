# 租户运营与对账

- `/tenantOperations` 聚合租户报送完整性、结算交付、欠费账龄、到期空置、经营报表、外部账单对账；页面 id `hyl-tenant-operations`。不替代原业务台账。服务 `server/tenant-operations/`，路由 `server/routes/tenant-operations.ts`；业务规则与使用说明见 `docs/租户运营与对账.md`。
- 各视图独立取原业务 composite policy。欠费/资金匹配严格复用 `FinanceService.snapshot` 的源权限交集；财务现金 Line 保留 method 供精确候选匹配。原始外部账单归导入人私有；`hyl.externalReconciliation/write` 是独立设置权限，不自动扩展现有岗位。
- 报送按有效合同日期生成 merchant-day，重叠合同去重，提前退租取 actualEnd。缺报与零收入分开。营业汇总只取 approved，已确认结算管理费按冻结结算起始月单独列示。欠费/出租率/合同到期是当前状态，月份不伪造历史余额。
- `hylOperationFollowups` 追加留痕、服务端 actor/time 与 requestId 幂等；催缴金额不靠备注维护。`hylBankRows` 唯一 account+externalId，整批导入事务；`hylBankMatches` rowId/eventId 双唯一，一对一确认。自动候选严格匹配日期、流水号、有符号整数分、渠道；手工确认同金额并填写理由。匹配不登记资金、不开票、不改账单。
- `hylReportingFiles` 使用官方 File Repository；`reporting-files.ts` 每条 metadata/upload/content 路径都有原报送/费用权限检查，私密流输出；10MB、真实 PDF/PNG/JPEG 校验。附件追加不可覆盖/删除，业务保存后再上传。不要以客户端过滤替代私密内容鉴权。
- 站内待办复用 MessageSources 的 bills 订阅：结算 sourceType=settlements，只提醒当前有确认方式者；operationFollowups 只提醒作者的最新到期跟进并再次验证源写权限，账单已结清退出。通知仍走原个人偏好/租约/幂等投递，不自动开启订阅、不接外部渠道。
- Export 的 OOXML 采用文本单元格保留超长编号/精确金额、禁止公式执行；CSV防公式注入；PDF用 sharp+pdf-lib，生产需中文字体。PDF/Excel都走当前源权限；冻结金额与当前付款登记分开。
- 测试 `tests/tenant-operations`，受影响消费者 `tests/finance`、`tests/messages`、`tests/hyl/calculation.test.ts`、路由测试。真实合同、岗位和银行样例验收需另行执行，不能把 TEST/DEMO 通过当作真实财务验收。
- 现金收缴率使用财务投影的`cashAppliedCents`，仅有效收款核销/直接应收收缴，排除押金抵扣和未分配预收。当前余额口径，不随月份伪造历史。外部对账查询按业务交易日期，财务现金报表仍按登记日期。
- `bank-import.ts`提供显式列映射和元/分精确转换；`previewImport`有错整批不可提交，`confirmBatch`逐项重验唯一候选并返回失败清单。`hylBankResolutions`追加处理结论，不改变匹配或资金。对账界面包含映射/预览/提交、选中候选批量确认和差异处理。

- P2交付路由在`server/routes/operations-delivery.ts`，结算批次`batches.ts`、租户服务`tenant-service.ts`、TEST准备`integrations.ts`。迁移005/006已在开发库执行，不再改历史。批次最多30项、10分钟持久租约；仅最后一次失败且尚无结算的项可重试，payload.batchItemId绑定原结算避免中断重复。清单仅准备，不代替线下付款。
- 新服务权限是独立settings：`hyl.tenantService/manage`、`hyl.integrationTesting/run`，不自动给真实角色授权。服务通过官方Lifecycle记录状态；租户owner加原商户scope，通知/已读/反馈事件追加且CAS版本控制。原消息bills订阅复用，不自动打开。
- 新UI保持中文/英文，复杂覆盖页，批次内源详情与原结算动作均保留查询上下文。`useRefreshMissing`对403/404刷新列表，409需显式加载版本、保留文本。`useLeave`必须优先检查busy后才放行clean导航。
- 接入页只作本地TEST契约自检，providerConfigured始终false，无真实远端请求和密钥配置。不要把TEST通过解释为支付/税务/小程序正式接入。
- 本轮浏览器访问被工具安全策略明确拒绝，不得通过替代浏览器/CDP绕过；新UI只有源码/组件验证，375px/主题/IME/焦点均未验证。

- 手机浏览器租户服务列表已接入ResponsiveTable/MobileSort，复用原数据、动作、分页和筛选；详情md以下单列，操作仍在header；复杂流程不改小程序。完整本轮结果与未验证项见`docs/手机浏览器租户流程.md`。
