# DEPLOY-MANIFEST（服务器 /opt/her 为准）

生成：2026-11-12 01:45（阶段 1 收尾）。规则：不在 LEGACY 列出的文件一律不删；归档只动 LEGACY。

## 驱动源
| 驱动 | 跑什么 |
|---|---|
| her-mind.timer 25min | her-mind.mjs tick |
| her-news.timer 60min | her-world-news.py fetch |
| her-watchdog.timer 5min | her-watchdog.sh（已并入 her-tick-check.py） |
| her-backup.timer 2h / her-backup-daily.timer 03:00 | her-backup.py |
| cron 03:10 | her-cost-split.py |
| cron */10 | /root/her/mem-guard.sh |
| her-chat.service | chat-server.mjs |
| herqq-bridge.service | /opt/herqq/bridge.mjs |
| 内核 spawn | write-novel / daily-toon / self-learn / her-ledger |

## LIVE
bili-learn.mjs, brain.mjs, chat-log.mjs, chat-server.mjs, check-vps-sites.mjs, compose-toon.mjs, daily-toon.mjs, explore.mjs, gh-skill.mjs, gw-image.py, her-arbiter.mjs, her-backup.py, her-complete.mjs, her-consume.mjs, her-contract.mjs, her-cost-split.py, her-goals.mjs, her-graph.mjs, her-ledger.mjs, her-mind.mjs, her-ops.mjs, her-relationship.mjs, her-soul.mjs, her-tick-check.py, her-verify.mjs, her-veto.mjs, her-watchdog.sh, her-world-news.py, her-world.mjs, learn.mjs, morning-report.sh, plan.mjs, scan-bugs.mjs, self-learn.mjs, video-learn.mjs, write-novel.mjs

## MANUAL（手动跑，不删）
check-vps-sites.mjs, her-goals.mjs, her-graph.mjs, her-veto.mjs, morning-report.sh, scan-bugs.mjs

## LEGACY（已归档到 _legacy/20261112-stage1，2026-11-12）
boss.mjs, day.mjs, dy-library.mjs, events.mjs, her-being.mjs, her-endo.mjs, her-personality.mjs, her-proactive.mjs, wallet.mjs, world.mjs

## 本轮收尾证据
- her-life.service：disabled / inactive（ExecStart day.mjs --loop 不再运行）
- night-watch.timer：disabled；逻辑并入 her-watchdog.sh -> her-tick-check.py
- explore.mjs：曾误归 LEGACY，因 learn.mjs（daily-toon 依赖）spawn 它，已移回
- 验收：SCHEDULE 只剩 her-world.mjs；brain-usage 只有 brain.mjs 一个写入者

## 阶段 2 新增（2026-11-12）
- her-knowledge.mjs（知识检索；bridge 注入）
- her-content-signal.mjs（A 轻量信号；cron 09:05）
- her-tick-check.py（原 night-watch，被 her-watchdog 调用）
- check-learning.py（学习触发验收；cron 18:10）
- her-cost-split.py（上游按模型拆分；cron 03:10）
