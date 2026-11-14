import shutil, time
NL=chr(10)
m='/opt/her/her-mind.mjs'
shutil.copy2(m, m+'.pre-movesync-'+time.strftime('%Y%m%d-%H%M%S'))
s=open(m,encoding='utf-8').read()
# 原插入块（在 ⑥ 反思前）
block=("  // ④b 记账同步（2026-11-11）：账本从 brain-usage 按天 upsert；失败只告警，不阻断主流程"+NL+
 "  if (!IS_DRY) {"+NL+
 "    try {"+NL+
 "      execFileSync(process.execPath, [HOME + '/her-ledger.mjs', 'sync'], { cwd: HOME, encoding: 'utf8', timeout: 30000 })"+NL+
 "    } catch (e) {"+NL+
 "      try { notify('warn', 'ledger-sync', String(e.message).slice(0, 120)) } catch { }"+NL+
 "    }"+NL+
 "  }"+NL+NL)
assert block in s, 'block not found'
s=s.replace(block,'',1)
anchor="  m.emotion.effect = computeEffect(m.emotion)"
assert anchor in s
s=s.replace(anchor, anchor+NL+NL+block.rstrip(NL),1)
open(m,'w',encoding='utf-8').write(s)
print('记账同步移到 tick 前段（idle 也会跑）')
