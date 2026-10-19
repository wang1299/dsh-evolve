# ADR023：证据驱动的自动候选提炼

日期：2026-10-19，实施前设计。T020／Issue #49，依赖T019主线278f58a。限定单仓库Python修复，经验仍须单独验证后才能被选择。

## 输入、输出与方法

采用证据约束的结构化提炼，不训练模型。显式finish时，只有owner已设置extraction配置才固定一项提炼资格；未授权任务、历史任务不补采。等待其T019证据包ready后，重新核对task／包／来源／验证摘要、base/fix/依赖及当前干净版本。代码条件取验证版本实际改变且仍存在的Python文件（1–20项）；无法安全确定时阻断。

ExtractionPort只收到有界去敏任务摘要、Python差异、固定版本／依赖和宿主生成的事实目录。事实是验证报告中原始失败、修复后通过与回归通过的数字、用例标识，以及实际存在的明确纠正；不发送会话ID、完整聊天、任意工具参数/输出、环境路径、原始报告summary或凭据。材料UTF-8上限32KiB，超出拒绝，不截成看似完整输入。模型只输出严格JSON：candidate（title、strategy、factIds、inferences、recommendations）或abstain。factIds必须属于目录且不重复；宿主原样构造observedFacts和引用，不允许模型自由生成“事实”、验证状态或文件条件。策略和归纳仍是未经证实的模型建议；引用只保证固定事实来源，不证明策略有效。

候选scope固定为修复版本的文件哈希／依赖；发布前再次核对版本及全部来源。输出仅candidate、revision=1、verificationId=null；不继承已有修复报告为经验激活资格，也不宣称后续收益。模型可拒绝；坏JSON、未知factId、越界输出或漂移均无候选。一个task最多一项自动提炼，不因停用或反例再生成副本来绕过反馈。人工propose仍保留原语义。

## 授权和调用边界

extraction默认缺省（关闭），独立于shareWithModel、executionTrusted、backgroundVerification。配置为grantId（UUID）、已在DSH注册的provider/model、maxCalls（1–100）、maxTokens（128–4096）和timeoutMs（100–120000）。配置本身是对这些新任务最小材料发送给所选模型的明确owner授权；Agent工具及面板不能开启、改grant或增加额度。不得把旧实验余额转成自动提炼授权。本次开发不设置真实配置、不发起付费调用。

SQLite按grantId固定整个策略摘要和消耗，重启不重置，同ID改策略拒绝。run前当前配置必须仍相同；撤销／改变后旧任务阻断。每个任务只占用一次逻辑调用资格，原子扣额在prepareCall前落库，随即标running；之后中断、超时或崩溃记unknown、不退额、不自动重跑。余额不足记blocked。无LLM服务保持waiting，不扣额。保守扣额可能发生在尚未实际发送请求时。

maxCalls限制本插件逻辑调用，maxTokens是请求控制，不是人民币硬上限或物理HTTP计数；DSH适配器／其他中间件可能有自己的行为。要进行有限费用实验，仍需独立冻结模型价格、transport重试及费用资格。本接口不读取Key、不创建provider、不改provider重试／账户设置，不使用工具或Agent循环。

## 持久化与并发

SQLite v5同事务增加extraction_grants和extraction_jobs；v4与早期历史JSON不改，旧程序拒绝v5。grant记录策略摘要、已占用次数。job以task唯一，关联T019 job、冻结策略、状态waiting/running/candidate/abstained/blocked/failed/unknown、有限reason、输入摘要、token/截止、候选ID、已报告数字usage及时间。不保存原始响应或异常正文。任务/证据包仍使用已有规范化引用和保留外键。

首个SQL写获取跨连接写锁；grant条件扣额与job条件占用同事务。running不重试，过期转换unknown；发布必须同token、未过期，且候选、引用、终态同事务提交，失败回滚。调用总deadline和卸载取消，忽略AbortSignal的实现也不能迟到发布；官方适配器应响应signal以终止网络活动。不能证明取消等于服务端未计费。

## DSH／观察／验收

固定官方@deepseek-ai/dsh-llm 0.2.0-rc.2的LlmRuntime.prepareCall／一次性stream；不伪造purpose、session或replay identity。运行时通过ctx.get('llm')可选发现，不增加原六工具的强制服务；peer为精确可选版本。接收有界文本与数字usage，必须以stop结束，拒绝工具／截断／异常流。Core提供runNext与显式worker生命周期；DSH启动并在卸载时等待worker再关闭DB，CLI面板无LLM只展示等待。

鉴权面板显示提炼状态／原因／模型／grant已占用次数与候选链接；原始材料置折叠详情，默认不展示技术标识。验证默认零调用、真实Git/pytest证据到自动候选、来源/版本/注入负路径、严格输出、两连接/进程争用、重启未知/额度、原子发布/迁移、官方LLM与生命周期、包安装。真实模型质量与三组未见任务收益留给独立实验，不以离线适配器成功代替。
