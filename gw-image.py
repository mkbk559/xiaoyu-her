#!/usr/bin/env python3
"""WSL 侧直连网关出图（给 daily-toon 用）。

之前 PowerShell 侧出图是主通道；这个脚本验证 WSL 也能直连 127.0.0.1:3065（镜像网络），
这样她每天自己跑整条流水线就不用回到 Windows 侧。

用法：
  python3 gw-image.py --ref <参考图.png> --prompt "..." --out <输出.png> [--size 720x1280]
  python3 gw-image.py --prompt "..." --out <输出.png>            # 不带参考图（纯文生图）
"""
import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path

KEY_FILE = Path("/opt/her/model.json")
API = "http://127.0.0.1:3065"


def load_key():
    cfg = json.loads(KEY_FILE.read_text(encoding="utf-8"))
    return cfg.get("apiKey") or cfg.get("key") or ""


def post(url, payload, key, timeout=280):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", help="参考图（角色一致性）")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="720x1280")
    ap.add_argument("--model", default="raccoon-image")
    a = ap.parse_args()

    payload = {"model": a.model, "prompt": a.prompt, "n": 1, "size": a.size}
    if a.ref:
        b64 = base64.b64encode(Path(a.ref).read_bytes()).decode()
        payload["images"] = [{"image_url": f"data:image/png;base64,{b64}"}]

    for attempt in range(3):
        try:
            url = f"{API}/v1/images/edits" if a.ref else f"{API}/v1/images/generations"
            j = post(url, payload, load_key())
            if j.get("data") and j["data"][0].get("b64_json"):
                Path(a.out).write_bytes(base64.b64decode(j["data"][0]["b64_json"]))
                print(json.dumps({"ok": True, "out": a.out, "kb": round(Path(a.out).stat().st_size / 1024)}))
                return
            if j.get("data") and j["data"][0].get("url"):
                urllib.request.urlretrieve(j["data"][0]["url"], a.out)
                print(json.dumps({"ok": True, "out": a.out, "via": "url"}))
                return
            print(json.dumps({"ok": False, "resp": json.dumps(j, ensure_ascii=False)[:200]}, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"ok": False, "err": str(e)[:160], "attempt": attempt + 1}, ensure_ascii=False))
    sys.exit(1)


if __name__ == "__main__":
    main()
