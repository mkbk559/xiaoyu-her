#!/bin/bash
# her-watchdog：每 5 分钟自检自愈（2026-11-11）
# 目的：彻底解决"锁死没人知道"
export PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
cd /opt/her

LOG=/var/log/her-watchdog.log
echo "[$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')] ── watchdog 开始 ──" >> $LOG

# ── 1. 服务存活 ──
for svc in aiji her-mind.timer; do   # QQ 通道已停用（2026-11-12）
  if [ "$(systemctl is-active $svc 2>/dev/null)" != "active" ]; then
    echo "  ⚠️ $svc 不 active，尝试重启" >> $LOG
    systemctl restart $svc 2>/dev/null
    sleep 3
    echo "     重启后: $(systemctl is-active $svc 2>/dev/null)" >> $LOG
  fi
done

# ── 2. QQ 连接（2026-11-11 改进）──
if systemctl is-active --quiet napcat; then   # QQ 通道已停用则跳过整段
# 原版：无连接就重启桥接。但实测 NapCat 在"网络已连接"后可能卡住不重连，
# 重启桥接也没用。而且重启 NapCat 可能掉 QQ 登录（要扫码）。
# 新策略：
#   - 无连接 < 10 分钟：只记录，不动（可能正在重连）
#   - 无连接 >= 10 分钟：重启桥接（轻量，不影响登录）
#   - 无连接 >= 30 分钟：重启 NapCat（重，可能掉登录），并写告警文件
QQCONN=$(ss -tn 2>/dev/null | grep ESTAB | grep -c 6199)
QQ_STATE=/opt/her/.qq-disconnect-since
if [ "$QQCONN" -eq 0 ]; then
  if [ ! -f "$QQ_STATE" ]; then
    date +%s > "$QQ_STATE"
    echo "  ⚠️ QQ 无连接（开始计时）" >> $LOG
  else
    SINCE=$(cat "$QQ_STATE" 2>/dev/null)
    NOW=$(date +%s)
    AGE_MIN=$(( (NOW - SINCE) / 60 ))
    echo "  ⚠️ QQ 无连接已 ${AGE_MIN} 分钟" >> $LOG
    if [ "$AGE_MIN" -ge 10 ] && [ "$AGE_MIN" -lt 30 ]; then
      # 2026-11-11 修：重启桥接对"NapCat 卡住不重连"无效（已验证）。
      # 只在第一次（10-11 分钟）重启一次，之后不再浪费。
      if [ "$AGE_MIN" -lt 12 ] && [ ! -f /opt/her/.qq-bridge-restarted ]; then
        echo "     → 重启桥接（仅一次）" >> $LOG
        systemctl restart herqq-bridge 2>/dev/null
        touch /opt/her/.qq-bridge-restarted
      fi
    elif [ "$AGE_MIN" -ge 30 ]; then
      # 2026-11-11 教训：重启 NapCat 会导致 QQ 掉登录要扫码。
      # 用户不在场时绝不能自动做。只写通知文件，等人工处理。
      if [ ! -f /opt/her/NOTIFY-QQ-DOWN.txt ]; then
        echo "     → 写 NOTIFY-QQ-DOWN.txt（不自动重启 NapCat，避免掉登录）" >> $LOG
        {
          echo "[$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')] QQ 已断开 ${AGE_MIN} 分钟"
          echo ""
          echo "不自动重启 NapCat 的原因：重启会掉 QQ 登录，需要扫码。"
          echo ""
          echo "恢复方法："
          echo "  1. 取最新二维码：cat /root/Napcat/opt/QQ/resources/app/app_launcher/napcat/cache/qrcode.png"
          echo "  2. 或让 Agent 取码给你扫"
          echo ""
          echo "注意：内核（写小说/做视频）不需要 QQ，不受影响。"
        } > /opt/her/NOTIFY-QQ-DOWN.txt
      fi
    fi
  fi
else
  if [ -f "$QQ_STATE" ]; then
    echo "  ✅ QQ 已恢复连接" >> $LOG
    rm -f "$QQ_STATE"
  fi
fi

fi
# ── 3. 僵尸进程 ──
BRIDGES=$(ps aux 2>/dev/null | grep "bridge.mjs" | grep -v grep | wc -l)
if [ "$BRIDGES" -gt 1 ]; then
  echo "  ⚠️ 有 $BRIDGES 个 bridge 进程（僵尸），清理" >> $LOG
  ps aux 2>/dev/null | grep "bridge.mjs" | grep -v grep | head -n -1 | awk '{print $2}' | xargs -r kill -9 2>/dev/null
fi

# ── 4. 暂停是否有理由 ──
if [ -f her-paused.json ]; then
  REASON=$(cat her-paused.json 2>/dev/null)
  echo "  ⚠️ 处于暂停: $REASON" >> $LOG

  # 检查暂停原因里的"连续失败"是否已经过时（trace 里最近 30 分钟没有连续 3 失败）
  python3 - <<'PYEOF' >> $LOG 2>&1
import json, os, time
try:
    paused = json.load(open("/opt/her/her-paused.json", encoding="utf-8"))
    if not paused.get("fatal"):
        print("     非 fatal，可自动恢复")
        os.remove("/opt/her/her-paused.json")
        raise SystemExit
    # 检查暂停时间距今
    at = paused.get("pausedAt", "")
    try:
        t = time.mktime(time.strptime(at, "%Y-%m-%d %H:%M:%S"))
        age_min = (time.time() - t) / 60
    except Exception:
        age_min = 0
    print("     暂停了 " + str(round(age_min)) + " 分钟")

    # 读 trace 看最近 30 分钟有没有连续 3 失败
    rows = []
    p = "/opt/her/her-trace.jsonl"
    if os.path.exists(p):
        for l in open(p, encoding="utf-8"):
            l = l.strip()
            if not l: continue
            try: r = json.loads(l)
            except: continue
            if r.get("kind") != "tick": continue
            note = str(r.get("note", ""))
            if note == "dry-run" or note.startswith("跳过") or r.get("sim"): continue
            rows.append(r)
    now = time.time()
    recent = []
    for r in rows:
        try:
            tt = time.mktime(time.strptime(str(r.get("at")), "%Y-%m-%d %H:%M:%S"))
        except Exception:
            continue
        if now - tt <= 1800:
            recent.append(r)
    last3 = recent[-3:]
    allfail = len(last3) == 3 and all(not r.get("ok") for r in last3)
    print("     最近30分钟失败记录: " + str(len(recent)) + " 条, 连续3失败=" + str(allfail))
    if not allfail:
        print("     → 连续失败条件已不成立，自动恢复")
        os.remove("/opt/her/her-paused.json")
        if os.path.exists("/opt/her/her-arbiter-state.json"):
            st = json.load(open("/opt/her/her-arbiter-state.json", encoding="utf-8"))
            st["pausedReason"] = None
            json.dump(st, open("/opt/her/her-arbiter-state.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
except Exception as e:
    print("     检查失败: " + str(e))
PYEOF
fi

# ── 5. 状态文件可解析 ──
python3 - <<'PYEOF' >> $LOG 2>&1
import json, os
for f in ["her-mind.json", "her-soul.json", "her-goals.json", "her-contract.json"]:
    p = "/opt/her/" + f
    if not os.path.exists(p):
        continue
    try:
        json.load(open(p, encoding="utf-8"))
    except Exception as e:
        print("  ❌ " + f + " 损坏: " + str(e))
        # 从快照恢复
        snaps = sorted([x for x in os.listdir("/opt/her/snapshots") if x.startswith("tick")]) if os.path.isdir("/opt/her/snapshots") else []
        if snaps:
            import shutil
            shutil.copy("/opt/her/snapshots/" + snaps[-1], p)
            print("     已从快照恢复: " + snaps[-1])
PYEOF

# ── 6. 磁盘 ──
DISK=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK" -gt 90 ]; then
  echo "  ⚠️ 磁盘 ${DISK}%，清理旧快照" >> $LOG
  ls -t snapshots/*.json 2>/dev/null | tail -n +11 | xargs -r rm -f 2>/dev/null
fi

echo "[$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')] ── watchdog 结束 ──" >> $LOG

# ── 7. tick 结果（原 night-watch 并入，2026-11-12）──
/usr/bin/python3 /opt/her/her-tick-check.py
