# T012：引用工具输入契约验收

Issue [#33](https://github.com/wang1299/dsh-reforge/issues/33)，[设计](../decisions/015-tool-input-contract.md)。本轮没有模型调用，也未重跑或改写T011。

## 修改与复现

基线bb4dd9d上先提交设计和失败断言：真实DSH SystemPrompt组装的candidate没有object类型/字段，兼容检查1通过1失败。实现后candidate为封闭对象，citations为封闭对象数组，必填的四个引用字段可见；revision为integer。数值/数量/路径/摘要/来源限制仍由原领域层校验。

同一官方ToolRuntime离线重放T011的receipt-as-citation，仍拒绝且候选数为0；正确路径先propose无引用，再从实际工具输出复制facts及纠正receipt绑定，成功。错误摘要、陈旧revision、跨session和未授权执行仍拒绝。没有自动补hash或删除kind。

## 检查与交付

本地check通过59项（含类型/静态/构建），compat通过2项；实际tgz经官方plugin-manager/app-boot安装组件探针通过，额外检查安装包公开的嵌套字段。本地未运行模型。两平台当前头CI和独立稳定提交评审在关联PR记录；只有这些门槛满足才合并。实际模型能否正确遵循新契约尚未验证，不能声称学习闭环或收益已完成。数据格式/六工具名称/固定DSH版本未变，未发布新包。
