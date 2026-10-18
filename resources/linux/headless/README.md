# Crypthy headless

Runs Crypthy's monitor, safety stop and profit tracking without a screen (for example on Ubuntu Server
used as a Vast.ai host). Another Crypthy (Windows, Linux desktop or macOS) connects over a private
network such as Tailscale and shows the same dashboard.

Requirements: Linux with NVIDIA drivers (`nvidia-smi`), Node.js 18 or newer (`sudo apt install nodejs`), systemd.

```sh
tar xzf crypthy-headless-<version>.tar.gz
cd crypthy-headless-<version>
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)"            # read-only remote screen
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)" --enable-write --accept-risk   # also allow remote start/stop
sudo -u "$USER" crypthy-headless --print-tokens                          # tokens for the other PC
```

- Data and tokens: `/var/lib/crypthy-headless` (owner only). App files: `/opt/crypthy-headless`.
- Service: `systemctl status crypthy-headless`, logs: `journalctl -u crypthy-headless -f`.
- The remote API listens on 127.0.0.1 unless `--bind` names a specific IP; it never listens on all addresses.
  Reading needs the read token; writing needs `--enable-write` and the separate write token.
- `--power-limits` also installs the GPU power-limit service (uses the same sudo, no pkexec prompt).
- To start a miner through a systemd user unit, enable lingering once: `sudo loginctl enable-linger "$USER"`.
- No automatic updates: download the new tarball and run `install.sh` again (data is kept).
- Containers (Docker, containerd, Vast.ai's `kaalia`) are never stopped by the safety watch.
