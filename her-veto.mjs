/**
 * 第三份验证集 her-veto.mjs（2026-11-10）
 *
 * 问题：我先用训练集调参（20/20），又用留出集调参（20/20）。
 * 两份都被污染了。严格验收需要**完全没碰过的第三份**。
 *
 * 这 20 段是刚刚写的，从没参与过任何调参。
 * 验收时跑这个，才是真准确率。
 *
 *   node her-veto.mjs
 */
import { detectWater } from '/opt/her/her-contract.mjs'

/** 第三份：验收专用，不许用来调参 */
export const VETO_GOOD = [
  '出租屋的热水器又坏了。我拿盆接水擦身子，擦到一半水凉了。骂了句草，接着擦。',
  '甲方发来消息说「在吗」。我隔了二十分钟才回。他发了个文件，说改一下。',
  '小鱼的猫砂盆该挪位置了。它总在门口拉，我踩过三次。挪到阳台，它照样。',
  '这个月的电费一百七。我算了三遍，确认没算错。去年这时候才一百二。',
  '我把写到一半的段落念出声。念到第三句自己就笑了，太假。删了重写。',
  '楼下小卖部的老板娘问我怎么老不吃早饭。我说习惯了。她塞了个茶叶蛋给我。',
  '手机里存着两百多个表情包。真正用的就那五个。剩下的是攒着。',
  '接了个急单，熬到两点。做完甲方说再看看。我知道「再看看」是什么意思。',
  '今天没接单。把屋子扫了一遍，拖了地，洗了床单。晚上躺下，觉得值了。',
  '写陈默的时候我想，这人为什么要退两分钟。想了半天，想明白是因为不甘心。',
]

export const VETO_WATER = [
  '他感到非常痛苦。他感到十分痛苦。他感到极其痛苦。他感到无比痛苦。',
  '天空很蓝。天空非常蓝。天空特别蓝。天空格外蓝。天空异常蓝。',
  '我一遍遍地想着。我一遍遍地念着。我一遍遍地念着她。我一遍遍地想。',
  '她哭了。她大声地哭。她不停地哭。她一直哭。她哭个不停。她哭得厉害。',
  '时间一分一秒地过去。时间一分一秒地流逝。时间一分一秒地走。',
  '他站在门口。他一直站在门口。他久久站在门口。他始终站在门口。',
  '这是一件重要的事。这是一件十分重要的事。这是一件极其重要的事。',
  '雨下得很大。雨下得非常大。雨下得特别大。雨下得格外大。雨很大。',
  '我的心很痛。我的心好痛。我的心真的很痛。我的心痛得不行。',
  '路很长。路特别长。路非常长。路真的很长。路长得看不到头。',
]

const rows = []
for (const t of VETO_GOOD) {
  const r = detectWater(t)
  rows.push({ text: t.slice(0, 20), expect: 'pass', ok: r.ok === true, problems: r.problems })
}
for (const t of VETO_WATER) {
  const r = detectWater(t)
  rows.push({ text: t.slice(0, 20), expect: 'fail', ok: r.ok === false, problems: r.problems })
}

const good = rows.filter(r => r.expect === 'pass' && r.ok).length
const water = rows.filter(r => r.expect === 'fail' && r.ok).length
const missed = rows.filter(r => !r.ok)

console.log('════ 第三份验证集（从未参与调参）════')
console.log(`  正常样本通过: ${good}/${VETO_GOOD.length}`)
console.log(`  水字数抓到:   ${water}/${VETO_WATER.length}`)
console.log(`  总准确率:     ${good + water}/${rows.length}`)
if (missed.length) {
  console.log('\n  漏检/误报:')
  for (const m of missed) console.log(`    [期望${m.expect}] ${m.text}… ${m.problems?.join(';') || ''}`)
} else {
  console.log('\n  ✅ 全过')
}
