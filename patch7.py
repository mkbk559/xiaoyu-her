import shutil, time
NL=chr(10)
p='/opt/her/her-ledger.mjs'
shutil.copy2(p, p+'.pre-upsert-'+time.strftime('%Y%m%d-%H%M%S'))
s=open(p,encoding='utf-8').read()
i=s.find('function sync()')
j=s.find('/** 充值 */')
assert i>0 and j>i, 'boundaries not found'
new_sync = '''function sync() {
  // 2026-11-11 修（对账发现）：
  //   旧实现是"增量 + 写入未来时间戳 at=day 23:59:59"→ 当天 sync 之后产生的调用
  //   永远小于该时间戳，下一次 sync 会被过滤掉（11-10 丢 3220 token 就是这个）。
  //   改成**按天 upsert**：从 brain-usage 重算每天的总量，替换账本里同一天的 spend 行。
  //   同一天跑 N 次结果相同（幂等），不会产生重复行。
  const rows = readLines(USAGE).filter(r => r.at && (Number(r.tokens) || 0) > 0)
  const byDay = {}
  for (const r of rows) {
    const d = String(r.at).slice(0, 10)
    const t = Number(r.tokens) || 0
    const tag = r.tag || '?'
    if (!byDay[d]) byDay[d] = { total: 0, calls: 0, byTag: {} }
    byDay[d].total += t
    byDay[d].calls += 1
    byDay[d].byTag[tag] = (byDay[d].byTag[tag] || 0) + t
  }
  const ledger = readLines(LEDGER)
  const others = ledger.filter(r => r.type !== 'spend')
  const spendByDay = {}
  for (const r of ledger) {
    if (r.type !== 'spend') continue
    const d = r.day || String(r.at || '').slice(0, 10)
    spendByDay[d] = r
  }
  let changed = 0
  let sum = 0
  for (const d of Object.keys(byDay).sort()) {
    const v = byDay[d]
    const top = Object.entries(v.byTag).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const row = {
      at: d + ' 23:59:59', type: 'spend', amount: Math.round(v.total),
      note: top.map(([k, n]) => k + ':' + Math.round(n)).join(','),
      calls: v.calls, day: d,
    }
    const old = spendByDay[d]
    if (!old || Number(old.amount) !== row.amount || Number(old.calls) !== row.calls) changed += 1
    spendByDay[d] = row
    sum += v.total
  }
  const merged = others.concat(Object.keys(spendByDay).sort().map(d => spendByDay[d]))
  if (changed > 0) writeFileSync(LEDGER, merged.map(r => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10))
  console.log('记账同步：' + Object.keys(byDay).length + ' 天，合计 ' + Math.round(sum).toLocaleString() + ' token，变更 ' + changed + ' 行')
  return sum
}

'''
s = s[:i] + new_sync + s[j:]
open(p,'w',encoding='utf-8').write(s)
print('her-ledger sync 改为按天 upsert（幂等）')

# 内核：每日记账同步（失败只告警，不阻断）
m='/opt/her/her-mind.mjs'
shutil.copy2(m, m+'.pre-ledgersync-'+time.strftime('%Y%m%d-%H%M%S'))
t=open(m,encoding='utf-8').read()
a="  // ⑥ 反思（每 6 步一次）"
assert a in t
ins=("  // ④b 记账同步（2026-11-11）：账本从 brain-usage 按天 upsert；失败只告警，不阻断主流程"+NL+
     "  if (!IS_DRY) {"+NL+
     "    try {"+NL+
     "      execFileSync(process.execPath, [HOME + '/her-ledger.mjs', 'sync'], { cwd: HOME, encoding: 'utf8', timeout: 30000 })"+NL+
     "    } catch (e) {"+NL+
     "      try { notify('warn', 'ledger-sync', String(e.message).slice(0, 120)) } catch { }"+NL+
     "    }"+NL+
     "  }"+NL+NL)
t=t.replace(a, ins+a, 1)
open(m,'w',encoding='utf-8').write(t)
print('her-mind 挂上每日记账同步（try/catch）')
