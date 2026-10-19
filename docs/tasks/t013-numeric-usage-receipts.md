# T013：数值用量诊断回执

Issue [#34](https://github.com/wang1299/dsh-evolve/issues/34)，依赖T011，衔接已合并T012。[ADR016](../decisions/016-numeric-usage-receipts.md)先于实现。

范围：固定原结算策略的数值解析原因、有限白名单sidecar、网络前预留及诊断写入、离线流/费用/隐私故障测试。非目标：回填或释放旧unknown、修改价格/预算/资格、真实采样、重新实验或收益结论。

验收：代理实际写入UUID关联回执，成功/失败计数与原因可解释且无正文/凭据；未知/异常仍保留最坏预留；重启和磁盘失败不重开预算。check、compat及两平台CI/独立稳定提交评审完成后合并；原T011失败与账本SHA保持。
