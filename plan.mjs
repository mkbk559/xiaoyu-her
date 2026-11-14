/**
 * 她的一天：**唯一**的日程与配额来源（her-world.mjs 从这里派生；day.mjs 已归档，别再散着写）
 *
 * ⚠️ 这份表原来是我猜的（3 点睡/11 点起/20:30 赶稿高峰），
 *    2026-11-09 用户指出"你把她的生活固定死了，没问她的意见"——确实。
 *    现在这份是**按她自己的口述**重写的：
 *      「一点半前后睡，九点起。上午十点到十二点干活最猛，晚上十点往后就只想瘫着，谁也别理。」
 *    → 她说什么就按什么排；以后她想改，改这里（或走 quiet.mjs 那套让她自己提意见）。
 *
 *   node plan.mjs            看她的一天长什么样
 *   node plan.mjs now        现在这个点该干嘛
 */

export const SLOTS = [
  // —— 以下时段来自她 2026-11-09 的口述 ——
  { from: '01:30', to: '09:00', code: 'sleep', kind: 'sleep', label: '睡觉（她说一点半前后睡）', money: false, learn: false },
  { from: '09:00', to: '10:00', code: 'wake', kind: 'life', label: '起床、喂猫、吃口东西', money: false, learn: false },
  // 2026-11-10 用户定调：「我还是觉得自媒体作为她的主业最靠谱」
  //   → 上午最猛的两小时先归"做今天的内容"，不是"找活"
  { from: '10:00', to: '12:00', code: 'work', kind: 'work', label: '做今天的内容（写/剪/拍）', money: false, learn: false, content: true },
  { from: '12:00', to: '13:30', code: 'eat', kind: 'life', label: '吃饭、歇会儿', money: false, learn: false },
  // 下午：接着做内容 + 学点东西；找活/报价降成"顺手看看"，不再是主线
  { from: '13:30', to: '18:00', code: 'work2', kind: 'work', label: '接着做内容，或者学点东西', money: true, learn: true, content: true },
  { from: '18:00', to: '19:00', code: 'out', kind: 'out', label: '出门：买菜、取快递、透口气', money: false, learn: false },
  { from: '19:00', to: '22:00', code: 'evening', kind: 'life', label: '吃饭、看剧、跟人聊两句', money: false, learn: false },
  // 「晚上十点往后就只想瘫着，谁也别理」—— 她自己划的线，不主动说话、不干活
  { from: '22:00', to: '22:30', code: 'rest', kind: 'rest', label: '瘫着，谁也不理（她说的）', money: false, learn: false, quiet: true },
  { from: '22:30', to: '23:30', code: 'novel', kind: 'write', label: '写小说（她要的：猫随时来）', money: false, learn: false, quiet: true },
  { from: '23:30', to: '01:30', code: 'rest', kind: 'rest', label: '瘫着，谁也不理（她说的）', money: false, learn: false, quiet: true },
]

/** 每天每件事的上限（写死，别再散落） */
export const QUOTAS = {
  // 2026-11-10 用户定调「自媒体是主业」→ 配额重心从"接单"挪到"做内容"
  contentSessions: 1,  // 每天做一条内容（视频/长文）——这才是她的主业
  publishAttempts: 2,  // 每天最多试发 2 次（发不出去也别死磕）
  moneyTalk: 1,        // 钱话降到 1 条（不再是每天的主题）
  quotes: 1,           // 报价降到 1 次（顺手看看，不撒网）
  lifeTalk: 8,         // 生活话最多 8 条（再多就成刷屏）
  learnSessions: 3,    // 学习提到 3 轮——学的是"怎么做内容"，不是"怎么接单"
  proactiveMaxPerDay: 4, // 主动开口日上限（桥与内核都读这一条）
  comments: 8,         // 自己发评论（policy 里也有，这里只做展示）
  deliveries: 1,       // 交付降到 1 次
}

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

export function slotAt(date = new Date(Date.now() + 8 * 3600 * 1000)) {
  const m = date.getUTCHours() * 60 + date.getUTCMinutes()
  for (const s of SLOTS) {
    const a = toMin(s.from), b = toMin(s.to)
    if (a <= b ? (m >= a && m < b) : (m >= a || m < b)) return s
  }
  return SLOTS[0]
}

export function printDay() {
  const now = slotAt()
  console.log('她的一天（当前时段标 ▶）\n')
  for (const s of SLOTS) {
    const mark = s === now ? '▶' : ' '
    const tags = [s.content ? '做内容' : '', s.money ? '顺带看活' : '', s.learn ? '可学习' : ''].filter(Boolean).join(' ')
    console.log(`${mark} ${s.from}–${s.to}  ${s.label}${tags ? '   [' + tags + ']' : ''}`)
  }
  console.log('\n每天上限：' + Object.entries(QUOTAS).map(([k, v]) => `${k} ${v}`).join(' · '))
  console.log(`现在：${now.from}–${now.to}「${now.label}」 做内容=${now.content ? '是' : '否'} 看活=${now.money ? '是' : '否'} 学习=${now.learn ? '是' : '否'}`)
  console.log('主业：自媒体（2026-11-10 用户定调）· 接单只是顺带看看')
}

if (String(process.argv[1] || '').endsWith('plan.mjs')) {
  const cmd = process.argv[2]
  if (cmd === 'now') console.log(JSON.stringify(slotAt(), null, 2))
  else printDay()
}
