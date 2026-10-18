# 工单报修

- 业务代码 `server/repairs/`，API `server/routes/repairs.ts`，页面 `client/pages/repairs/`，入口 `/repairs`，页面grant `hyl-repairs`，composite `hyl.repairs`。迁移 `202610180005_repairs` 创建订单、追加事件、请求防重表；无业务演示seed。
- 复用 HylProvider 的同一个 LifecycleRuntime 和既有日志表，状态只能runtime create/fire写。reported→assigned→processing→pendingAcceptance→accepted→closed；reject退回processing；reassign回assigned；progress/edit自迁移；cancel从未完工状态进入cancelled。closed/cancelled终态；edit只在reported且关联身份固定。
- 动作权限read/report/dispatch/process/accept/close/cancel单独定义，具名assets数据库scope与既有asset read相交，再与merchant/contract read相交。列表授权后再计数分页；来源不可读则整单不可见。无默认普通角色扩权。repairAssignees只在dispatch许可下返回有效person的id/name，使用公开UserAdministrationService；process动作校验当前处理人。
- 工单创建资产可normal/maintenance，不能inactive。关联商户需报修日绑定覆盖；关联合同需资产签约关联与实际有效租期覆盖，商户从合同派生。身份、报修日和快照后续固定；历史不会因资产名称变动自动改写。
- 所有写操作预解析权限，事务中按既有merchant→当前assetproject锁序重查。expectedVersion防旧写，actor+规范化intent+requestId持久化防重。重放仍检查当前权限；版本冲突需显式刷新。
- 完工要求结果、凭据文字和非负两位小数总成本。整改重提是更新本次总成本，旧值留在事件中；不会生成账单或支付。事件含actorName、状态前后、version、说明、处理人/到期日快照；按工单version排序再分页，避免同毫秒事件乱序。早期演示事件缺处理人快照时从公开用户服务补展示名称，不改历史。
- 资产/商户/合同详情只展示≤10条工单摘要和View all，工单/关联档案以各来源的本地子路由打开，来源leaf只读且无递归。related-list的kind从当前路由和父id解析；search用repair前缀避免覆盖原页面筛选。
- 表单首次开启动作/编辑等fresh fetch完成后冻结baseline；显式reload才替换。未知响应保留原requestId/body；busy禁用编辑和关闭。异步离开确认复用app同步navigation guard：捕获本地link/POP目标，拒绝第一次导航，确认放弃后恢复目标；不改模板导航边界。beforeunload保留浏览器保护。
- 验证在 `tests/repairs/`，消费者路由、assets UI、hyl lease UI/workflow受影响时同时运行。说明和演示ID见 `docs/工单报修与派单验收.md`。
