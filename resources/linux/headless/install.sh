#!/bin/sh
# Crypthy 헤드리스 설치 (Ubuntu Server 등 화면 없는 Linux). root 로 1회 실행한다:
#   sudo ./install.sh [--user NAME] [--bind IP] [--port N] [--enable-write] [--accept-risk] [--power-limits] [--shared-ledger DIR]
#
#  - 앱 파일은 /opt/crypthy-headless (root 소유), 데이터·토큰은 /var/lib/crypthy-headless (실행 사용자만 읽기)
#  - systemd 시스템 유닛 crypthy-headless.service 를 지정한 사용자 권한으로 돌린다 (root 아님)
#  - 원격 API 는 기본 127.0.0.1. 다른 PC 에서 보려면 --bind 에 Tailscale IP 처럼 이 PC 의 특정 IP 를 준다
#  - --power-limits: GPU 전력 제한 서비스(crypthy-power-limit)도 설치 (pkexec 대신 지금 sudo 권한으로)
#  - 자동 업데이트는 없다. 새 버전은 같은 방법으로 다시 설치한다 (데이터는 유지)
set -eu

SRC=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
PREFIX=/opt/crypthy-headless
DATA=/var/lib/crypthy-headless
UNIT=crypthy-headless.service
RUN_USER="${SUDO_USER:-}"
BIND=127.0.0.1
PORT=47321
EXTRA=""
POWER=0
SHARED=""

while [ $# -gt 0 ]; do
  case "$1" in
    --user) RUN_USER="${2:-}"; shift 2 ;;
    --bind) BIND="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --enable-write) EXTRA="$EXTRA --enable-write"; shift ;;
    --accept-risk) EXTRA="$EXTRA --accept-risk"; shift ;;
    --power-limits) POWER=1; shift ;;
    --shared-ledger) SHARED="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then echo "run with sudo" >&2; exit 1; fi
case "$RUN_USER" in *[!a-z0-9_-]*|'') RUN_USER=root ;; esac
if ! printf '%s' "$RUN_USER" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || [ "$RUN_USER" = root ]; then
  echo "choose a normal user with --user NAME (not root)" >&2; exit 2
fi
id "$RUN_USER" >/dev/null 2>&1 || { echo "no such user: $RUN_USER" >&2; exit 2; }
# 유닛 파일에 들어가므로 IP·포트만 허용 (헤드리스가 다시 검사: 0.0.0.0 같은 전체 공개는 거부)
# grep 은 줄 단위라 줄바꿈이 섞인 값을 놓친다 → 문자열 전체를 case 로 검사
case "$BIND" in ''|*[!0-9a-fA-F:.]*) echo "--bind must be an IP address" >&2; exit 2 ;; esac
case "$PORT" in ''|*[!0-9]*) echo "--port must be a number" >&2; exit 2 ;; esac
[ "${#PORT}" -ge 4 ] && [ "${#PORT}" -le 5 ] || { echo "--port must be 1024-65535" >&2; exit 2; }
# 공유 장부 폴더 (듀얼부팅의 Windows 와 같은 PnL): 절대 경로, 유닛 파일에 들어가므로 안전한 문자만
if [ -n "$SHARED" ]; then
  case "$SHARED" in /*) ;; *) echo "--shared-ledger must be an absolute path" >&2; exit 2 ;; esac
  case "$SHARED" in *[!A-Za-z0-9._/@+-]*) echo "--shared-ledger: unsupported characters" >&2; exit 2 ;; esac
  EXTRA="$EXTRA --shared-ledger $SHARED"
fi

NODE=$(command -v node || true)
if [ -z "$NODE" ]; then echo "Node.js 18+ is required: sudo apt install nodejs" >&2; exit 1; fi
NODE_MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then echo "Node.js 18+ is required (found $("$NODE" -v))" >&2; exit 1; fi

for d in "$PREFIX" "$DATA"; do
  if [ -L "$d" ]; then echo "$d is a symlink, refusing" >&2; exit 1; fi
done

# 앱 파일: 이전 버전을 지우고 새로 복사 (데이터 폴더는 건드리지 않는다)
rm -rf "$PREFIX.new"
install -d -o root -g root -m 0755 "$PREFIX.new"
cp -R "$SRC/dist" "$SRC/package.json" "$SRC/LICENSE" "$SRC/resources" "$PREFIX.new/"
[ -f "$SRC/README-headless.md" ] && cp "$SRC/README-headless.md" "$PREFIX.new/"
chown -R root:root "$PREFIX.new"
chmod -R go-w "$PREFIX.new"
rm -rf "$PREFIX.old"
[ -d "$PREFIX" ] && mv "$PREFIX" "$PREFIX.old"
mv "$PREFIX.new" "$PREFIX"
rm -rf "$PREFIX.old"

install -d -o "$RUN_USER" -g "$(id -gn "$RUN_USER")" -m 0700 "$DATA"

# 같은 데이터 폴더로 실행하는 명령 (토큰 확인: crypthy-headless --print-tokens)
cat > /usr/local/bin/crypthy-headless <<WRAP_EOF
#!/bin/sh
exec "$NODE" $PREFIX/dist/main/headless.js --data-dir $DATA "\$@"
WRAP_EOF
chmod 0755 /usr/local/bin/crypthy-headless

UID_NUM=$(id -u "$RUN_USER")
cat > "/etc/systemd/system/$UNIT" <<UNIT_EOF
[Unit]
Description=Crypthy headless (GPU monitor, safety stop, remote API)
After=network-online.target nvidia-persistenced.service tailscaled.service
Wants=network-online.target

[Service]
User=$RUN_USER
ExecStart=$NODE $PREFIX/dist/main/headless.js --data-dir $DATA --bind $BIND --port $PORT$EXTRA
# systemd --user 유닛으로 채굴기를 켜고 끌 때 사용자 버스 (loginctl enable-linger $RUN_USER 필요)
Environment=XDG_RUNTIME_DIR=/run/user/$UID_NUM
Restart=on-failure
RestartSec=10
NoNewPrivileges=yes
ProtectSystem=full
ReadWritePaths=$DATA${SHARED:+ $SHARED}
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT_EOF
chmod 0644 "/etc/systemd/system/$UNIT"

if [ "$POWER" -eq 1 ]; then
  sh "$PREFIX/resources/linux/install-power-service.sh" "$DATA/power-limits.json" "$RUN_USER"
fi

systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"

echo "Crypthy headless installed: $PREFIX (data $DATA, user $RUN_USER)"
echo "  status:  systemctl status $UNIT   logs: journalctl -u $UNIT -f"
echo "  remote API: http://$BIND:$PORT   tokens: sudo -u $RUN_USER crypthy-headless --print-tokens"
