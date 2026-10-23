# ADR035：更名与首次公开发行

> 历史设计记录：当时的内部名称按原实现保留。当前身份、路由与升级规则见 [ADR037](037-project-identity.md) 和[安装指南](../installation.md)。

2026-10-23，T033 / Issue #75；基线608ee05，实现前决定。用户明确授权更名为dsh-reforge、发布自己的npm包与GitHub Release。

## 包与兼容身份

公开npm包和CLI改为`dsh-reforge`，品牌DSH-Reforge，首版`0.1.0-alpha.1`、npm `alpha`标签及同版本GitHub prerelease，不称稳定版。当时的代码/Release 沿用原仓库，保留贡献与评审历史。T037 后浏览地址为 `wang1299/dsh-reforge`，冻结首发包的 repository 字段仍保留发布时身份。补repository/bugs/homepage/license/公开发行元数据，白名单只包含产品编译输出、patch、README/LICENSE/CHANGELOG和安装指南。

DSH patch行ID保持`dsh-evolve`，模块name指向新包；公开client loader包ID及plugins.bundle.config键改为新包名。已有`evolve_`工具、内部workflow/context/source kind、原生RPC端点、main/settings/action槽位ID、usage指纹、SQLite v9与默认`.dsh/evolve/<repoId>/evolve.sqlite`保持，防止历史来源/预算/会话断裂。新`DSH_REFORGE_CONFIG`与旧`DSH_EVOLVE_CONFIG`都可用；双变量原生realpath不一致时拒绝，显式input配置仍为最高优先。

旧本地预览升级须停止旧进程、备份数据与profile，并先移除旧本地package再安装新包，避免两个worker操作同一库。remove只移除插件依赖；保留配置/dataDir/历史/授权。不得从npm安装已被其他项目占用的`dsh-evolve`来替代旧本地包。新装默认仍关闭学习/执行/模型共享，单仓库与固定DSH版本边界不变。

## 制品与发布顺序

先完成类型/静态/测试/兼容/实际tgz新装与保全升级、稳定SHA独立只读评审、最终双平台CI、规则核对与合并。只有干净且对应已合并树的产物才能冻结发布候选；保存内容清单、SHA256/SHA512/SHA1和版本到本机忽略目录，检查禁止用户数据、凭据、临时目录、源码checkout和测试日志。

发布npm之前核对实际登录账号、包名空缺与准确版本，只上传冻结tgz，不触发生成新制品的脚本。发布失败或结果未知先查registry的版本/完整性/发布者，不盲目重试。公开registry的包和下载完整性一致、实际从公开tgz安装通过后，才创建并推送准确版本的annotated tag；注释固定源commit、包完整性与npm发布者，不含凭据或本机路径。

GitHub连接器不支持创建Release。新增只监听本次准确tag的工作流，使用自动GITHUB_TOKEN的最小`contents:write`（只用于已授权Release，不修改仓库/账户安全设置）。工作流核对tag与package/version、源commit已进入main、registry元数据和tag完整性/发布者，下载该npm准确制品、校验其字节和包元数据，再以草稿上传制品/校验和/公开元数据及真实限制说明，核对附件后发布prerelease。避免另一份重建包冒充已发布npm制品；任何未知远端副作用保留并查询再决定恢复。

## 授权和限制

2026-10-23用户本人已登录npm，核对账号wang129；若需2FA仍由用户本人处理；不索取聊天密钥、不更改2FA或受信发布者配置。无模型调用、新预算/提炼资格、数据删除或新平台部署。没有成功的npm/Release远端回读则保持“待发布/阻塞”，不把PR合并或本机打包当已发布。发布前状态在README/CHANGELOG/安装指南中明确标注，完成结果追加Issue/Release记录。
