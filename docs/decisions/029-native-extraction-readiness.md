# ADR-029：原生提炼的凭据服务就绪与有界失败原因

状态：接受；T027 / Issue #63。实现前设计，基线d444331。

## 复现与原因

固定完整DSH 0.2.0-rc.2 / Cordis 4.0.5，在隔离home、假密钥、预先排队的真实Git/pytest来源上执行。环境变量假密钥路径完成候选；本机managed凭据路径在fetch前收到MISSING_CREDENTIAL，grant已占用、记录unknown；凭据服务就绪后的相同离线适配器调用完成。所有远端fetch由本机假SSE替代，外部请求为0，没有读取用户Key。

Cordis Service构造时注册，提供者Fiber初始化完成后才active。`ctx.get(name)`默认strict=true，仅返回active服务。原生provider仅依赖llm；当credentials尚在加载时，其内部get返回undefined并回退到启动环境。managed Key因此暂不可见，而继承环境中的Key可用。Evolve原先只检查llm/provider，提前消费了调用资格。

## 决定

仅原生DSH后台提炼的port发现增加`ctx.get('credentials')`就绪门槛。固定完整DSH包含此官方服务；等待期间保持waiting/model_unavailable，grant不占用。只检查服务可用性，不resolve/describe任何Key，不检查私有provider配置，不用固定延时，不把服务就绪视为任务正确或凭据有效。

原七工具、证据worker、Core及独立dshExtractionPort接口不增加强制依赖。完整宿主之外使用bindDsh的调用方，需提供active credentials服务；无此服务则自动提炼等待。测试脚本适配器提供明确的无秘密生命周期fixture。服务加载失败或凭据根本未配置仍须如实显示，不能自动发送探测调用。

## 失败原因与SQLite v8

保留unknown/failed状态与次数策略。仅扩展固定reason枚举：model_prepare_failed、model_route_changed、model_credentials_missing、model_transport_failed、model_timed_out、model_cancelled、model_incomplete。原生准备/流错误只映射这些宿主定义类别；未知SDK code回退interrupted_model。绝不保存异常正文、cause、任意code、响应或凭据；错误消息由固定类别构造。无效输出继续failed/invalid_response，版本漂移继续failed/invalid_material。

这些类别仍是unknown而非成功或未计费证明；既有owner显式新授权入口允许识别它们，仍要求fresh单次grant、同材料/控制，最多一次直接追加、无链。旧unknown原因不回填。

v8只标识reason读取契约变化，无新表/列。事务内验证外键并推进user_version；v7历史行原字节保留，不回填旧unknown原因或释放grant。旧程序拒绝v8，升级前停旧宿主和面板并备份。旧实验财务账本不修改。

## 验收与边界

必要失败用例先于修复：异步凭据服务构造但未active时，预排队任务不能调用适配器或占用grant；服务active后恰好一次候选。凭据/准备/传输/超时/取消的类别及隐私负路径、服务缺失等待、旧unknown保留/不重放、v7行保留和v8拒旧读者均检查。

在实际tgz和完整官方CLI上重复managed假密钥预排队路径，保留原失败与修复后的原生结果；还检查有无环境Key两种路径。脚本模型证明接口和调度修复，不证明真实模型质量或收益。旧未知任务不自动恢复、不增加重试链或金额。真实新提炼仍需独立明确授权。
