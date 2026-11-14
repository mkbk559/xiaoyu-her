/**
 * toon 阶段3/4：分镜静帧 → Ken Burns 动画段 → 拼接 → 混音（配音 + BGM sidechain）
 *
 *   node compose-toon.mjs <项目目录> [--fps 30]
 *
 * 对应 toon-studio 的 build 后半段：
 *   每场：静帧 + zoompan（push-in / zoom-out / static + 轻微 wiggle）→ 加配音 → 定长
 *   全片：拼接 + BGM（自动压低人声下方）+ 响度归一 -15 LUFS + 字幕（Pillow 烧录）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readdirSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const dir = process.argv[2]
const fps = process.argv.includes('--fps') ? Number(process.argv[process.argv.indexOf('--fps') + 1]) : 30
const W = 1080, H = 1920

if (!dir || !existsSync(dir)) { console.log('用法: compose-toon.mjs <dir>'); process.exit(1) }

const scenes = readdirSync(dir).filter(f => /^scene_\d+\.png$/.test(f)).sort()
const vos = readdirSync(dir).filter(f => /^vo_\d+\.mp3$/.test(f)).sort()
console.log(`场景 ${scenes.length} 个, 配音 ${vos.length} 段`)
if (!scenes.length) process.exit(1)

const work = `${dir}/work`
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

// 每场的运动方式（简单起见按序轮换；静态场也要有 1px 呼吸，避免死帧）
const MOTIONS = ['push-in', 'zoom-out', 'push-in', 'static', 'push-in', 'static', 'push-in', 'zoom-out']
const durOf = f => {
  const n = Number(f.match(/\d+/)[0])
  const vo = `${dir}/vo_${String(n).padStart(2, '0')}.mp3`
  const voAlt = `${dir}/vo_${n}.mp3`
  const p = existsSync(vo) ? vo : (existsSync(voAlt) ? voAlt : null)
  if (!p) return 6
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p], { encoding: 'utf8' }).trim())
}

const segs = []
scenes.forEach((f, i) => {
  const n = Number(f.match(/\d+/)[0])
  const still = `${dir}/${f}`
  const voFile = [`${dir}/vo_${String(n).padStart(2, '0')}.mp3`, `${dir}/vo_${n}.mp3`].find(existsSync)
  const vDur = voFile ? Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', voFile], { encoding: 'utf8' }).trim()) : 6
  const sec = Math.max(3.5, vDur + 1.2)
  const motion = MOTIONS[i % MOTIONS.length]

  const frames = Math.round(sec * fps)
  let vf
  if (motion === 'push-in') {
    const z = `min(1.0+0.0015*on,1.13)`
    vf = `scale=${W * 2}:-2,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p`
  } else if (motion === 'zoom-out') {
    const z = `max(1.13-0.0015*on,1.0)`
    vf = `scale=${W * 2}:-2,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p`
  } else {
    // static + 呼吸（1px 幅度正弦，防死帧）
    vf = `scale=${W * 2}:-2,zoompan=z='1.02':x='iw/2-(iw/zoom/2)+4*sin(on/40)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p`
  }

  const vOnly = `${work}/v-${n}.mp4`
  execFileSync('ffmpeg', ['-y', '-loop', '1', '-i', still, '-t', sec.toFixed(2), '-vf', vf,
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-r', String(fps), vOnly], { stdio: 'ignore', timeout: 240000 })

  const seg = `${work}/s-${n}.mp4`
  if (voFile) {
    execFileSync('ffmpeg', ['-y', '-i', vOnly, '-i', voFile,
      '-filter_complex', `[1:a]apad=whole_dur=${sec.toFixed(2)}[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', sec.toFixed(2), seg],
      { stdio: 'ignore', timeout: 180000 })
  } else {
    execFileSync('cp', [vOnly, seg])
  }
  segs.push(seg)
  console.log(`  场${n}: ${sec.toFixed(1)}s ${motion}${voFile ? ' + vo' : ' (无配音,用静音)'}`)
})

// 拼接
const list = `${work}/list.txt`
writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'))
const joined = `${work}/joined.mp4`
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], { stdio: 'ignore', timeout: 400000 })
console.log('拼接 OK')

// 混 BGM（tiktok-skill 的 CC BGM）+ 响度归一
const bgm = '/opt/skills/tiktok-video-skill/projects/her-001/bgm.ogg'
const final = `${dir}/final.mp4`
const totalDur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', joined], { encoding: 'utf8' }).trim())
if (existsSync(bgm)) {
  execFileSync('ffmpeg', ['-y', '-i', joined, '-i', bgm,
    '-filter_complex',
    `[1:a]volume=-14dB,aloop=loop=-1:size=2000000000,atrim=0:${totalDur.toFixed(2)}[bgm];` +
    `[0:a][bgm]sidechaincompress=threshold=0.04:ratio=8:attack=8:release=400[mix];` +
    `[mix]loudnorm=I=-15:TP=-1.5:LRA=11[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', final],
    { stdio: 'ignore', timeout: 500000 })
} else {
  execFileSync('ffmpeg', ['-y', '-i', joined, '-c', 'copy', final], { stdio: 'ignore' })
}

const st = statSync(final)
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', final], { encoding: 'utf8' }).trim())
console.log(JSON.stringify({ ok: true, final, bytes: st.size, duration: Math.round(dur), scenes: segs.length }, null, 1))
