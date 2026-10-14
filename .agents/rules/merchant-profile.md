# 商户档案与跟进记录

商户档案页面为 `/merchants`，页面授权 ID 保持 `hyl-merchants`，业务权限沿用 `hyl.merchants` 的 read/write 和记录范围。

- 新增商户可直接上传选填营业执照。`useCreateLicense` 复用 FileUploadField，文件暂存在当前用户拥有的创建UUID下；未知商户UUID的上传需要商户write业务授权，暂存内容/恢复/清理仍严格限制owner。已存在商户继续检查记录范围，不能把暂存授权当作访问已有档案的方式。创建请求传creationId/可选licenseFileId，HylService在同一事务写商户、证照记录、文件linked及hylMerchantCreations（owner+规范化请求hash），同请求重试返回同档案，不同内容/用户冲突。编辑不能传创建字段。保存期间禁止操作附件；网络/5xx不确定结果锁定输入，保留内存原快照重试，明确失败允许修正。取消清理未关联文件，失败保留草稿；成功后清理未选中的临时文件失败仅提示，不能把成功保存视为失败。关闭浏览器会丢失内存草稿，服务端临时附件需按运维策略清理，本功能不新增后台定时清理。
- 商户编号由 `HylService.save` 在新建时生成（SH 加 24 位随机十六进制字符），现有 number 唯一约束兜底；payload.code 与 number 同步。接口兼容旧客户端的 code 字段但不采纳它，新建/编辑表单均不提供编号输入；编辑始终沿用数据库中的 number，保留旧档案的人工编号，不需要数据迁移。
- 商户 category 为下拉经营品类（餐饮、零售、文创、休闲娱乐、生活服务、其他）；其他的具体名称单独保存在 categoryName，选其他时必填且最多 50 字。改选常规品类时服务端清空 categoryName。旧档案的自由文本 category 在编辑时作为额外选项原样展示，接口仍兼容旧值。商户字段标题使用 merchantCategory，费用登记继续使用 category，避免混用标题。
- 基本字段由 `server/hyl/schema.ts` 和 `client/pages/hyl/model.ts` 定义，业务详情保存在 `hylMerchants.payload`。法人、统一社会信用代码、营业时间为选填，旧档案可以逐步补录。
- 证照、走访、联系是 `hylMerchantRecords` 中独立的追加记录，type 为 license/visit/contact；不能通过修改商户 payload 改写历史。服务位于 `server/providers/merchant-profile.ts`。创建人和时间由服务端产生；requestId 与商户、类型唯一，用于相同请求重试，不同内容重用键返回冲突。
- 证照文件使用已注册的 File Repository 插件，元数据位于 `hylMerchantFiles`。上传需要 merchantId 查询参数，服务端验证商户 write 范围，并写入 ownerId/merchantId/linked 默认值；保存证照只能绑定本上传者、同商户且未关联的文件。
- 营业执照等证照的图片/PDF预览和下载由 `server/providers/license-watermark.ts` 生成中文斜向重复水印（仅供海源里景区商户档案管理使用），内容路由在权限验证后直接返回转换结果，不再转交原件流；历史文件同样生效。原件、uploadHash 和元数据不变，原件没有客户端下载入口。上传先验证完整解码，转换失败禁止回退原件；响应 private/no-store，Range 请求也返回完整水印版本。PDF 最多 100 页并限制总水印块数，图片最多 3000 万像素。固定字形轮廓位于 `server/hyl/license-watermark-art.ts`，来源及 SIL 字体许可证随代码保留，无需部署系统中文字体；sharp/pdf-lib 为服务端依赖。
- `/uploads/merchantLicenses/*` 内容路由必须保留应用拥有的认证和商户范围检查。插件原始内容路由是公开的，不能单独挂载。已关联文件按商户 read 授权，临时文件还要求上传者身份及商户 write 授权。
- 临时文件清理通过标准 deleteOne 进行有范围限制的原子删除；持久化清理凭据保存对象key与归属，磁盘删除失败可以重试，成功后才删除凭据。仅当文件元数据已删除时才删除存储对象，禁止清理已关联证照。上传与删除的应用中间件检查请求副本，不能提前消费原始请求流，否则标准路由的 bodyLimit 会遇到已锁定的流。
- 商户详情内容多，使用 RouteChildPage；新增证照为分组表单子页面，走访/联系为 RouteDialog。详情的 licensePage/visitPage/contactPage 分页参数不能带回父列表。
- 应用使用 BrowserRouter，不支持数据路由的 useBlocker。新增记录使用会话和商户隔离的内存草稿保留 Back/导航前的输入，不把证照资料写入 localStorage。上传带uploadId和SHA256摘要以支持重试，导航卸载后不取消可能已提交的上传，返回值仍保存到草稿；licenseUploads端点允许同一上传者在商户write范围内找回未关联文件或重试待清理凭据。明确取消/关闭操作使用 DiscardDialog，窗口关闭使用 beforeunload。不要为了一个表单替换应用路由结构。
- SQLite 单连接事务内不能再通过全局连接解析授权：授权可能首次检查表结构，也可能查询 ownMerchant 的归属。商户、合同、营收、费用的保存，结算生成，以及审核/确认/付款等操作都在事务前解析本次请求所需的策略，事务内通过 withPolicy 继续执行字段和记录范围限制。线下确认所需的 review 权限也必须在事务前解析；不要跨请求缓存策略或增加连接等待时间来掩盖问题。

测试在 `tests/hyl/merchant-profile*.test.ts(x)`。运行服务集成测试时使用 `NODE_OPTIONS=--import=tsx`，保证历史 seed 导入的 `.js` 路径能解析对应 TypeScript。`tests/hyl/workflow.test.ts` 在独立 SQLite 数据库上覆盖从商户建档、合同/营收/费用编辑，到审核、结算、线上/线下确认、异议撤销和付款的完整流程，同时验证权限、重复请求、超额付款及并发冲突。原结算流程因事务内全局授权读取导致的连接超时已修复，保留此测试作为回归保护。
