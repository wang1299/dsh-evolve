# ADR-006：实际安装包的配置层验证

> 历史设计记录：当时的内部名称按原实现保留。当前身份、路由与升级规则见 [ADR037](037-project-identity.md) 和[安装指南](../installation.md)。

2026-10-18，实施前设计。固定DSH 0.2.0-rc.2。

问题：官方`runPluginCommand`在隔离profile成功安装本地tgz，bundle元数据和版本检查通过，但`composeEntries`得到空列表。原`cordis.patch.yml`只有id/name，按官方include语义是覆盖已有行；空树中没有目标，不能注册新插件。

决定：bundle用`insert`显式加入唯一的dsh-evolve条目。常规兼容测试直接用固定官方app-boot解析和组合真实manifest，断言结果包含插件；不能只检查包元数据。另保留按需执行的实际tgz安装探针，通过官方plugin-manager共享操作、独立profile和包管理器验证安装与配置组合，不改用户DSH_HOME或现有profile。

探针只使用合成数据、本地tgz；执行信任和模型共享关闭；不调用模型。profile和安装报告留在ignored目录。它不能代替完整Web/Desktop启动或真实模型会话。

验证先保留当前manifest产生空列表的失败断言，再改manifest。此变更不改变学习数据库或公开核心API。
