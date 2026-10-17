#!/bin/sh
# pkexec 로 root 권한 1회 실행: 전력 제한 systemd oneshot 서비스와 polkit 규칙을 설치한다.
# usage: install-power-service.sh <config.json 절대 경로> <사용자 이름>
#  - 실행 스크립트는 root 소유(/usr/local/lib/crypthy) 로 복사한다. 사용자가 쓸 수 있는 파일은 데이터(JSON)뿐
#  - polkit 규칙은 해당 사용자가 이 서비스 하나를 "start" 하는 것만 허용
set -eu

CONFIG="${1:-}"
USER_NAME="${2:-}"
SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNIT=crypthy-power-limit.service
LIB=/usr/local/lib/crypthy

case "$CONFIG" in
  /*) ;;
  *) echo "config path must be absolute" >&2; exit 2 ;;
esac
# systemd 유닛·polkit 규칙에 들어가므로 안전한 문자만 허용
if ! printf '%s' "$CONFIG" | grep -Eq '^/[A-Za-z0-9._/@+-]+$'; then echo "unsupported characters in config path" >&2; exit 2; fi
if ! printf '%s' "$USER_NAME" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$'; then echo "invalid user name" >&2; exit 2; fi
if [ "$(id -u)" -ne 0 ]; then echo "must run as root (pkexec)" >&2; exit 1; fi

for d in "$LIB" /var/lib/crypthy; do
  if [ -L "$d" ]; then echo "$d is a symlink, refusing" >&2; exit 1; fi
done
install -d -o root -g root -m 0755 "$LIB" /var/lib/crypthy
install -o root -g root -m 0755 "$SRC_DIR/apply_power_limits.py" "$LIB/apply_power_limits.py"

cat > "/etc/systemd/system/$UNIT" <<UNIT_EOF
[Unit]
Description=Crypthy GPU power limits
After=systemd-modules-load.service nvidia-persistenced.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $LIB/apply_power_limits.py $CONFIG
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/crypthy
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT_EOF
chmod 0644 "/etc/systemd/system/$UNIT"

install -d -m 0755 /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/50-crypthy-power-limit.rules <<RULE_EOF
// Crypthy: $USER_NAME 이 crypthy-power-limit.service 를 start 하는 것만 허용
polkit.addRule(function (action, subject) {
  if (action.id == "org.freedesktop.systemd1.manage-units" &&
      action.lookup("unit") == "$UNIT" &&
      action.lookup("verb") == "start" &&
      subject.user == "$USER_NAME") {
    return polkit.Result.YES;
  }
});
RULE_EOF
chmod 0644 /etc/polkit-1/rules.d/50-crypthy-power-limit.rules

systemctl daemon-reload
systemctl enable "$UNIT"
systemctl start "$UNIT"
