/**
 * 她的 GitHub MCP —— 让她自己搜 skill、读 skill、学 skill
 *
 *   node gh-skill.mjs search "<关键词>"       搜仓库（按 star 排序，返回名字+简介+星数）
 *   node gh-skill.mjs read <owner/repo> <path> 读仓库里的文件（默认 SKILL.md）
 *   node gh-skill.mjs learn <owner/repo>     把 SKILL.md 存进 knowledge/ 待学清单
 *   node gh-skill.mjs trending               看 skill 生态最近什么火（awesome 列表）
 *
 * 匿名 API 限速 10 次/分钟，够她用；返回 JSON，她的脑子能直接读。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const HOME = '/opt/her'
const API = 'https://api.github.com'
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/** 匿名 GitHub API（WSL 直连；curl 走 --noproxy） */
function gh(path) {
  const out = execFileSync('curl', ['-s', '--noproxy', '*', '--max-time', '30',
    '-H', 'Accept: application/vnd.github+json',
    `${API}${path}`], { encoding: 'utf8', timeout: 40000 })
  return JSON.parse(out)
}

/** raw.githubusercontent 直读文件 */
function raw(owner, repo, path, branch = 'main') {
  try {
    return execFileSync('curl', ['-s', '--noproxy', '*', '--max-time', '30', '-L',
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`], { encoding: 'utf8', timeout: 40000 })
  } catch { return '' }
}

export function search(q, n = 8) {
  const j = gh(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${n}`)
  return (j.items || []).map(r => ({
    full_name: r.full_name,
    stars: r.stargazers_count,
    desc: (r.description || '').slice(0, 150),
    default_branch: r.default_branch,
    updated: r.pushed_at?.slice(0, 10),
  }))
}

export function read(owner, repo, path = 'SKILL.md') {
  const j = gh(`/repos/${owner}/${repo}`)
  const branch = j.default_branch || 'main'
  const text = raw(owner, repo, path, branch)
  return { repo: `${owner}/${repo}`, branch, path, chars: text.length, text: text.slice(0, 30000) }
}

/** 把 skill 存进她的知识库 + 加进课程表（先学再做由 daily-toon 检查） */
export function learn(owner, repo) {
  const r = read(owner, repo, 'SKILL.md')
  if (!r.chars) return { error: '读不到 SKILL.md' }
  mkdirSync(`${HOME}/knowledge`, { recursive: true })
  const file = `${HOME}/knowledge/skill-${owner}-${repo.replace('/', '-')}.md`
  writeFileSync(file, `# skill: ${owner}/${repo}\n_${stamp()}_\n\n${r.text}\n`)
  appendFileSync(`${HOME}/learn-todo.jsonl`, JSON.stringify({
    at: stamp(),
    topic: `skill：${owner}/${repo}`,
    why: '出片前要学的技能（2026-11-10 用户要求：先学习再做）',
    file, weight: 3, status: 'todo',
  }) + '\n')
  return { ok: true, file, chars: r.chars, queued: `skill：${owner}/${repo}` }
}

const cmd = process.argv[2]
if (String(process.argv[1] || '').endsWith('gh-skill.mjs')) {
  if (cmd === 'search') console.log(JSON.stringify(search(process.argv[3] || 'claude skill', Number(process.argv[4]) || 8), null, 1))
  else if (cmd === 'read') console.log(JSON.stringify(read(process.argv[3], process.argv[4], process.argv[5] || 'SKILL.md'), null, 1).slice(0, 6000))
  else if (cmd === 'learn') console.log(JSON.stringify(learn(process.argv[3], process.argv[4]), null, 1))
  else console.log('用法: search "<词>" [n] | read <owner> <repo> [path] | learn <owner> <repo>')
}
