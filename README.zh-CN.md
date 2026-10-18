[English](README.md) | [한국어](README.ko.md) | **简体中文**

# Crypthy

> 名称由 crypto 与 smithy（铁匠铺）合成。

面向搭载 NVIDIA GPU 的 **Windows / Ubuntu（Linux）** PC 的托盘应用，集**挖矿币种中心 + PC 管理 + 挖矿量与收益查看**于一体。

![仪表盘（深色主题，模拟数据）](docs/screenshots/dashboard-dark.png)

<details><summary>浅色主题</summary>

![仪表盘（浅色主题，模拟数据）](docs/screenshots/dashboard-light.png)

</details>

截图是在模拟模式（`npm run start:mock`）下生成的合成数据。后续计划请参阅 [docs/ROADMAP.md](docs/ROADMAP.md)。

> **请先了解**
> - **不会安装或运行挖矿程序。** 选择币种后，只会推荐兼容的挖矿工具和官方仓库链接，挖矿程序需由用户自行安装并运行。Crypthy 负责监控正在运行的挖矿程序和 GPU，并展示收益。
> - **没有默认钱包，也没有应用抽成（dev fee）。** 钱包地址只用于查询矿池公开统计数据，请仅输入公开地址。
> - **遇到危险情况只会停止。** 出现风扇停转或过热等危险条件时，会停止正在运行的已知挖矿程序进程并发出通知。不会重新启动，且该行为可在设置中关闭。
> - **未进行代码签名。** 每个 [Releases](https://github.com/Ruderud/crypthy/releases) 都会附带 `SHA256SUMS.txt`，请核对下载文件的哈希值。
> - 挖矿需要支付电费，并会给 GPU 带来负担。根据币价和难度的不同，可能会出现亏损。安全监控只是辅助手段。

## 功能

### 币种中心

选择币种后会显示以下内容。
- 算法
- 在这台 PC 上检测到的 GPU 厂商（NVIDIA·AMD·Intel）
- 兼容挖矿工具的推荐排序，以及各工具的官方仓库链接·支持的 GPU·dev fee·备注

列表由仓库内的整理文件 [`catalog/catalog.json`](catalog/catalog.json) 维护。每个值都会保留来源 URL 和确认日期。未能确认的值标记为 **未确认（미확인）**，未能确认官方仓库的工具不提供链接。

推荐排序按以下顺序确定。
1. 与这台 PC 的 GPU 厂商兼容的工具
2. dev fee 的确认状态：已确认 → 来源不一致 → 未确认
3. 已确认 dev fee 较低的工具

截至 2026-10-17 的目录：

| 币种 | 工具 | GPU | dev fee | 仓库 |
|---|---|---|---|---|
| Pearl (PRL, pearlhash) | SRBMiner-MULTI | NVIDIA, AMD | 2% | [doktor83/SRBMiner-Multi](https://github.com/doktor83/SRBMiner-Multi) |
| | ForgeMiner | NVIDIA | 2% | [kryptex-miners-org/kryptex-miners](https://github.com/kryptex-miners-org/kryptex-miners)（分发方，开发者未确认） |
| | PeakMiner | NVIDIA | 3% | 同一分发方仓库 |
| | ARCMiner | Intel Arc | 未确认 | 无链接（未确认） |
| Quantus (QTC, Poseidon2/QPoW) | ForgeMiner | NVIDIA | 2% | 分发方仓库 |
| | PeakMiner | NVIDIA | 2% | 分发方仓库 |
| | SRBMiner-MULTI | NVIDIA, AMD, Intel | 来源不一致 (2.00% / 2.5%) | doktor83/SRBMiner-Multi |
| | quantus-miner（官方） | wgpu·CUDA | 未确认 | [Quantus-Network/quantus-miner](https://github.com/Quantus-Network/quantus-miner) |

### PC 管理

- **GPU 仪表盘**：每 2 秒读取一次 `nvidia-smi`，显示温度·风扇·功耗/上限·使用率。GPU 以 PCI bus id 识别。
- **安全监控**：请参阅下文“安全监控行为”。
- **功率限制**：按 GPU 设定 W 值。只需首次获得一次管理员授权，之后会自动重新应用（Windows：一次 UAC 注册计划任务，登录时应用 · Linux：一次管理员认证安装 systemd 服务，开机时应用）。应用本体以普通用户权限运行。
- **托盘常驻**：可在登录时启动（可选，默认关闭）。
- **本地状态 API**：只读，且仅限本机访问。
- **自动更新**：从 GitHub Releases 获取新版本。支持 Windows 安装版和 Linux AppImage，zip·deb 需手动更新。

### 图表

图表使用 [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)（Apache-2.0）绘制。

- **按 GPU 的时间序列**：以 1 分钟均值显示算力·温度·功耗。本地保存最近 3 天的数据，每个 GPU 最多 4,320 个点，最多记录 16 个 GPU。
- **币价**：CoinGecko 30 天价格（USD）。
- **每日挖矿量·净收益**：每日挖矿量用柱状图，净收益（韩元）用折线图绘制。净收益按当天收盘价换算，没有收盘价时使用当前价格。电费会被扣除。

### 主题

默认是交易所仪表盘风格的深色主题。使用黄色强调色、等宽数字显示，上涨为绿色、下跌为红色。可通过顶部按钮按深色 → 浅色 → 跟随系统的顺序切换。不使用任何特定交易所的 logo·名称·图标。

### 挖矿量·收益

收益分为**估算（추정）**和**确认（확정）**两种显示。

- **实时估算净收益（韩元/h）**：实测算力 × 矿池统计的预期挖矿量 × 币价，再减去实测 GPU 电费所得的值。
  - 算力从挖矿程序的统计 API 获取。目前支持 SRBMiner-MULTI（`--api-enable --api-port 21550`）。
  - 矿池统计包括全网算力、区块奖励·出块时间和手续费。目前仅支持 Kryptex，无需输入钱包也能查询。
  - 今日·本月的估算值，是把同一时段内的估算挖矿量和用电量一起累计后计算的。
- **矿池确认挖矿量·净收益**：以矿池公开 API 的累计值（未支付余额 + 已支付）为基准。
  - **矿池累计挖矿量**：包含启动应用之前已挖到的份额。
  - **确认净收益**：把矿池累计值增加的那部分挖矿量，与该增长发生期间消耗的电力，作为**同一区间**配对后计算。
  - 矿池余额按区块·结算单位断断续续地增加。因此配对区间不足 3 小时时，不显示金额，而显示「统计中」（집계 중）。这是为了避免刚启动应用或刚过零点时，只记录了电费而显示为负数。
- **币价**：从 CoinGecko 获取，并按设置中的汇率换算为韩元。
  - 查询失败时，使用最后一次正常的币价并标注时间。超过 30 分钟则显示为「过期币价」（지난 시세）。
  - 如果一次也没有获取到，则不计算净收益，显示「无币价」（시세 없음）。
- **从 0.3.1 及以下版本更新时**：账本会自动转换。
  - 保留矿池累计基准点。
  - 旧的每日数值因电力区间不匹配，不计入净收益计算，仅作为挖矿量显示。
- **按 GPU 的挖矿 vs 出租对比**（仅信息展示）：对比每个 GPU 的挖矿每小时净收益与出租净收益（标价 × 主机分成 − 出租期间电费）。在以下情况会发送重新评估通知。
  - 出租变得更划算时
  - 超过为各 GPU 设定的出租价格阈值时
  - 币价较基准价下跌达到一定比例以上时
- **Vast 出租价格**：无需登录，通过公开搜索（bundles）每 30 分钟查询一次同型号单卡的挂单。
  - 默认只使用经 Vast 认证的 **verified 挂单**。因为未认证·已取消认证的挂单集中在最低价一侧，会拉低中位数。
    - 例：2026-10-18 的 RTX 5090 按需挂单，全部计入时为 $0.699，只计入 verified 时为 $0.869。
  - 挂单类型可在按需和可中断（竞价）中二选一。地区可按国家代码过滤。
  - 低于同一 GPU DLPerf 中位数 80% 的挂单会被排除在计算之外。
  - 表格中同时显示中位数、下 25%、样本数和查询时间。样本少于 5 个时显示为「数据不足」（데이터 부족），不用于对比。
  - 对比和重新评估通知以经过此过滤的中位数为基准。填入按 GPU 的手动值时，以手动值优先。
  - 自己的主机挂单·出租收益这类需要登录的信息，在 v0.4.0 计划中（加密保存官方 API 密钥，参见 [ROADMAP](docs/ROADMAP.md)）。

## 不做的事

- 不下载、安装、运行或重启挖矿程序，也不生成挖矿程序运行参数。
- 不索取或保存钱包助记词·密码·令牌。
- 不修改 Windows Defender·防火墙等安全设置。
- 没有远程控制或写入 API。对外发出的请求仅限公开 API 查询。
  - CoinGecko 币价
  - Kryptex 矿池统计·公开钱包余额
  - Vast.ai 公开报价
  - GitHub Releases 更新检查

## 安装指南（Windows 10/11 x64，需要 NVIDIA 驱动）

1. 从 [Releases](https://github.com/Ruderud/crypthy/releases) 下载 `Crypthy-<버전>-setup-x64.exe`。这是安装版，支持自动更新。也提供免安装版 `Crypthy-<버전>-win-x64.zip`，但无法自动更新。
2. 将哈希值与同一发布版本中的 `SHA256SUMS.txt` 进行比对。
   ```powershell
   Get-FileHash .\Crypthy-0.2.0-setup-x64.exe -Algorithm SHA256
   ```
3. 由于应用未签名，可能会弹出 SmartScreen 警告。确认哈希无误后，点击 **更多信息 → 仍要运行**。在安装界面同意 MIT 许可证。
4. 安装按用户级别进行，不需要管理员权限。默认路径为 `%LOCALAPPDATA%\Programs\Crypthy`。

### Ubuntu（Linux）安装（x64，需要 NVIDIA 驱动 + nvidia-smi）— v0.3.0，未经真机验证

1. 从 [Releases](https://github.com/Ruderud/crypthy/releases) 下载文件。
   - `Crypthy-<버전>-linux-x86_64.AppImage`：支持自动更新。
   - `Crypthy-<버전>-linux-amd64.deb`：不支持自动更新。
2. 将哈希值与 `SHA256SUMS.txt` 进行比对。
   ```bash
   sha256sum -c SHA256SUMS.txt --ignore-missing
   ```
3. 运行。
   - AppImage：
     ```bash
     chmod +x Crypthy-*.AppImage && ./Crypthy-*.AppImage
     ```
     在 Ubuntu 22.04 及以上版本中，可能需要 `libfuse2` 软件包。
   - deb：
     ```bash
     sudo apt install ./Crypthy-*.deb
     ```
4. 托盘图标通过 Ubuntu 默认的 AppIndicator 显示。在其他桌面环境中，可能需要 AppIndicator 扩展。
5. 开启设置中的「登录时运行应用」（로그인 시 앱 실행）后，会创建 `~/.config/autostart/crypthy.desktop`。

### 首次设置

1. 在**币种中心（코인 허브）**中选择币种，进入推荐挖矿工具的仓库链接，**自行**安装挖矿程序。来源·哈希·dev fee 请在各仓库中再次确认。如果安全软件拦截了挖矿程序，是否设置例外由用户自行判断。
2. 在开启统计 API 的状态下运行挖矿程序。如果是 SRBMiner-MULTI，请加上 `--api-enable --api-port 21550`。如果修改了端口，也要把 **设置 → 挖矿程序 API 端口（설정 → 채굴기 API 포트）** 改成相同的值。
3. （可选）在 **首次设置 → 钱包·矿池（처음 설정 → 지갑·풀）** 中，输入在公开钱包地址后加上 `.矿工名` 的内容，并以 `host:port` 格式输入矿池。仅用于查询矿池公开统计数据。如果已有挖矿程序 bat 文件，可通过 **从现有 bat 导入（기존 bat에서 가져오기）** 读取 `--wallet`、`--pool` 的值。

应用界面目前仅支持韩语。

### 从 0.1.x 更新

- 钱包·矿池·功率限制·安全阈值·收益设置原样保留。
- 0.1.x 中与挖矿程序运行相关的设置（挖矿程序文件夹、GPU 选择·映射、同意记录）已不再使用，会被丢弃。
- 在 0.1.x 中被设为“安全排除”的 GPU，会延续为**安全暂停（안전 보류）**。
- 0.2.0 不会启动挖矿程序。0.1.x 启动的挖矿程序会继续运行，但此后的启动·重启需要自己操作。

## 安全监控行为

| 条件 | 动作 |
|---|---|
| 功耗 > 100W 且风扇 0% 持续 10 秒以上 | 该 GPU **安全暂停（안전 보류）** + 停止正在运行的已知挖矿程序 + critical 通知 |
| 温度 ≥ 85°C | 同上 |
| 挖矿中温度值连续 5 次（约 10 秒）缺失 | 同上 |
| 温度 ≥ 80°C | 警告（降至 77°C 以下后恢复监控） |

- **停止对象**
  - Windows：用 `taskkill` 停止在目录中已确认可执行文件名的挖矿程序（`SRBMiner-MULTI.exe`、`peakminer.exe`、`forge.exe`、`arc-miner.exe`），并通过 tasklist 确认确实已关闭。
  - Linux：在 `/proc` 中查找从发布压缩包中确认过名称的 `SRBMiner-MULTI`、`peakminer`、`forge`。发送 SIGTERM，3 秒后仍存活则发送 SIGKILL。为避免误伤同名的其他工具（例如 Foundry 的 `forge`），只以命令行中带有矿池·钱包·算法参数的进程为目标。
  - 可执行文件名未确认的工具（例如 quantus-miner）无法停止，只会发送通知。
- **绝不停止容器（Linux）**：只要符合以下任一项，就不视为挖矿程序，也不会停止。这是为了保护 Vast.ai 客户工作负载之类的容器。无法判定时按容器处理。
  - cgroup 路径中包含 docker / containerd / kubepods / podman / lxc 等
  - 与应用处于不同的 PID 命名空间，或无法读取命名空间
  - 祖先进程中有 containerd-shim / dockerd / runc / conmon 等
- **不是按 GPU 为单位**：停止以挖矿程序为单位，因此该挖矿程序使用的 GPU 会全部停止。Crypthy 不会修改挖矿程序参数后重新运行，所以无法只剔除某一个 GPU。
- **不会重启**：应用不会重新启动挖矿程序。
- **暂停保持**：暂停期间如果挖矿程序再次运行（任务计划程序·bat 等），会每隔 15 秒再次停止。暂停在应用重启·重新开机后依然保持，排除原因后点击 GPU 卡片上的 **解除暂停（보류 해제）** 即可解除。
- **没有挖矿程序时产生的暂停**：即使在没有挖矿程序的情况下出现危险条件（例如游戏时过热），也会触发暂停。这是保守的行为，之后启动挖矿程序时，在解除暂停之前都会被停止。
- **监控路径**：即使 nvidia-smi 失败，也会通过挖矿程序 API 的设备值（以 PCI bus 为准）继续监控。tasklist 失败时，会对所有已知名称尝试停止，无法确认时发送 critical 通知。如果仅通过 API 检测到一个不知道可执行文件名的挖矿程序，会提示无法停止。
- **进程名称匹配**：如果可执行文件名完全相同，其他程序也可能成为停止对象。例如名为 `forge.exe` 的其他应用就属于这种情况。
- **关闭自动停止**：关闭 **设置 → 危险条件下自动停止运行中的挖矿程序** 后，不再停止，只会重复发送 critical 通知。
- **停止失败**：以管理员权限运行的挖矿程序，非管理员的应用无法关闭。此时会收到 critical 通知，请在任务管理器中手动结束。
- **局限**：nvidia-smi 的 `fan.speed` 是驱动程序指示的目标转速（%），并非实际 RPM。即使风扇被物理卡住，也可能不显示为 0%，所以最终的安全保障是温度规则。

## 功率限制 — Linux（一次管理员认证）

1. 在 GPU 设置表中输入 W 值。然后点击 **安装功率限制服务（一次管理员认证）（전력 제한 서비스 설치 (관리자 인증 1회)）**，并在 `pkexec` 认证窗口中确认。随附的 `resources/linux/install-power-service.sh` 会以 root 身份执行以下操作。
   - 将 `/usr/local/lib/crypthy/apply_power_limits.py` 复制过去，所有者为 root，权限为 0755。
   - 创建 systemd 服务 `crypthy-power-limit.service`（oneshot）。开机时应用，并启用 `ProtectSystem=strict` 等保护选项。
   - 创建 polkit 规则 `/etc/polkit-1/rules.d/50-crypthy-power-limit.rules`。**仅允许此用户** **启动此服务**。
2. 之后修改数值时，点击 **立即应用功率限制（전력 제한 지금 적용）**。应用只会向 `~/.config/Crypthy/power-limits.json` 写入 PCI bus id 和 W，并执行 `systemctl start crypthy-power-limit.service`。
   - 在不支持 polkit JS 规则的旧版本（例如 Ubuntu 22.04 的 polkit 0.105）中，每次应用都会弹出 `pkexec` 认证窗口。
3. 结果请在 `/var/lib/crypthy/power-limit.log` 中查看。

安全原则与 Windows 相同。
- 执行脚本归 root 所有。用户可写入的 JSON 只会作为数据读取。
- 数值只接受 PCI bus id 格式和 100~1000 之间的整数，最多处理 16 个。
- 可执行文件只使用固定路径的 nvidia-smi，不经过 shell。
- 非 JSON 文件的内容不会写入日志。

移除：

```bash
sudo systemctl disable --now crypthy-power-limit.service
sudo rm -f /etc/systemd/system/crypthy-power-limit.service /etc/polkit-1/rules.d/50-crypthy-power-limit.rules
sudo rm -rf /usr/local/lib/crypthy /var/lib/crypthy
sudo systemctl daemon-reload
```

## 功率限制 — Windows（一次 UAC）

1. 在 **GPU 设置 · 功率限制（GPU 설정 · 전력 제한）** 表中输入各 GPU 的 W 值。必须在 nvidia-smi 给出的允许范围内，留空则不会触碰该 GPU。
2. 点击 **注册功率限制计划任务（一次 UAC）（전력 제한 예약 작업 등록 (UAC 1회)）** 并确认 UAC。以管理员权限运行的 `resources\ps\register-power-task.ps1` 会执行以下操作。
   - 新建 `C:\ProgramData\Crypthy\` 文件夹。
     - 如果已存在，则删除后重新创建。若是 junction/symlink，则不会跟随，直接中止。
     - 创建时一并附带权限：所有者 Administrators、阻止继承、Users 仅有读取·执行权限。
   - 将应用脚本复制到该文件夹。
   - 注册计划任务 `Crypthy-PowerLimit`。以当前用户、最高权限，在登录 30 秒后运行。
3. 之后修改数值时，点击 **立即应用功率限制**。应用只会向 `%APPDATA%\Crypthy\power-limits.json` 写入 PCI bus id 和 W，并通过 `schtasks /run` 运行计划任务。
4. 结果请在表格下方的日志（`C:\ProgramData\Crypthy\power-limit.log`）中查看。

安全备注：
- 计划任务只会把 JSON 当作数据读取。只接受 PCI bus id 格式和 100~1000 的整数，并传给 `C:\Windows\System32\nvidia-smi.exe -i <bus id> -pl <W>`。
- 注册脚本的原件位于安装文件夹（用户可写入）中。请仅在可信的安装包上进行注册。

移除（管理员 PowerShell）：

```powershell
schtasks /delete /tn Crypthy-PowerLimit /f
Remove-Item -Recurse C:\ProgramData\Crypthy
```

## 自动更新

- **检查时机**：在 Windows 安装版（NSIS）和 Linux AppImage 上生效。zip·deb 需手动更新。
  - 应用窗口出现后几秒内检查一次，之后每 1 小时检查一次。
  - 检查周期可在 **设置 → 更新检查周期（설정 → 업데이트 확인 주기）** 中调整为 30 分钟~24 小时之间。
  - 也可以通过应用顶部和托盘菜单中的 **检查更新（업데이트 확인）** 立即检查。
- **发现新版本**：应用顶部横幅和系统通知会同时出现。即使只在托盘中运行，也会收到系统通知，点击通知会打开窗口。可在横幅上选择：
  - 显示新版本号和发布说明摘要，可选择 **下载 / 稍后（받기 / 나중에）**。
  - 点击 **下载** 会在后台下载并显示进度。
  - 下载完成后会再次提示。此时可选择 **立即重启并安装 / 稍后（지금 재시작해 설치 / 나중에）**。
- **稍后**：同一版本的同一提示，在下一次定期检查之前不会再次弹出。手动检查时会立即再次显示。
- **安装**：仅在点击 **立即重启并安装** 时才会安装，不会强制重启，也不会在退出时自动安装。
  - Crypthy 不管理挖矿程序，所以重启后挖矿仍会继续。
  - 重启的几秒到几十秒内，只有安全监控会短暂停止。
- **校验**：下载的文件通过 `latest.yml`（Windows）或 `latest-linux.yml`（Linux）中的 sha512 进行校验。
  - 由于没有代码签名，签名校验（`verifyUpdateCodeSignature`）处于关闭状态。
  - 因此该校验只能保证下载的文件与上传到 GitHub Releases 的文件一致。
- **失败也安全**：即使更新失败，也只会留下通知，不会影响安全监控。
- **发布说明**：由 Release 工作流根据上一个标签之后的提交标题自动生成。
- **用模拟模式确认**：以 `CRYPTHY_MOCK=1 CRYPTHY_MOCK_UPDATE=1` 运行，可通过假更新确认提示流程。

## 本地状态 API

`GET http://127.0.0.1:47321/v1/status`

```json
{
  "ts": 1792238907285,
  "miner": { "running": true, "mode": "external", "pool": "prl.kryptex.network:8048", "uptime_s": 14, "accepted": 8, "rejected": 0 },
  "gpus": [
    { "index": 0, "name": "NVIDIA GeForce RTX 5090", "temp_c": 63, "fan_pct": 70, "power_w": 581, "power_limit_w": 600, "util_pct": 100, "hashrate": 352793011501620 }
  ],
  "alerts": [ { "ts": 1792238891651, "level": "critical", "code": "miner_killed", "gpu": null, "message": "..." } ]
}
```

- **访问限制**：只绑定 `127.0.0.1`。
  - 如果 Host 头不是 `127.0.0.1:47321` 或 `localhost:47321`，则返回 403（阻止 DNS rebinding）。
  - 非 GET 请求返回 405，其他路径返回 404。
- **响应大小上限**：gpus 8 个，alerts 20 个（按最新排序），字符串 120 字符。响应中不包含钱包·设置。
- **字段取值**
  - `mode`：`external`（挖矿程序运行中。Crypthy 不运行挖矿程序，所以始终是此值） | `null`（没有挖矿程序）
  - `hashrate`：H/s
  - alert `gpu`：PCI bus id
- **alert code 列表**
  - 安全：`fan_stopped`、`temp_stop`、`temp_warn`、`telemetry_lost`、`miner_killed`、`miner_killed_again`、`kill_failed`、`safety_hold_running`、`hold_cleared`
  - 重新评估：`review_rental_price`、`review_rental_better`、`review_prl`
  - 更新：`update_available`、`update_ready`、`update_error`
  - 其他：`status_api`

## 文件位置

| 文件 | 路径 |
|---|---|
| 设置 | Windows `%APPDATA%\Crypthy\settings.json` · Linux `~/.config/Crypthy/settings.json` |
| 安全暂停 | `%APPDATA%\Crypthy\runtime.json` |
| 日/月账本 | `%APPDATA%\Crypthy\ledger.json` |
| 图表记录（最近 3 天） | `%APPDATA%\Crypthy\history.json` |
| 功率限制值 | `%APPDATA%\Crypthy\power-limits.json` |
| 功率限制脚本·日志 | `C:\ProgramData\Crypthy\` |

## 开发

```bash
npm install
npm test             # unit tests (vitest)
npm run typecheck
npm run check:readme # README.md / README.ko.md / README.zh-CN.md structure in sync
npm run start:mock   # UI with mock hardware (works on macOS/Linux)
npm run dist:win     # Windows x64 NSIS + zip + latest.yml + SHA256SUMS (no upload)
npm run dist:linux   # Linux x64 AppImage + deb + latest-linux.yml (builds on macOS too)
```

模拟模式选项：
- `CRYPTHY_MOCK_FANSTOP=<nvidia-smi 번호>`：30 秒后该 GPU 的风扇变为 0%。
- `CRYPTHY_MOCK_KILLFAIL=1`：重现挖矿程序停止失败的情况。
- `CRYPTHY_MOCK_IDLE=1`：以没有挖矿程序的状态启动。
- `CRYPTHY_MOCK_UPDATE=1`：通过假更新（v0.9.9）确认更新提示流程。

修改目录时：
- 在 `catalog/catalog.json` 中保留来源 URL 和确认日期。
- 测试会强制要求以下几点。
  - 已确认的 dev fee 必须有来源。
  - 仓库链接只允许 GitHub 仓库。
  - 未确认的工具不放链接。

新的挖矿程序统计 API，请以适配器的形式添加到 `src/main/minerApi.ts` 的 `MINER_APIS` 中。

`README.md`、`README.ko.md`、`README.zh-CN.md` 保持相同的结构。`npm run check:readme`（CI 中也会运行）负责比较结构。

### 发布（GitHub Actions）

- `CI`：每次 push（main）和 PR 时，用 ubuntu·windows 矩阵运行 typecheck 和单元测试。
- `Release`：push `v*` 标签后，在 windows-latest 上按顺序执行以下步骤。只使用 `GITHUB_TOKEN` 这一个密钥。
  1. 确认标签与 `package.json` 版本一致。
  2. 运行测试。
  3. 构建。
  4. Windows 任务上传安装文件、`.blockmap`、`latest.yml` 和 zip。
  5. 接着 Linux 任务上传 AppImage、`latest-linux.yml` 和 deb。
  6. 最后一个任务上传针对所有二进制文件的 `SHA256SUMS.txt`。

## 第三方软件声明

- **TradingView Lightweight Charts™**：5.2.1，Apache-2.0。Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
  - 按照许可证要求，保留图表内的 TradingView 标志链接（`attributionLogo`）。
  - 在应用底部标注来源。
  - 在软件包的 `resources/app.asar/dist/renderer/vendor/` 中一并分发 LICENSE 和 NOTICE。
  - 原文：[`resources/third-party/lightweight-charts-NOTICE.txt`](resources/third-party/lightweight-charts-NOTICE.txt)
- 其他运行时依赖：Electron（MIT）、electron-updater（MIT）

## License

[MIT](LICENSE) © 2026 Ruderud

挖矿工具（SRBMiner-MULTI 等）不包含在本仓库中，遵循各自的许可证和 dev fee 政策。
