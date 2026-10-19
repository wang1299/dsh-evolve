# ADR-016：实验代理的最小数值用量回执

2026-10-19，T013 / Issue #34，基线0b230fc。本轮离线开发；无付费采样或预算重置。T011原始HTTP SSE未保存，不能确定两次unknown的根因。

## 协议核对与范围

固定官方`@deepseek-ai/dsh-llm-deepseek@0.2.0-rc.2`发行源码：`updateUsage`接受四项非负整数并以最新值覆盖，`translate`在message_stop返回usage及finish；不逐项约束输入/缓存计数单调。核对的lib/index.js SHA256为226e2047b843f954d8478207613f3e44448671c6f98f8edee77008d0fe005484。

[DeepSeek官方接入文档](https://api-docs.deepseek.com/quick_start/agent_integrations/)确认Messages入口；[Anthropic流协议](https://platform.claude.com/docs/en/build-with-claude/streaming)说明start、delta、stop及delta累计计数。它们不能证明T011实际出现过缓存重分配。用合成快照重放输入减少/缓存增加的情况，记录现行保守策略拒绝原因；本轮不放宽ADR014逐项单调/最高价预留策略。新的结算策略须另定方案与验证。

## 决定（先于实现）

1. 原预算JSON schemaVersion=1及费用/次数上限不变。新增独立本机sidecar目录`<budgetPath>.receipts/<reservation UUID>.json`，回执schemaVersion=1，固定policyId=`t011-conservative-v1`和模型名。只记录本机请求UUID、HTTP状态、响应字节数、有限状态/原因枚举、消息start/delta/stop/error的四种数值计数与白名单stop reason、其他事件数量、最终可确认usage。缺失或不是安全整数的计数用null；不保存任意事件名称、错误消息、请求ID头、Key、prompt、消息/工具正文或代码。回执不是服务商账单。
2. 最多64条计数/终结快照，响应仍≤1MiB；超限保持unknown，不靠截断回执去结算。完整SSE帧/JSON、初始数值、非负/单调/上下限、最终输出/stop和正常HTTP结束均是结算条件。普通content/ping不持久化正文；未知usage字段不能被静默当作免费。
3. 先落库最坏预留，再原子写reserved回执，再网络发送。完整结束后先持久化数值判定，再调用原账本settle；回执的complete表示解析合格，不等于账本已结算。两文件不是事务，崩溃可留下eligible回执+未知账本；绝不据回执自动释放预算。HTTP/类型错误、流中断、超界等保留预留并尽力写原因。持久化失败让该实例停止新请求；不会因为写失败退还预算。
4. 账本独占锁覆盖回执写入，校验已预留UUID及封闭回执schema。临时文件fsync+rename；只读历史旧账本不创建或补造回执、不回填T011。诊断目录属于ignored实验数据，不在插件库、包或用户目标仓库中；保留到owner明确清理，不自动删除历史数据。

## 验收与限制

先补失败用例证明实际代理没有sidecar。离线重放完整流、缓存快照变化/计数倒退、超界/未知计数、残帧/截断/传输异常/HTTP失败、分块边界；校验UUID关联、预留先于fetch、隐私白名单、重启与写失败保守性。保留59项已有门槛和固定DSH兼容；当前头两平台CI/稳定SHA独立只读评审后合并。没有真实采样，不能宣称T011根因已解决或学习闭环/收益已完成。
