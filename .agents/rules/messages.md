# 消息通知与业务待办

- 官方通知与站内收件箱插件已注册；server/config/notification.ts 默认稳定 inbox/in-app 渠道。只站内投递，不接外部短信、邮件或支付。复用 InboxBlock 和官方持久化读未读、分页与实时刷新；不得直写插件消息表或伪造事件。
- 个人入口 /inbox（原 route id 不变，新增侧栏 Bell）、/messageTodos/:messageTodoId、/messagePreferences。个人页 auth required/authz skip；所有接口以 session actor 做不可覆盖的所有权检查，各业务源再走当前权限。消息已读不等于业务处理。
- server/messages/service.ts、sources.ts，迁移 202610190002_messages：个人偏好默认关闭；开启后按合同临近/已到期、未结账单到期/逾期、报修派单处理验收关闭、采购审批下单收货验收付款生成待办。普通角色不自动授权。收件人必须有效 person；定时任务每次重建其授权上下文，不能复用管理员权限。
- 使用普通 ScheduleExecutor @nocoerp/messages，每五分钟检查最久未检查的至多 10 人；多用户批次可能超过五分钟。内部工作无需 Scheduler 管理页面。个人检查有持久化五分钟租约，CAS 设置写入在租约中拒绝；失效 token 不得提交 projection/ack。失效收件人先从候选人中剔除，避免饿死后续用户。
- hylMessageTodos 用 LifecycleRuntime active/resolved。业务条件消失退出，重现 generation+1；每人/来源/原因/日期唯一。冻结通用文案不含名称、金额、联系方式，通知 target 只指向需所有权和实时源授权的待办。列表计数在逐条授权后计算；撤权详情 404。
- generation 对应稳定幂等键和冻结文案；插件 send 在事务外。插件已接受但 app 未保存 notificationId 时，原键原文重放，不得换键；已知 delivery 只允许 failed 的原 ID retryDelivery，unknown 禁止新逻辑发送。已投递不代表已读。
- 关闭订阅在偏好保存事务中 resolve 对应 active 待办，不依赖只处理 enabled 用户的 schedule；不删除历史消息、不批量标已读。减少提醒天数在下一次检查投影更新，详情实时判断当前条件。
- 页面列表支持源单号/标题搜索、类别/状态、updatedAt 默认降序、精确分页；详情分业务上下文/投递记录，明确跳转源记录处理。设置是原子 checkbox 草稿，有版本 CAS、错误保留、脏离开确认。
- tests/messages 为 SQLite up/down、四业务 API/inbox 流程、隔离/撤权/幂等/租约及 UI 测试。说明与演示记录见 docs/消息通知与业务待办.md。
