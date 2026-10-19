# ADR019：未知usage的有限结构诊断

日期：2026-10-19。设计先于实现，Issue [#41](https://github.com/wang1299/dsh-evolve/issues/41)。T015两次真实响应都在message_start阶段unsupported_usage，原回执缺少具体位置/字段身份；不能确认哪个字段或T011历史原因。

## 选择与边界

不放宽任何计数/终结/未知字段拒绝、预留或结算规则。新增`diagnoseMessagesUsage`只为已有解析结果补第一处拒绝的有限结构：固定location（start_top_level、start_message_usage、delta_usage、stop_usage、other_event_usage）、固定violation（unsupported_location、unknown_fields）、usage的JSON类型、未知字段数量、最多8个字段名指纹及省略数。其他原因不带该结构，原`analyzeMessagesUsage`返回形状保持。

只对当前拒绝位置的直接未知字段名计算SHA256（域分隔`dsh-evolve/usage-field/v1`加NUL）；按指纹排序去重，最多8个。不保存任意字段名原文/值、嵌套内容、事件名、提示、响应正文或错误文本。指纹是可关联标识，不是匿名化/加密：可对官方已知字段名同域计算来比较，低熵名称可被字典猜出。因此只适用于受控服务商协议诊断，不接入私人真实轨迹，不自动上传。

所有新结构受严格schema及数量约束；最多1MiB响应、64个数值快照的既有上限保持。多个错误时只报告解析器首先拒绝的位置，不能宣称扫描了剩余响应；位置拒绝优先于未知字段拒绝，符合既有返回顺序。

## 回执兼容与接入

DeepseekBudget可显式选择receiptVersion=2，默认仍为1；这与账本schema1/2、policyId及插件SQLite版本是不同版本轴。v2回执在v1数值字段外增加必需的diagnostic（unsupported_usage时非空，其余为null）；统一只读schema接受v1/v2，严格拒绝额外正文。旧程序不识别v2，不能用旧读取器读取新文件，无自动迁移/降级。

v2写入仅接受当前实例新reserve并成功持久化的UUID，不能给重启前/历史unknown补造诊断或覆写旧回执。先预留/待处理回执再网络，终结回执先持久再settle，磁盘失败停止且全额占用不变。HTTP/传输失败覆写总体原因时diagnostic为null，不能把解析器看到的局部错误当完整响应原因。

本任务用合成transport展示显式v2接入；不更改T011/T015入口/冻结方案、资格、旧回执或账本，不自动启用下一次模型。将来新的固定实验可用第三个构造参数`2`开启，须另冻结方案和获得实际预算授权。没有新模型调用、凭据访问或实际未知字段认定。

## 验证与限制

先补能够区分相同unsupported_usage原因的失败用例，再覆盖五个固定位置、null/空对象、已知/未知字段、数量截断/排序、秘密标记不泄露、v1/v2严格读写及旧记录保护；经实际本机HTTP+合成transport核对仍保留完整预留。原计数/流/磁盘故障回归继续通过。稳定提交独立只读审查及当前头两平台CI后才合并。

该任务补诊断信息，不证明DeepSeek当前额外字段是什么或其计费语义，不解决原生学习闭环和收益评价。合成变体不是服务商真实采样，不能把未来诊断回填为过去观察。
