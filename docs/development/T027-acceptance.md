# T027 原生提炼启动竞态验收

Issue [#63](https://github.com/wang1299/dsh-evolve/issues/63)，基线d444331ff9d4ea683134483757be7c4bf9635aec，设计[ADR029](../decisions/029-native-extraction-readiness.md)。

## 可复现原因

固定完整官方DSH 0.2.0-rc.2、Cordis 4.0.5、独立home/profile与Python/pytest来源，先排队提炼再启动。整个Node进程的外部fetch被替换为固定本地SSE，使用假密钥，不读取真实Key。

| 原生场景 | 修复前 | 修复后 |
|---|---|---|
| 环境变量假密钥 | 自动candidate，1次被拦截fetch | 自动candidate，1次被拦截fetch |
| managed假密钥 | MISSING_CREDENTIAL；unknown；0次fetch；grant已占用1 | 等active服务后自动candidate；1次被拦截fetch；grant占用1 |
| managed服务active后的独立适配器调用 | 完成 | 不需要额外重试 |

修复前managed来源在隔离案例中确实产生unknown，原记录保留；不是在原记录上清零或重放。旧用户体验unknown没有详细类别，因此不能倒推每一条旧中断的唯一原因。

官方Cordis strict get只返回active Fiber提供的服务；原生provider已注册时，credentials-local可能仍在异步loadInitial。provider未取得credentials时回退启动环境；managed密钥暂不可见。Evolve现在同时要求llm/provider与active credentials，等待阶段不占用逻辑次数，不resolve/describe Key。Core与独立适配器无新依赖。

## 检查结果

- 设计9c4b9a4和失败用例ae289d9先于实现；旧代码实际在credentials未active时调用1次适配器，触发“1 !== 0”失败。
- 最终本地check通过：类型、静态、构建与154/154测试；官方兼容8/8通过。覆盖缺失/加载中服务等待、active后一次候选、卸载取消、固定失败映射与不保留异常正文/cause、v7原行保留和显式新授权仍受一次/无链约束。
- Git/pytest demo通过；实际tgz安装的脚本学习四场景通过：happy完成，invalid-extraction/sharing-off/failed-target保留各自partial。没有真实模型HTTP。
- 完整官方CLI实际安装包的managed/env两路径均通过；24个产品JS与源码构建逐字一致，archive SHA256 `9e049669d6919fc2817d3e1093fb223587f86dec29e0097208081ee31755c761`。每例预排队、真实独立Git/pytest来源、恰好1次native调用和自动candidate（未启用），外部请求均0。文档更新后的包摘要可能不同，需继续核对产品JS。
- 实际安装的v7读取器可读原案例副本；新安装模块将一致副本推进v8，全部原行/未知状态/已用grant/关联均不变，外键检查通过；旧实际读取器拒绝v8。原运行库和财务账本在此检查中未改变。

最小回归可运行：`npm run build`，再执行`node --test --test-name-pattern="prequeued extraction" dist/test/dsh-extraction.test.js`。该用例用官方Service/Fiber初始化与脚本适配器，不需要Key。完整应用实验另安装固定发行包，使用新的DSH_HOME、官方profile/plugin add、假Key和全局外部fetch拦截；不得在日常home或真实Key上直接改造此实验。测试材料与脚本演练均不证明真实模型质量或经验收益。

## 数据、评审与交付限制

SQLite v8仅标识新的固定reason读取契约；不补写旧unknown原因、不释放grant或费用占额。原七工具不变；不含credentials服务的自建bindDsh宿主会等待，须补齐active官方服务生命周期。真实DSH包含该服务，缺少具体Key仍可能失败并占用一次逻辑资格。

稳定提交独立只读AI评审、发现/修复与比较SHA、当前头Windows/Linux CI及保护/正式Review/合并门槛，记录在关联PR；未满足不得合并。AI评审不是正式GitHub批准。

原用户体验未在代码验收中重试，候选仍为0；升级实际预览另记。真实新调用需要独立明确授权，旧unknown不自动恢复、无重试链。没有发布npm、Release或部署，没有用户私有数据上传。
