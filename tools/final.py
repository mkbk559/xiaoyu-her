import os,json,subprocess
H="/opt/her"
def sh(c): return subprocess.run(["bash","-lc",c],capture_output=True,text=True).stdout
print("== 脚本分类统计 ==")
mjs=[f for f in os.listdir(H) if f.endswith(".mjs")]
py=[f for f in os.listdir(H) if f.endswith(".py")]
shf=[f for f in os.listdir(H) if f.endswith(".sh")]
print("mjs",len(mjs),"py",len(py),"sh",len(shf))
print("mjs:",", ".join(sorted(mjs)))
print("py:",", ".join(sorted(py)))
print("sh:",", ".join(sorted(shf)))
print()
print("== 归档目录 ==")
print(sh("ls -la /opt/her/_archive/20261111-203331 2>/dev/null | head -20"))
print("== 残留文件 ==")
print(sh("ls -la /opt/her/.dry-* /opt/her/NOTIFY-QQ-DOWN.txt /opt/her/RUN-START.txt /opt/her/8 2>/dev/null"))
print("== 暂停/告警 ==")
print(sh("ls -la /opt/her/her-paused.json /opt/her/NOTIFY-FATAL.txt 2>/dev/null; echo ALERTS; tail -5 /opt/her/her-alerts.jsonl 2>/dev/null"))
print("== 备份情况 ==")
print(sh("ls -la /opt/her/backup* /root/backup* /opt/backup* 2>/dev/null | head; crontab -l | grep -i backup; systemctl list-timers --all --no-pager | grep -i backup"))
print("== night-watch.log ==")
print(sh("ls -la /opt/her/night-watch.log 2>/dev/null; tail -6 /opt/her/night-watch.log 2>/dev/null"))
print("== day.mjs 是否在任何地方被定时调用 ==")
print(sh("grep -rn 'day.mjs' /etc/systemd/system /etc/cron* /opt/her/*.sh 2>/dev/null | head"))
print("== 学习配额实现位置 ==")
print(sh("grep -n 'learnSessions\|contentSessions\|QUOTAS' /opt/her/*.mjs | head -20"))
print("== her-soul 人格锚点里怎么说话 5 条 ==")
print(sh("sed -n '30,60p' /opt/her/her-soul.mjs"))
