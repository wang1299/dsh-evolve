# T026 验收与独立评审

Issue [#61](https://github.com/wang1299/dsh-reforge/issues/61)，交付 [PR #62](https://github.com/wang1299/dsh-reforge/pull/62)，设计[ADR028](../decisions/028-explicit-extraction-reauthorization.md)。

## 范围与实现

owner显式新授权可对一个unknown提炼追加一次新单次grant尝试。旧Job、输入摘要、原grant用量不变；无自动重试、链、金额重置、模型工具或HTTP授权入口。CLI仅排队；有效当前材料、同模型控制、执行信任与共享授权必须同时成立。普通enqueue不因配置更换创建新尝试。SQLite v7迁移和面板关联已实现，七工具/模型适配边界不变。

## 真实执行的检查

- 设计提交fd084db，失败复现a2c089e先于实现；实际报Missing explicit owner reauthorization。
- 初次针对检查8/9，负测试构造了不满足schema的bundle；已改为合法incomplete输入，继续要求拒绝。
- 初次完整检查147/151：三个迁移版本断言仍为6，另一个为上述负测试。更新预期至实际v7，保留所有历史行、外键、回滚及拒绝断言。
- 最终本地完整check：类型/静态/构建和151/151测试通过。官方DSH固定版本兼容6/6通过，真实Git/pytest demo通过。
- 实际tgz安装的脚本模型演练通过：正常闭环完成；无效提炼、关闭共享、目标失败三条负路径保持partial。零模型HTTP。该源码包SHA256 e27706924801ebe3b3c2c53a2d4ddb3c14818b939174e365037ed33cd81c3ac2；后续文档打包身份以实际安装记录为准。
- 实际安装CLI在一致的v6本地案例数据库副本上迁移v7、排队新授权、重复幂等通过，全部原行保留，新grant used=0。仅副本发生变化；此检查期间原运行库仍v6、财务账本未变化，无模型调用。

## 独立只读AI评审

基线a6bb09be54e52f9b01bdf39f21c6079c3366b5b6。稳定源码616632cdf4a7abdab71aafbb8a97c6eac21c960e、tree d27674ed23523d1d3d78d1298d955ad4d0ec1f11由独立Agent只读评审，发现P2：panel.ts处理非空Job时，技术详情仍引用已被改名的extraction，实际合成渲染复现ReferenceError。

修复及必要复审目标848b836d5b47cc9098ca7f33f1bbc9fc9ac1d43a、tree fdba463a5ee8b3df1583779b7f73ab3e69748892。改用extractions；从实际HTML提取渲染函数，检查无提炼及unknown＋新candidate、父子说明/两个ID。独立复现不再报错，复审无剩余P0/P1/P2阻塞。远端59a9167c11b1d644763bf2bc317ef37cf529d923具有相同tree。AI评审不是GitHub正式Review；文档增量另做必要核对。

## 最终门槛和限制

当前头的两平台CI（含check/compat/demo/pack/普通及学习实际安装）、Review/保护/规则及合并状态，以PR #62实际记录为准；任何必要门槛未通过不得合并。后续真实模型执行另行记录，不能用本页脚本模型验收替代。没有发布包、Release或部署，没有用户数据上传；没有证明经验改善未来任务，也没有解决Windows沙箱Git写权限。
