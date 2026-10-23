# T032 插件页与主题一致性验收

Issue [#73](https://github.com/wang1299/dsh-reforge/issues/73)，分支 codex/t032-native-plugin-page，基线 3832e2a297b6e348f419edc4d606fc2e95e17f94。实现前 ADR034 提交 08f3999；无数据格式、模型授权、预算或学习机制变更。

## 实现和依据

固定官方 DSH 0.2.0-rc.2 `dsh-client-ui-plugin-manager` 的 slot-contract 声明组合包操作页属于 `plugins.bundle.config`，按 `dsh-evolve` 包名注册；宿主绘制标题/图标/返回。原有对话主面板、设置入口保留。类型依赖固定版本，没有浏览器 runtime 导入 plugin-manager。

内嵌视图移除重复品牌与宣传页头，使用紧凑概览、进度、经验内容。读取官方 theme-presenter 的 body 投影，发送固定字段主题消息；来源/origin/channel/形状、CSS颜色和字号全部校验，事务式校验后才改CSS变量。主题变化不重载iframe或重建表单。沿用ADR033隔离/CSP和认证API；独立HTTP面板布局保留。

## 已实际验证

- 缺失入口回归先失败：期望 `plugins.bundle.config` 而实际仅3个原槽位，本机 t032-entry-before.log 保留。实现后插件slot注册、消息关联、长驻读写、主题来源/有限字段/颜色拒绝、草稿不被主题处理器读写以及原面板交互针对检查通过，详见PR验证记录。
- 官方兼容8/8通过，本机 t032-compat.log。完整check初次因测试fixture函数类型不匹配未开始，修正fixture注解后重新运行；完整结果及最终头CI必须在PR登记，不把预览构建当完整检查。
- 将真实tgz安装到既有专用合成Web profile（完整固定官方宿主）。从左侧“插件”→已安装dsh-evolve→详情，实际出现共享经验操作界面；尚无模型与提炼配置，未发起模型请求。
- 在合成经验编辑处理策略但不保存，打开DSH设置，将跟随系统改为深色，关闭设置：视图变深色、同一草稿和revision保留；恢复跟随系统后草稿仍存在。填写原因后实际保存成功，生成待检查修订；只改专用合成数据，用户实际数据未参与。
- 390×844视口：插件详情、概览、导航、进度正常换行；DOM测量viewport/clientWidth/scrollWidth均390，iframe宽305。测试后恢复默认视口。截图 t032-plugin-page.png、t032-dark-draft.png、t032-narrow.png仅本地忽略目录。

## 最终门槛与限制

稳定SHA独立只读评审、必要修复、最终双平台CI和当前仓库规则全部满足后才合并；结果和自己的现有试装保全升级记录追加关联PR。当前未发布npm/Release，未新增模型调用或授权。原预算/unknown/逻辑资格/SQLite v9不变。

本次保留隔离子文档实现，并非将所有界面组件重写成DSH React primitives。插件详情仍有宿主外层滚动与隔离视图内部滚动；未验证其他宿主/版本、Desktop、任意第三方主题或真实模型收益。主题切换保留草稿；卸载/离开操作页仍沿用T031的未保存草稿丢弃语义。主功能和技术记录均属本项目。
