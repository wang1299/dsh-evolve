# ADR034：DSH 插件详情入口与主题一致性

> 历史设计记录：当时的内部名称按原实现保留。当前身份、路由与升级规则见 [ADR037](037-project-identity.md) 和[安装指南](../installation.md)。

2026-10-22，T032 / Issue #73；基线 3832e2a。实现前决定。

## 问题

T031 的认证和数据接入已完成，但只有会话按钮与旧内置设置标签；独立面板的大页头和绿色样式仍用于内嵌视图。固定 DSH 0.2.0-rc.2 官方 `dsh-client-ui-plugin-manager` 声明组合包配置属于 `plugins.bundle.config`，按 npm 包名注册，由宿主绘制标题、图标与路径。用户期望遵循这一入口和宿主样式。

## 决定

新增 `plugins.bundle.config` 的 `dsh-evolve` 键，使用现有单库 NativeView。保留会话主面板及设置入口以兼容已有操作。插件详情已有宿主标题，内嵌只显示绑定仓库和实际内容；内嵌视图移除重复品牌和宣传大页头，以紧凑概览、学习进度与经验内容为主。独立 HTTP 面板保留现有布局。

继续使用 ADR033 的隔离 srcdoc、官方认证共享 /api、同一 EvolveService 与严格 mutation；本次不重写学习或数据模块。原生外壳仅读取官方主题 DOM 投影（body 的 `data-ds-dark-theme` 与固定 `--dsw-alias-*` 颜色/字号），向确切 iframe 发送带既有随机 channel 的有限主题消息。子页严格核对父窗口、origin、channel、消息形状、允许的变量名/颜色/字号；只修改 CSS 变量，不重载 srcdoc，不重建表单，不增加命令/授权或网络能力。初次 load 和主题属性变化推送，卸载清理监听/observer。消息中不包含任意 CSS、HTML、路径、用户数据或 credentials。

入口选择依据固定官方发布包的 slot-contract 和 theme-presenter 契约。新类型依赖固定 0.2.0-rc.2，浏览器不打包或运行时导入 plugin-manager。

## 验收

先补缺失插件配置 slot 和主题拒绝/更新回归；验证源/信封/CSP/写入不重试及轮询草稿约束不回退。真实 tgz、完整固定 Web 的插件列表→自有包→经验详情、主题变化保留草稿、窄屏和会话返回；测试、兼容、必要独立只读稳定 SHA 评审、最终 CI 后合并并保全升级自己的试装。零模型调用，SQLite v9/预算/授权不变，未发布。
