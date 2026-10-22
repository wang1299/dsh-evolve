# T031 原生界面验收

Issue [#71](https://github.com/wang1299/dsh-evolve/issues/71)，PR [#72](https://github.com/wang1299/dsh-evolve/pull/72)，分支 codex/t031-native-ui；基线 4dd2f140e7973768e3f3c64d176c8e0ea1151b2d。设计提交 61c78c3，生命周期补充设计 72fa9ef；最终精确路由选择见 ADR033。

## 实现

固定官方 DSH 0.2.0-rc.2 client 元数据、模块注册及设置/主面板/对话按钮；隔离复用经验界面，经官方认证 /api 精确路由共享 EvolveService。单仓库、SQLite v9；无新服务端口、授权、预算或模型调用。独立面板保留。

## 实际检查与失败保留

- 首个必要用例编译失败记录在本机 t031-before.log（尚无 native-rpc 模块）。随后 RPC/面板/兼容针对 13/13 通过。
- 初次本机完整 check 因工具环境缺少 npm 命令停止；移除脚本中的嵌套 npm 后，183 项中 182 通过、1 个 Windows 符号链接权限跳过，0 失败。最终生命周期/精确路由修正后再次完整 check：184 项中 183 通过、同一权限跳过 1 项，0 失败，包含类型、静态检查和前端构建。日志为本地 t031-check-current.log。
- 官方兼容 8/8 通过。实际 tgz 标准安装探针通过；学习探针的 happy、invalid-extraction、sharing-off、failed-target 四场景完成，后三者保留预期 partial；正常对话自动学习案例通过，零 evolve 工具、零真实模型 HTTP。本地日志 t031-install-standard.log / t031-install-learning.log。
- 真正完整官方 Web、全新隔离 home/profile 与实际 tgz 已试装。首次设置标签出现但 RPC 不通，诊断排除 tools 缺失；rpc.handle 的 getter shadow 在提供者上下文缺 webServer，消费者显式 inject 也不够。改用官方 fetch 精确路由，无宿主修改。
- 消息/原生模块注册、真实 HostConnectionService 迟到挂载/卸载、信封/32 KiB、operator/session/repo/schema/revision 拒绝等针对检查通过。最后增加的长驻客户端回归见下文。

## 完整 Web 手动验收

- 新通道匿名请求 401，认证后的 info 返回 200；浏览器在 DSH 设置标签内看到合成候选、来源、学习阶段和关闭模式，并实际停用候选，显示已保存。
- 多次正常重启后该合成候选仍为停用。预置合成会话的顶部“经验”进入全宽主面板，“返回对话”恢复同一会话，空输入保持为空，没有发送消息。
- 390 × 844 视口下主面板标题、概览、导航与进度卡片正常换行、滚动；测试后恢复默认视口。截图 t031-native-settings.png / t031-native-main.png / t031-native-return.png / t031-native-narrow.png 只保存在本机忽略目录。
- 为检查已有对话入口，隔离试装通过官方 controller 写入了明确标注的合成 turn/step/user-message/end 事件，未调用模型。这些数据仅证明界面及存储行为，不是实际模型提炼或经验收益证据。

## 独立只读 AI 评审与 CI

- 首次稳定 SHA 920264ad170cdddfda89370a97bf0d524c1e704c 对比上述基线，由独立只读 Agent 审查。发现 P2：前端把周期 GET 也永久计入 4096 个请求 ID，约 5.69 小时后会停止更新。实际 bundle VM 复现 4097 次读取只有 4096 次转发；本机 t031-long-day-before.log 保留断言失败。另建议 npm test 构建 client，已采纳。
- 修复 SHA 02ae9332abe55b766068a7ad766411319ee270bd：GET 不计写入账本，16 个在途请求结束释放；写入重复/4096 个上限显式报错，额度满仍能读。npm test 先构建 client。针对客户端 3/3 通过，涵盖 4097 次 GET、重复 POST、写入额度满后的读取。
- 同一独立审查者对 02ae933 相对 920264a 增量复审并独立运行 3/3，用例通过，无剩余阻塞问题。AI 评审不冒充 GitHub 正式 Review。
- 精确代码头 02ae933 的 [CI 39721536543](https://github.com/wang1299/dsh-evolve/actions/runs/39721536543) 在 Windows / Ubuntu 全部成功，覆盖 check、compat、demo、pack 及两种实际安装探针。后续文档增量的独立审查、最终头 CI、规则核对和合并以 PR #72 的记录为准；满足后才更新用户测试配置。

## 限制与交付

只管理当前配置绑定的仓库。设置页不是自动学习配置向导。默认开关、已占用次数和未知费用不变；打开页面不等于模型已配置或有授权。轮询保留编辑，卸载视图不保存未提交草稿。未验证 Desktop、其他 DSH 版本、大库分页或真实模型质量/收益。

当前未发布包或 Release。用户已有试装的升级需保留所有历史行、预算/授权、用户代码与独立验收，并备份本地数据库及 profile；升级结果作为本机记录和 PR 开发评论追加，不上传私人会话、路径或凭据。
