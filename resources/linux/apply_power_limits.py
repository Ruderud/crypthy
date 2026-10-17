#!/usr/bin/env python3
# Crypthy GPU 전력 제한 적용 (systemd oneshot, root 로 실행).
# 사용자가 쓸 수 있는 JSON 은 데이터로만 읽는다: gpu 는 PCI bus id 형식, watts 는 100~1000 정수만.
# 실행 파일은 고정 경로의 nvidia-smi 만 쓰며 셸을 거치지 않는다.
import json
import os
import re
import shutil
import subprocess
import sys
import time

BUS_RE = re.compile(r"^[0-9A-Fa-f]{4,8}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-9A-Fa-f]$")
LOG = "/var/lib/crypthy/power-limit.log"
MAX_BYTES = 64 * 1024
MAX_ENTRIES = 16


def plan(raw: str):
    """JSON 문자열 → [(bus, watts)] 와 건너뛴 사유. 형식이 이상해도 내용은 로그에 남기지 않는다."""
    lines = []
    try:
        cfg = json.loads(raw)
    except ValueError:
        return [], ["error: config is not valid JSON"]
    limits = cfg.get("limits") if isinstance(cfg, dict) else None
    if not isinstance(limits, list):
        return [], ["error: config has no limits list"]
    out = []
    for item in limits[:MAX_ENTRIES]:
        gpu = item.get("gpu") if isinstance(item, dict) else None
        watts = item.get("watts") if isinstance(item, dict) else None
        if not isinstance(gpu, str) or not BUS_RE.match(gpu):
            lines.append("skip: invalid gpu id")
            continue
        if not isinstance(watts, int) or isinstance(watts, bool) or not 100 <= watts <= 1000:
            lines.append("skip %s: invalid watts" % gpu)
            continue
        out.append((gpu, watts))
    return out, lines


def main(argv):
    dry = "--dry-run" in argv
    args = [a for a in argv[1:] if a != "--dry-run"]
    if len(args) != 1:
        print("usage: apply_power_limits.py [--dry-run] <config.json>", file=sys.stderr)
        return 2
    lines = ["[%s] apply %s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), args[0])]
    try:
        with open(args[0], "r", encoding="utf-8") as f:
            raw = f.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("too large")
    except (OSError, ValueError):
        raw = None
        lines.append("error: cannot read config")
    entries, notes = plan(raw) if raw is not None else ([], [])
    lines += notes
    smi = shutil.which("nvidia-smi", path="/usr/bin:/bin:/usr/sbin:/sbin")
    for gpu, watts in entries:
        cmd = [smi or "nvidia-smi", "-i", gpu, "-pl", str(watts)]
        if dry:
            lines.append("plan: " + " ".join(cmd[1:]))
            continue
        if not smi:
            lines.append("error: nvidia-smi not found")
            break
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        lines.append("%s -> %d W (exit %d) %s" % (gpu, watts, r.returncode, (r.stdout + r.stderr).strip()[:500]))
    text = "\n".join(lines) + "\n"
    print(text, end="")
    if not dry:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(LOG, 0o644)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
