# ADR-004：最小本地面板与运行入口

接受，2026-10-18，在实现前固定公开HTTP边界。

独立CLI读取同一个本地Config和SQLite，HTTP仅监听127.0.0.1随机端口。面板不是云服务，也不声称已集成DSH前端槽位。DSH内使用同一数据与工具，用户可同时打开本地面板。

GET `/` 只返回静态界面骨架。所有 `/api/` 读写都需随机Bearer token；启动地址用fragment携带token，浏览器取出后移除地址fragment，不写localStorage，不把token放在API查询参数。写操作要求同源Origin及JSON，Host必须是当前loopback地址，CSP禁止嵌入和外部资源，输出用textContent。

GET `/api/state` 提供最小任务、经验、来源报告、版本、应用与反馈。POST `/api/experience/<id>/{revise,disable,restore}` 要求当前revision和原因，反馈按新事件追加。POST `/api/cleanup` 仅删除超过30天的事件摘要。不提供执行命令、上传文件或读取任意路径的HTTP端点。

Config读取是本地owner行为；HTTP/模型不能修改executionTrusted、shareWithModel或验证路径。CLI的panel读取配置并显示本地地址；未额外授权不发布或部署。

共享SQLite的并发边界：disable/restore须把expectedRevision检查和新版本写入放在同一事务，不能只在HTTP层先检查。冲突返回409；用户刷新后再决定，旧页面不能修改并发产生的新版本。
