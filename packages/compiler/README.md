# @grid/tbsite-compiler(占位,T1.3 起填充)

规则编译核心 + CLI。从 `tb-frontend/src/provisioner/publisher.js` 抽出的纯函数(TS),`tbsite_compile.py` 冻结后本包是唯一编译器。见 `dev/docs/开发计划-v2.md` T1.3、T2.5、ADR-001 / 003,架构 v2 §9 ⑤。

```
src/
  core/                 expandTemplates  matchSelector  resolveAggMembers  buildAggCfs  buildCf
                        rollupMetadata  alarmMetadata  revenueMetadata  validateConfig  → 输出「写入计划」,无网络
  writer/               publish / cleanup(注入 TbApi 接口,可 mock)
  profile-alarms.ts     Device Profile alarmRules 编译(ADR-001)
  migrations.ts         既有站点 calc_ 前缀迁移表生成(ADR-003,只生成不执行)
bin/tbsite.ts           publish | cleanup | validate | plan;密码只接受 --password-env
scripts/put-pageconfig.ts   里程碑 A 临时脚本,T3.7 后删除
test/
  fixtures/             demo-site.tbsite.json  xrs-mirror-test.tbsite.json(来自 tb-compiler/sites/)
  parity.test.ts        TS 版 vs Python 版写入计划 deepEqual
  live/                 需 TB_BASE / TB_USER / TB_PASSWORD,手动跑
```
