[English](README.md) | [한국어](README.ko.md) | **简体中文**

<p align="center"><img src="resources/icon.png" width="96" alt="Crypthy" /></p>

# Crypthy

面向搭载 NVIDIA GPU 的 **Windows 和 Ubuntu（Linux）** PC 的挖矿币种中心、GPU/PC 管理器和挖矿收益查看工具。

[![CI](https://github.com/Ruderud/crypthy/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruderud/crypthy/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Ruderud/crypthy)](https://github.com/Ruderud/crypthy/releases)
[![License: MIT](https://img.shields.io/github/license/Ruderud/crypthy)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-informational)](#download-and-install)

![仪表盘（深色主题，模拟数据）](docs/screenshots/dashboard-dark.png)

> **请先了解**
> - **Crypthy 不会下载或安装挖矿程序。** 它只推荐兼容的挖矿工具并附上官方仓库链接，挖矿程序需由用户自行安装和配置。之后可以在应用和托盘中启动、停止你配置好的挖矿程序（计划任务、systemd 用户单元或可执行文件）。
> - **没有默认钱包，也没有 dev fee。** 钱包地址只用于查询矿池公开统计数据。
> - **遇到危险情况只会停止。** 出现风扇停转或过热时，会停止正在运行的已知挖矿程序，且不会重新启动；该行为可以关闭。
> - **未进行代码签名。** 请使用每个发布版本中的 `SHA256SUMS.txt` 校验下载文件。
> - 挖矿需要支付电费，会给 GPU 带来负担，并可能亏损。安全监控只是辅助手段，不是保证。
>
> 详情：[安全与隐私](#safety-and-privacy)。

## 功能

### 界面布局（v0.6.0）

- **HUD** 固定在每个标签页顶部：挖矿状态（挖矿中 x/y GPU、已停止、安全暂停、已关闭但仍在挖矿）、**启动 / 停止**、实时净收益、今日净收益、币价及 24 小时涨跌、每个 GPU 的小卡片（温度、功耗、算力）、提醒，以及远程 / MOCK / 更新标记。窗口较窄（760~1000px）时 GPU 小卡片只保留温度。
- **标签页**：**仪表盘**（带挖矿开关的 GPU 卡片、矿池与钱包、自动卖出状态、最近提醒、最近 1 小时算力曲线）、**收益·账本**、**卖出·变现**、**挖矿程序**（统计、控制方式、挖矿程序输出）。
- **设置**以大面板打开，分为 7 个部分（挖矿程序、GPU·功耗、安全、收益计算、应用、远程连接、币种·挖矿程序列表）；每个部分单独保存，有改动时显示圆点，未保存就关闭时会先确认。无效的值显示在输入框下方并阻止保存。
- 简短输入以对话框打开：首次设置、自动卖出设置（高级选项折叠）、SafeTrade API 密钥、添加卖出记录、追溯补录、变现路径备忘。
- **图表**在单独的窗口中打开（一个窗口，4 个标签页），会记住大小、位置和最后的标签页；主窗口隐藏时仍保留；远程连接期间显示远程主机的数据。
- 托盘提示显示挖矿状态、实时净收益、今日净收益和 GPU 温度。

### 币种中心

- 选择币种后，会显示其算法、在这台 PC 上检测到的 GPU 厂商（NVIDIA、AMD、Intel），以及兼容挖矿工具的推荐排序，附带官方仓库链接、支持的 GPU、dev fee 和备注。
- 列表由整理好的 [`catalog/catalog.json`](catalog/catalog.json) 提供。每个值都记录了来源 URL 和确认日期；未能确认的值标记为 **未确认（미확인）**，未能确认官方仓库的工具不提供链接。
- 排序规则：与这台 PC 的 GPU 兼容 → dev fee 已确认 → 来源不一致 → 未确认 → 已确认 dev fee 较低者优先。

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

- **GPU 仪表盘**：每 2 秒读取一次 `nvidia-smi`：温度、风扇、功耗/上限、使用率。GPU 以 PCI bus id 识别。
- **安全监控**：风扇停转、过热或温度读数丢失时，停止已知的挖矿程序。参见[安全监控](#safety-watch)。
- **挖矿开关**：在 HUD 和托盘中启动、停止你配置的挖矿程序。见[挖矿开关](#mining-on-off)。
- **无界面主机与远程画面**：在没有屏幕的电脑上以服务方式运行 Crypthy，并通过 Tailscale 在另一台电脑的 Crypthy 上查看和操作。见[无界面主机](#headless)。
- **功率限制**：按 GPU 设定 W 值，只需一次管理员授权，之后会自动重新应用（Windows 计划任务 / Linux systemd 服务）。应用本体以普通用户权限运行。
- **托盘应用**：可选登录时启动；另有只读的**本地状态 API**，以及来自 GitHub Releases 的**自动更新**。

### 图表

在图表窗口（HUD **图表（차트）**、托盘 **打开图表（차트 열기）**）中，使用 [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)（Apache-2.0）绘制：
- 按 GPU 显示算力、温度和功耗（1 分钟均值，最近 3 天，每个 GPU 最多 4,320 个点，最多 16 个 GPU）
- 30 天币价（CoinGecko，USD）
- 每日挖矿量（柱状图）和以韩元计的净收益（折线图），按当天收盘价或当前价格换算，并扣除电费

### 挖矿量与收益

- **实时估算（韩元/h）**：实测算力 × 矿池统计的预期挖矿量 × 币价 − 实测 GPU 电费。算力来自挖矿程序的统计 API（SRBMiner-MULTI 使用 `--api-enable --api-port 21550`）；矿池统计来自 Kryptex，无需输入钱包也能查询。未使用 Kryptex 矿池时，今日·本月的估算值是把同一时段内的挖矿量和用电量一起累计后得出的。
- **今日收益 / 本月收益**（Kryptex 矿池）：（矿池确认挖矿量 + 追溯补录量 + 矿池尚未反映的实时估算量）× 币价 − 同一期间的电费。矿池每次增加的部分按距上次增加的时间比例分摊到各日期，跨零点的增加由两天分摊。实时估算量在矿池反映后会被确认量替换。明细显示在数字下方和提示中。**累计挖矿量**是矿池公开的累计总量（未支付余额 + 已支付），包含启动应用之前已挖到的份额。为方便与钱包核对，分为已支付、支付中和矿池余额（未支付）显示；PnL 的累计挖矿量与它相同（实时估算单独显示）。支付按时间和金额识别，因此从支付中变为已完成的支付只计一次。
- **币价**：从 CoinGecko 获取，并按设置中的汇率换算。查询失败时，使用最后一次正常的币价并标注时间（超过 30 分钟标记为过期）；如果一次也没有获取到，则不计算净收益，显示「无币价」（시세 없음）。
- **挖矿 vs 出租**（仅信息展示）：按 GPU 对比挖矿净收益与出租净收益（标价 × 主机分成 − 出租期间电费），在出租更划算、超过各 GPU 的价格阈值，或币价下跌达到设定比例时发送重新评估通知。
- **Vast 出租价格**：无需登录，通过公开搜索每 30 分钟查询一次同型号单卡的挂单。默认只使用 **verified** 挂单（未认证·已取消认证的挂单集中在最低价一侧：2026-10-18 的 RTX 5090 按需挂单，全部计入时为 $0.699，只计入 verified 时为 $0.869）。可选按需或可中断，可选按国家过滤，低于 DLPerf 中位数 80% 的挂单会被排除。显示中位数、下 25%、样本数和时间；样本少于 5 个时显示「数据不足」（데이터 부족）。按 GPU 的手动值优先。

### 累计盈亏（PnL）

- 矿池累计增长、支付、价格以及每 10 分钟的用电区间都会追加到本地事件日志（`pnl/events.jsonl`，每行一个 JSON 事件；损坏的行会跳过；超过 5 MB 时轮换一次）。每日汇总保存在 `pnl/daily.json`，不限期限，下列数值均以此为准。
- **计算定义**：收入 = 挖矿量 × 挖出时的价格；电费 = 实测 GPU 用电量 × 当时电价；已实现 = 手动卖出记录 − 手续费；未实现 = 持有量（挖矿 − 卖出）× 当前价格；**总 PnL = 已实现 + 未实现 − 电费**。
- 显示今日 / 本月 / 7 天 / 30 天 / 全部汇总，以及每日净收益柱状图和累计 PnL 折线。无价格时挖出的币按下一个价格估值并标记为"估算"；没有当前价格时，未实现和总 PnL 显示"无价格"，不会显示为 0。
- **追溯补录**：开始记录前已挖出的部分（开始记录时的矿池累计值）在获取到算力、矿池统计和 GPU 功率后自动补录。开始时间按 矿池累计值 ÷ 当前预期挖矿速度 估算（不晚于最早一笔支付），电费按当前 GPU 功率估算。可以修改开始时间和瓦数重新计算，之前的补录会被替换而不是叠加。补录的日期标记为"估算"。
- **手动卖出记录**（可选）：数量、卖出金额、手续费、交易所和备注，仅保存在本地。没有卖出记录时全部视为未实现。
- 可将每日汇总和事件**导出为 CSV**，并可直接打开日志文件夹。

### SafeTrade 自动卖出与变现路径（v0.5.0）

- **自动卖出**（默认关闭，从模拟运行开始）：每天在设定时间通过 SafeTrade 官方 API 卖出 SafeTrade 上可用的 PRL（扣除保留数量）。只用限价单，绝不用市价单，挂在最优卖价下一档；N 分钟内未成交则撤单并降一档重挂。
- **绝不低于下限价**：下限价 = max(你的最低价, 参考价 × (1 − X%))，参考价取 SafeTrade 24 小时均价和 CoinGecko 中较高者。真实卖出必须设置最低价。
- 盘口异常（价差超过 Y%、买盘太薄、API 错误）时当天不卖并发出提醒。有每日最大卖出量和单笔最大金额。
- 订单 ID、成交、均价、手续费和收到的 USDT 记入 PnL 的已实现卖出和共享账本。每天只在一台设备上运行一次（共享账本文件夹中的按日记录）。卖出中途应用关闭时，下次启动会撤销剩余订单并记录已卖数量。
- **不自动化**：提现（SafeTrade → 币安）和从 Pearl 钱包转出。只发提醒：“要转到 SafeTrade 的 PRL”和“本周建议提现”。
- **变现路径备忘**（手续费和测量日期可修改）：Pearl 钱包 → SafeTrade（PRL 充值，无手续费，最少 1 PRL，10 个确认）→ 卖出 PEARL/USDT（2026-10-18 由 PRL/USDT 改名；卖出手续费 0.1%，2026-10-19 实测）→ 币安（USDT BSC，固定手续费 1 USDT，最少 2）→ Upbit/Bithumb（旅行规则）。提现手续费固定，所以每天卖出、每周提现。

### 主题

默认是交易所仪表盘风格的深色主题（黄色强调色、等宽数字、上涨绿色 / 下跌红色），另有浅色和跟随系统主题。不使用任何交易所的 logo、名称或图标。

## 截图

![仪表盘（深色主题，模拟数据）](docs/screenshots/dashboard-dark.png)

<details><summary>浅色主题</summary>

![仪表盘（浅色主题，模拟数据）](docs/screenshots/dashboard-light.png)

</details>

截图使用的是模拟模式（`npm run start:mock`）下的合成数据。

<a id="download-and-install"></a>

## 下载与安装

从 [Releases](https://github.com/Ruderud/crypthy/releases) 下载。需要安装带有 `nvidia-smi` 的 NVIDIA 驱动。

| 平台 | 文件 | 自动更新 |
|---|---|---|
| Windows 10/11 x64 | `Crypthy-<version>-setup-x64.exe`（安装版） | 支持 |
| Windows 10/11 x64 | `Crypthy-<version>-win-x64.zip`（免安装版） | 不支持 |
| Linux x64 | `Crypthy-<version>-linux-x86_64.AppImage` | 支持 |
| Linux x64（Debian/Ubuntu） | `Crypthy-<version>-linux-amd64.deb` | 不支持 |

### 校验下载文件

构建未进行代码签名。请将哈希值与同一发布版本中的 `SHA256SUMS.txt` 进行比对。

```powershell
Get-FileHash .\Crypthy-0.2.0-setup-x64.exe -Algorithm SHA256
```

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

### Windows

1. 运行安装程序。由于应用未签名，SmartScreen 可能会弹出警告；确认哈希无误后，点击 **更多信息 → 仍要运行**，并同意 MIT 许可证。
2. 安装按用户级别进行（不需要管理员权限）。默认路径为 `%LOCALAPPDATA%\Programs\Crypthy`。

### Linux（Ubuntu）— v0.3.0，尚未在真机上测试

- AppImage（Ubuntu 22.04 及以上版本可能需要 `libfuse2`）：
  ```bash
  chmod +x Crypthy-*.AppImage && ./Crypthy-*.AppImage
  ```
- deb：
  ```bash
  sudo apt install ./Crypthy-*.deb
  ```
- 托盘图标通过 Ubuntu 的 AppIndicator 显示，其他桌面环境可能需要 AppIndicator 扩展。开启“登录时启动”后，会创建 `~/.config/autostart/crypthy.desktop`。

<a id="headless"></a>

### 无界面主机与远程画面（v0.4.0，尚未在真机上测试）

适用于没有屏幕的电脑，例如用作 Vast.ai 主机的 Ubuntu Server。Crypthy 在那台电脑上作为 systemd 服务（`crypthy-headless`：监控、安全停止、收益记录，无窗口）运行，另一台电脑上的 Crypthy 通过 [Tailscale](https://tailscale.com/) 等私有网络连接，显示同样的仪表盘。

1. 在主机上（Node.js 18 及以上，`sudo apt install nodejs`）从 Releases 下载 `crypthy-headless-<版本>.tar.gz` 并安装：
```bash
tar xzf crypthy-headless-*.tar.gz && cd crypthy-headless-*/
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)"
sudo -u "$USER" crypthy-headless --print-tokens
```
2. 在另一台电脑的 Crypthy 中：**设置 → 远程主机连接（원격 호스트 연결）**，输入主机地址（`100.x.y.z:47321`）和读取令牌。连接期间顶部显示 **远程（원격）**；点击 **回到本机画面（이 PC 화면으로）** 断开连接。
3. 如需在另一台电脑上启动/停止挖矿、修改设置或解除暂停，请启用写入后安装，并同时输入写入令牌：
```bash
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)" --enable-write --accept-risk
```

- 除非用 `--bind` 指定一个具体 IP，远程 API 只监听 127.0.0.1，绝不监听所有地址（0.0.0.0）。读取需要读取令牌；写入需要 `--enable-write` 和单独的写入令牌。令牌为随机值，仅所有者可读地保存在 `/var/lib/crypthy-headless`，不会写入日志。
- 响应中不包含钱包地址（只显示为 `prl1qe…0000.rig1`），挖矿程序参数中的钱包也会遮盖。
- 挖矿开关方式（可执行文件、参数、任务、单元）、安全设置和开机启动只能在主机上修改：编辑 `/var/lib/crypthy-headless/settings.json` 后运行 `sudo systemctl restart crypthy-headless`。仅凭写入令牌无法让主机运行其他程序或关闭安全停止。
- 在无界面主机上首次启动需要 `--accept-risk`，或在已连接电脑上通过同意对话框确认。危险停止后不会重新启动挖矿程序的原则不变。
- 加上 `--power-limits` 会用同一个 `sudo` 安装 GPU 功率限制服务（不使用 pkexec）。没有自动更新：重新运行新版本的 `install.sh` 即可（数据保留）。
- 绝不停止容器（Docker、containerd、Vast.ai `kaalia`）。
- 目前还没有 macOS 发布版本，请从源码运行：
```bash
git clone https://github.com/Ruderud/crypthy && cd crypthy
npm ci && npm run build && npx electron .
```

## 快速开始

1. 在**币种中心（코인 허브）**中选择币种，进入推荐挖矿工具的仓库，**自行**安装挖矿程序。来源·哈希·dev fee 请在仓库中再次确认。如果安全软件拦截了挖矿程序，是否放行由用户自行判断。
2. 在开启统计 API 的状态下运行挖矿程序。如果是 SRBMiner-MULTI，请加上 `--api-enable --api-port 21550`；如果使用其他端口，请在 **设置 → 挖矿程序 API 端口（설정 → 채굴기 API 포트）** 中设置相同的值。
3. （可选）在 **首次设置 → 钱包·矿池（처음 설정 → 지갑·풀）** 中，输入公开钱包地址并加上 `.workername`，矿池以 `host:port` 格式输入，即可查看矿池确认的挖矿量。**从现有 bat 导入（기존 bat에서 가져오기）** 会从挖矿程序的 `.bat` 文件中读取 `--wallet` 和 `--pool`。

应用界面目前仅支持韩语。

### 从 0.1.x 更新

- 钱包、矿池、功率限制、安全阈值和收益设置原样保留；0.1.x 中与挖矿程序运行相关的设置（挖矿程序文件夹、GPU 选择·映射、同意记录）会被丢弃。
- 之前被设为“安全排除”的 GPU，会延续为**安全暂停（안전 보류）**。
- 0.2.0 到 0.3.6 不会启动挖矿程序；从 0.3.7 起可以在应用中启动、停止自行配置的挖矿程序（见[挖矿开关](#mining-on-off)）。0.1.x 启动的挖矿程序会继续运行。
- 从 0.3.1 及以下版本更新时，收益账本会被转换：保留矿池基准点，旧的每日数值仅作为挖矿量显示（不计入净收益）。

## 配置

### 设置

| 设置项 | 默认值 | 备注 |
|---|---|---|
| 币种 | Pearl | 用于币种中心、币价和矿池统计的目录币种 |
| 钱包 / 矿池 | 空 | 公开地址 `.worker` 和 `host:port`；仅用于查询矿池公开统计 |
| 挖矿程序统计 API / 端口 | SRBMiner-MULTI / 21550 | `none` 表示关闭 |
| 挖矿开关 | 不使用 | 计划任务（Windows）、systemd 用户单元（Linux）或可执行文件 + 参数；停止前确认（开） |
| 共享账本文件夹 | 空（仅本机） | 双系统：两个系统都能读写的文件夹，见[共享账本](#shared-ledger) |
| 危险条件下停止挖矿程序 | 开 | 关 = 仅通知 |
| 登录时启动 | 关 | Windows 登录项 / Linux XDG autostart |
| 登录时显示窗口 | 关（仅托盘） | 开启后登录时打开窗口 |
| Crypthy 启动时自动开始挖矿 | 关 | 启动 30 秒后；需要同意；安全暂停、最近危险停止或已有挖矿程序运行时跳过 |
| 更新检查周期 | 60 分钟 | 30–1440 分钟 |
| 风扇停转的功耗 / 时间 | 100 W / 10 s | 安全监控 |
| 温度警告 / 停止 | 80°C / 85°C | 安全监控 |
| 电价 / 汇率 | 350 KRW/kWh / 1340 KRW/$ | 收益 |
| 出租主机分成 / 出租期间功耗 | 0.75 / 250 W | 挖矿 vs 出租 |
| 降价通知 / 基准价 | 30% / 首次获取的价格 | 重新评估通知 |
| 仅 Vast verified / 挂单类型 / 地区 | 开 / 按需 / 全部 | 出租价格过滤 |

<a id="mining-on-off"></a>

### 挖矿开关

Crypthy 只启动和停止你自己配置的挖矿程序，不会下载或安装挖矿程序。在 **设置 → 挖矿开关方式（채굴 켜기·끄기 방식）** 中选择：

| 方式 | 启动 | 停止 |
|---|---|---|
| Windows 计划任务 | `schtasks /Run /TN <名称>` | `schtasks /End /TN <名称>`，然后停止挖矿进程 |
| Linux systemd 用户单元 | `systemctl --user start -- <单元>` | `systemctl --user stop -- <单元>`，然后停止挖矿进程 |
| 可执行文件 | 不经过 shell、与应用分离地运行 `.exe`（Windows）或可执行文件及参数 | 停止挖矿进程 |

- 使用 HUD 或托盘菜单中的 **启动 / 停止（켜기 / 끄기）**，只有适用的按钮可用。
- 首次启动需要同意风险与费用说明。停止前会确认一次（可在设置中关闭）。
- 如果已有挖矿程序在运行（例如在应用之外启动），**启动** 不可用，挖矿程序标签页显示"外部运行"；不会再启动第二个挖矿程序。**停止** 仍可使用。
- 计划任务方式下，**从计划任务导入** 会读取任务的可执行文件和参数；该可执行文件名也会加入应用监控和停止的进程列表。
- 参数按空格拆分（含空格时用"双引号"），以列表形式传递，因此 `&`、`|` 等 shell 字符不起作用。Windows 上只能直接运行 `.exe`；`.bat` 请注册为计划任务。
- 应用以普通用户权限运行。以管理员身份运行的挖矿程序无法由应用停止，此时会提示你在任务管理器中结束它。
- 危险停止后应用不会自行再次启动挖矿程序；使用计划任务或单元时也会结束该任务或单元，使任务计划程序或 systemd 无法重新启动挖矿程序。可执行文件必须是挖矿程序本身，而不是 `cmd` 或 `powershell`。见[安全监控](#safety-watch)。
- **Crypthy 启动时自动开始挖矿**（默认关闭）：Crypthy 启动 30 秒后启动一次已配置的挖矿程序。需要同意风险与费用说明（开启时询问）；处于安全暂停、最近 6 小时内发生过危险停止，或已有挖矿程序在运行（例如由计划任务先启动）时会跳过，并在提醒中注明原因。危险停止后不会重新启动的原则不变。
- **可执行文件** 方式在 Windows 上不显示控制台窗口（**隐藏挖矿程序控制台窗口**，默认开启）。输出写入 `logs/miner.log`，只有在挖矿程序卡片上点击 **查看挖矿窗口（채굴 창 보기）** 时才在应用中显示。**计划任务** 方式由任务计划程序启动挖矿程序，总会弹出控制台窗口，因此建议使用 **可执行文件** 方式。
- 挖矿程序可执行文件和共享账本文件夹可用 **浏览…（찾아보기…）** 按钮在文件对话框中选择（仍可手动输入路径）。
- **按 GPU 挖矿**（可执行文件方式，NVIDIA）：每张 GPU 卡片上都有 **挖矿（채굴）** 开关，例如 RTX 5090 自己使用，只用 RTX 5080 挖矿。对 SRBMiner 使用所选卡片的 SRBMiner 设备编号传入 `--gpu-id`：该编号与 nvidia-smi 编号不同（例如集成显卡排在前面时 RTX 5090 = 1、RTX 5080 = 2），因此按 PCI bus 通过 SRBMiner 统计 API 或 `--list-devices` 建立映射，并按挖矿程序、卡片和驱动缓存。其他挖矿程序使用 `CUDA_VISIBLE_DEVICES`。无法映射时不会阻止挖矿，而是用所有卡挖矿并在挖矿程序卡片上说明原因。挖矿程序运行中会按新选择重启，一个都不剩时停止；启用选择期间会替换你自己填写的 `--gpu-id` 参数。不挖矿的 GPU 不计入电费和功率限制，其危险状况只发出警告（其他 GPU 继续挖矿）。如果已关闭的 GPU 仍有算力，说明挖矿程序没有遵循选择，卡片上会提示。没有写入令牌的远程画面为只读。
- 如果想用 Crypthy 在登录时打开并静默开始挖矿，替代会弹出控制台窗口的计划任务：
  1. 设置 → 挖矿开关：选择 **计划任务**，填写任务名称（例如 `PearlMiner`），然后点击 **切换为可执行文件方式（실행 파일 방식으로 전환）**。它会读取任务的可执行文件和参数（也会解开 `conhost --headless` 包装），并把方式改为隐藏控制台窗口的 **直接运行可执行文件**。
  2. 打开 **Crypthy 启动时自动开始挖矿**、**登录时启动** 和 **登录时显示窗口**，然后保存。
  3. 如果旧任务仍处于启用状态，设置中会显示 **停用计划任务（예약 작업 끄기）**（会先询问；只停用不删除）。如果需要管理员权限，请在管理员命令提示符中运行：
```bat
schtasks /Change /TN PearlMiner /DISABLE
```

### 功率限制 — Windows（一次 UAC）

1. 在 **GPU 设置 · 功率限制（GPU 설정 · 전력 제한）** 表中输入各 GPU 的 W 值（须在 nvidia-smi 给出的范围内；留空则不会触碰该 GPU）。
2. 点击 **注册功率限制计划任务（전력 제한 예약 작업 등록 (UAC 1회)）** 并确认。以管理员权限运行的 `resources\ps\register-power-task.ps1` 会执行以下操作：
   - 以原子方式重新创建 `C:\ProgramData\Crypthy\`，并设置受保护的权限（所有者 Administrators、阻止继承、Users 仅有读取·执行权限）；若已存在 junction/symlink，则中止脚本
   - 将应用脚本复制到该文件夹，并注册计划任务 `Crypthy-PowerLimit`（当前用户、最高权限、登录 30 秒后）
3. 修改数值后，点击 **立即应用功率限制（전력 제한 지금 적용）**。应用只会向 `%APPDATA%\Crypthy\power-limits.json` 写入 PCI bus id 和 W，并运行 `schtasks /run`。日志位于 `C:\ProgramData\Crypthy\power-limit.log`。

计划任务只会把 JSON 当作数据读取，并且只把 PCI bus id 和 100–1000 的整数传给 `C:\Windows\System32\nvidia-smi.exe -i <bus id> -pl <W>`。请仅在可信的安装包上进行注册（原始脚本位于用户可写入的安装文件夹中）。

```powershell
schtasks /delete /tn Crypthy-PowerLimit /f
Remove-Item -Recurse C:\ProgramData\Crypthy
```

### 功率限制 — Linux（一次管理员认证）

1. 输入 W 值，点击 **安装功率限制服务（전력 제한 서비스 설치 (관리자 인증 1회)）** 并在 `pkexec` 认证窗口中确认。随附的 `resources/linux/install-power-service.sh`（以 root 身份运行）会执行以下操作：
   - 安装 `/usr/local/lib/crypthy/apply_power_limits.py`（所有者为 root，权限 0755）
   - 创建 oneshot 单元 `crypthy-power-limit.service`（开机时应用，启用 `ProtectSystem=strict` 等保护选项）
   - 创建 `/etc/polkit-1/rules.d/50-crypthy-power-limit.rules`，**仅允许此用户** **启动此服务**
2. **立即应用功率限制（전력 제한 지금 적용）** 会向 `~/.config/Crypthy/power-limits.json` 写入内容（仅 PCI bus id 和 W），并执行 `systemctl start crypthy-power-limit.service`。在不支持 polkit JS 规则的版本中（例如 Ubuntu 22.04 的 polkit 0.105），每次都会弹出 `pkexec` 认证窗口。
3. 日志位于 `/var/lib/crypthy/power-limit.log`。输入规则与 Windows 相同：只作为数据读取、PCI bus id 格式、100–1000 的整数、最多 16 项、固定路径的 nvidia-smi、不经过 shell，非 JSON 内容不会写入日志。

```bash
sudo systemctl disable --now crypthy-power-limit.service
sudo rm -f /etc/systemd/system/crypthy-power-limit.service /etc/polkit-1/rules.d/50-crypthy-power-limit.rules
sudo rm -rf /usr/local/lib/crypthy /var/lib/crypthy
sudo systemctl daemon-reload
```

### 自动更新

- 仅支持 Windows 安装版和 Linux AppImage。应用窗口出现后几秒内检查一次，之后每小时检查一次（可在设置中调整为 30 分钟~24 小时）；顶部和托盘菜单中有 **检查更新（업데이트 확인）**。
- 发现新版本时，顶部栏下方固定的横幅会显示发布说明和 **下载 / 稍后（받기 / 나중에）**；下载完成后可选择 **立即重启安装 / 稍后（지금 재시작해 설치 / 나중에）**。这些选择只在横幅中进行。仅在托盘中运行（窗口隐藏或最小化）时还会弹出一次系统通知，点击后打开窗口、滚动到顶部并突出显示横幅。手动 **检查更新** 只显示横幅。
- **稍后** 会在下一次定期检查之前隐藏同一提示；手动检查时会再次显示。
- 仅在点击时才会安装。挖矿程序与应用分开运行，所以重启后挖矿仍会继续，只有安全监控会短暂暂停。
- 下载的文件通过 `latest.yml` / `latest-linux.yml` 中的 sha512 进行校验。由于没有代码签名，签名校验（`verifyUpdateCodeSignature`）处于关闭状态；这只能保证文件与 GitHub Releases 上的一致。
- 即使更新失败，也只会留下通知，不会影响安全监控。如果更新安装无法替换应用文件，安装程序不会启动只安装了一半的应用，而是给出提示并打开发布页面。从 [Releases](https://github.com/Ruderud/crypthy/releases) 下载 `Crypthy-<版本>-setup-x64.exe` 并运行即可恢复，`%APPDATA%\Crypthy` 中的设置和记录会保留。更新过程记录在 `%APPDATA%\Crypthy\logs\main.log`。可用 `CRYPTHY_MOCK=1 CRYPTHY_MOCK_UPDATE=1` 体验整个流程。

### 本地状态 API

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

- 只绑定 `127.0.0.1`。如果 Host 头不是 `127.0.0.1:47321` / `localhost:47321`，则返回 403（阻止 DNS rebinding）；非 GET 请求返回 405，其他路径返回 404。
- 最多 8 个 gpus、20 个 alerts（按最新排序），每个字符串 120 字符。不包含钱包和设置。
- `mode`：`external`（在应用之外启动的挖矿程序正在运行）、`app`（用应用的**启动**启动）或 `null`。`hashrate` 单位为 H/s。alert 的 `gpu` 为 PCI bus id。
- alert code 列表 — 安全：`fan_stopped`、`temp_stop`、`temp_warn`、`telemetry_lost`、`miner_killed`、`miner_killed_again`、`kill_failed`、`safety_hold_running`、`hold_cleared`；重新评估：`review_rental_price`、`review_rental_better`、`review_prl`；更新：`update_available`、`update_ready`、`update_error`；其他：`status_api`。
- 响应中还包含仅含四舍五入汇总值的 `pnl` 对象（`mined_coin`、`holdings_coin`、`revenue_krw`、`energy_cost_krw`、`realized_krw`、`unrealized_krw`、`total_pnl_krw`、`estimated`），不暴露原始日志。
- 无界面主机在同一端口上还提供需要令牌的端点（`/v1/state`、`/v1/charts`、写入）；见[无界面主机](#headless)。

<a id="shared-ledger"></a>

### 共享账本（双系统）

同一台电脑交替启动 Windows（Crypthy）和 Linux（`crypthy-headless`）时，各自使用自己的数据，PnL 会分成两份。把两边都指向一个两个系统都能读写的文件夹（例如一个小的 FAT32/exFAT 分区），就能共用一份 PnL：

- Windows：**设置 → 共享账本文件夹（공유 장부 폴더）**，例如 `U:\`。
- Linux 无界面：`--shared-ledger <挂载路径>`（或 `settings.json` 中的 `sharedLedgerDir`）：
```bash
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)" --shared-ledger /mnt/crypthy
```

- Crypthy 使用其中的 `crypthy/`。每个实例只向自己的 `pnl/events-<实例 id>.jsonl` 追加，其他文件只读。PnL 由所有文件合并后重新计算，因此与单一账本的结果一致。
- 矿池基准（最后的矿池累计值、已看到的支付）通过 `pool-state.json` 共享：下一个启动的系统从上一个停止的位置继续，矿池增量和支付只计一次。顺序按世代号而不是时钟判断（两个系统读取硬件时钟的方式可能不同）。
- 币种、钱包、矿池和收益设置是共享的（`shared-settings.json`）；挖矿开关、远程 API 和功率限制按系统分别保存。
- 首次启用时会把现有本地账本复制到本实例的文件中。之前在两个数据文件夹之间复制过的记录只计一次。
- 文件夹不存在（未挂载）时，电力和卖出记录继续保存在本地，文件夹重新出现时再补上；其间不记录矿池增量（避免重复计算），之后从共享基准继续。设置过一次后，没有 `crypthy/` 的文件夹视为未挂载。Linux 服务会等待挂载（`RequiresMountsFor`）。两个实例的电力记录在时间上重叠时会发出警告。
- 两个系统不能同时基于同一矿池数据运行（双系统本来就不会）。

<a id="auto-sell"></a>

### SafeTrade 自动卖出

1. 在 SafeTrade 创建**只有交易权限**的 API 密钥：**不要给提现权限**，可以的话限制为本机 IP。Crypthy 无法通过 API 检查密钥权限。
2. 桌面版：在 **卖出·变现 → API 密钥（매도·현금화 → API 키）** 中输入密钥和密钥密文（secret）并保存。它们用操作系统安全存储（Windows DPAPI）加密，不会再次显示，也不会发送到远程画面、日志或状态 API。**删除密钥（키 삭제）** 可将其删除。
3. 设置**最低价**，保持**模拟运行**开启，打开**在本设备自动卖出**，用**模拟运行（모의 실행）** 按钮（或每日运行）检查计划的价格和数量。
4. 计划无误后关闭**模拟运行**（会先确认）。**立即真实卖出一次**同样会先确认，并遵守下限价和限额。

自动卖出每次运行时都会在 SafeTrade 市场列表中查找 PRL 市场（币种 `pearl`，原 `prl`），因此市场改名后也能跟上。SafeTrade 的 Cloudflare 会拦截普通 Node 请求（2026-10-19 确认），所以桌面版通过 Electron 的网络栈发送；无界面主机上的请求可能被拦截，届时自动卖出会以此原因跳过当天。

无界面主机：把 `{"key": "...", "secret": "..."}` 写入只有你能读的文件后安装；它会被复制到 `/etc/crypthy/safetrade-key.json`（root，0600），并只通过 systemd `LoadCredential`（systemd 247 及以上）交给服务。请用编辑器写入，避免留在 shell 历史中：
```bash
install -m 600 /dev/null ~/safetrade-key.json
nano ~/safetrade-key.json
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)" --enable-write --safetrade-key ~/safetrade-key.json
rm ~/safetrade-key.json
```

- 有写入令牌的远程画面可以开关自动卖出、模拟运行和时间，并运行一次（`POST /v1/autosell/run`，真实卖出需确认）。下限价、限额和市场只能在主机上修改。密钥不会经过远程 API。
- 只在一台设备上开启自动卖出。有共享账本文件夹时第二台设备会跳过当天；文件夹不可用时不进行真实卖出。

### 文件位置

| 文件 | 路径 |
|---|---|
| 设置 | Windows `%APPDATA%\Crypthy\settings.json` · Linux `~/.config/Crypthy/settings.json` |
| 安全暂停 | `%APPDATA%\Crypthy\runtime.json` |
| 日/月账本 | `%APPDATA%\Crypthy\ledger.json` |
| 图表记录（最近 3 天） | `%APPDATA%\Crypthy\history.json` |
| 功率限制值 | `%APPDATA%\Crypthy\power-limits.json` |
| 功率限制脚本和日志 | `C:\ProgramData\Crypthy\` |
| PnL 事件日志（5 MB 轮换） | `%APPDATA%\Crypthy\pnl\events.jsonl` |
| PnL 每日汇总（不限期限） | `%APPDATA%\Crypthy\pnl\daily.json` |
| 应用日志（更新与退出过程，1 MB 轮换） | `%APPDATA%\Crypthy\logs\main.log` |
| 无界面主机数据与令牌 | `/var/lib/crypthy-headless/`（仅所有者） |
| 共享账本 | `<文件夹>\crypthy\`（按实例的事件、矿池基准、共享设置） |
| SafeTrade API 密钥 | 桌面版 `%APPDATA%\Crypthy\safetrade-key.json`（加密）· 无界面主机 `/etc/crypthy/safetrade-key.json`（root 0600） |
| 自动卖出状态与记录 | `%APPDATA%\Crypthy\autosell-state.json` |

<a id="safety-and-privacy"></a>

## 安全与隐私

<a id="safety-watch"></a>

### 安全监控

| 条件 | 动作 |
|---|---|
| 功耗 > 100 W 且风扇 0% 持续 10 秒以上 | 该 GPU **安全暂停（안전 보류）** + 停止正在运行的已知挖矿程序 + critical 通知 |
| 温度 ≥ 85°C | 同上 |
| 挖矿中温度值连续 5 次（约 10 秒）缺失 | 同上 |
| 温度 ≥ 80°C | 警告（降至 77°C 以下后恢复监控） |

- **停止对象**
  - Windows：用 `taskkill` 停止在目录中已确认可执行文件名的程序（`SRBMiner-MULTI.exe`、`peakminer.exe`、`forge.exe`、`arc-miner.exe`），并通过 tasklist 确认已关闭。
  - Linux：在 `/proc` 中查找从发布压缩包中确认过名称的 `SRBMiner-MULTI`、`peakminer`、`forge`；发送 SIGTERM，3 秒后仍存活则发送 SIGKILL。只以命令行中带有矿池·钱包·算法参数的进程为目标，因此同名的其他工具（例如 Foundry 的 `forge`）不会被误伤。
  - 可执行文件名未确认的工具（例如 quantus-miner）无法停止，只会发送通知。
- **绝不停止容器（Linux）**：用于保护 Vast.ai 客户工作负载之类的容器。只要符合以下任一项，进程就会被跳过；无法判定时同样跳过：
  - cgroup 路径中包含 docker / containerd / kubepods / podman / lxc 等
  - 与应用处于不同的 PID 命名空间，或无法读取命名空间
  - 祖先进程中有 containerd-shim / dockerd / runc / conmon 等
- 停止以挖矿程序为单位，而不是以 GPU 为单位。危险停止后应用不会再次启动挖矿程序；在解除保留之前**启动**保持禁用，解除后启动时会再次显示原因。
- **暂停会保持**，应用重启·重新开机后依然有效。暂停期间如果挖矿程序再次运行，会每隔 15 秒再次停止；排除原因后，点击 GPU 卡片上的 **清除暂停（보류 해제）** 即可解除。即使没有挖矿程序在运行（例如游戏时过热），也会设置暂停。
- 即使 nvidia-smi 失败，也会通过挖矿程序 API 的设备值（以 PCI bus 为准）继续监控。tasklist 失败时，会对所有已知名称尝试停止，无法确认时发送 critical 通知。如果仅通过 API 检测到一个不知道可执行文件名的挖矿程序，会提示无法停止。
- 如果可执行文件名完全相同，其他程序也可能被停止（例如另一个名为 `forge.exe` 的应用）。
- 关闭 **设置 → 危险条件下停止运行中的挖矿程序** 后，只会重复发送 critical 通知。以管理员权限运行的挖矿程序，非管理员的应用无法关闭，请在任务管理器中结束。
- nvidia-smi 的 `fan.speed` 是请求的转速，并非实测 RPM。风扇被物理卡住时可能不显示为 0%，所以最终的安全保障是温度规则。

### 隐私与网络请求

- 没有遥测，也没有账号。远程控制只通过你自己的无界面主机及其写入令牌。
- 不索取或保存钱包助记词和密码，也不修改 Windows Defender、防火墙等安全设置。唯一保存的密钥是你为自动卖出输入的 SafeTrade API 密钥，并且加密保存。
- 不下载或安装挖矿程序，也不生成挖矿程序命令行。只在你点击时启动或停止你配置的挖矿程序。
- 对外发出的请求是公开数据的读取，以及设置自动卖出后用你的密钥签名的 SafeTrade API 调用：
  - CoinGecko 币价
  - Kryptex 矿池统计和公开钱包余额
  - Vast.ai 公开报价
  - GitHub Releases 更新检查
  - SafeTrade 盘口、余额和限价卖单（仅自动卖出）

### 未签名的构建

构建未进行代码签名，因此 Windows SmartScreen 可能会弹出警告。每个发布版本都附带 `SHA256SUMS.txt`，自动更新也会校验发布元数据中的 sha512。安全问题请按 [SECURITY.md](SECURITY.md) 中的说明报告。

## FAQ

**Crypthy 会挖矿或收取费用吗？**
不会。它从不下载挖矿程序，也没有 dev fee。你自行安装的挖矿程序可能收取自己的 dev fee，币种中心中会有标注。

**为什么今日和本月收益标有「含估算」？**
因为其中包含追溯补录量（估算的开始时间和功率）以及矿池尚未反映的实时估算量。矿池确认挖矿量或重新计算补录后，会替换为相应的值。

**安全停止只会影响过热的那个 GPU 吗？**
不是。Crypthy 会停止整个挖矿程序进程，因此它使用的所有 GPU 都会停止，且不会重新启动。

**在 Linux 上会停止我的 Vast.ai 出租吗？**
不会。容器中的进程（docker/containerd/podman/lxc、其他 PID 命名空间，或位于容器运行时之下）绝不会被视为挖矿程序。

**为什么杀毒软件会报告挖矿程序有问题？**
挖矿软件经常被误报。Crypthy 不会修改安全设置，请在确认来源和哈希之后自行判断。

**为什么应用界面是韩语？**
目前界面仅支持韩语。欢迎提供翻译，请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图

请参阅 [docs/ROADMAP.md](docs/ROADMAP.md) 和 [CHANGELOG](CHANGELOG.md)。

## 参与贡献

欢迎提交 issue 和 pull request，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和[行为准则](CODE_OF_CONDUCT.md)。

```bash
npm install
npm test             # unit tests (vitest)
npm run typecheck
npm run check:readme # README.md / README.ko.md / README.zh-CN.md structure in sync
npm run start:mock   # UI with mock hardware (works on macOS/Linux)
npm run dist:win     # Windows x64 NSIS + zip + latest.yml + SHA256SUMS (no upload)
npm run dist:linux   # Linux x64 AppImage + deb + latest-linux.yml (builds on macOS too)
```

- 模拟模式选项：`CRYPTHY_MOCK_FANSTOP=<nvidia-smi index>`（30 秒后风扇变为 0%）、`CRYPTHY_MOCK_KILLFAIL=1`、`CRYPTHY_MOCK_IDLE=1`、`CRYPTHY_MOCK_UPDATE=1`（假更新 v0.9.9）。
- 修改目录需要附上来源 URL 和确认日期；测试会强制要求已确认的 dev fee 必须有来源、仓库链接只允许 GitHub 仓库，且未确认的工具不放链接。
- 新的挖矿程序统计 API，请以适配器的形式添加到 `src/main/minerApi.ts` 的 `MINER_APIS` 中。
- 请保持 `README.md`、`README.ko.md`、`README.zh-CN.md` 同步；`npm run check:readme` 会在 CI 中运行。
- 发布：push `v*` 标签后，会构建 Windows 和 Linux 版本，上传安装文件、`latest.yml`、`latest-linux.yml` 和 `SHA256SUMS.txt`，并使用 [CHANGELOG](CHANGELOG.md) 中对应的章节作为发布说明。只使用 `GITHUB_TOKEN` 这一个密钥。

## License

[MIT](LICENSE) © 2026 Ruderud

挖矿工具（SRBMiner-MULTI 等）不包含在本仓库中，遵循各自的许可证和 dev fee 政策。

## 致谢

- [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) 5.2.1，Apache-2.0，Copyright (c) 2025 TradingView, Inc. 保留图表内的 TradingView 标志链接（`attributionLogo`），并在应用底部标注来源。LICENSE 和 NOTICE 随软件包分发于 `resources/app.asar/dist/renderer/vendor/`；原文：[`resources/third-party/lightweight-charts-NOTICE.txt`](resources/third-party/lightweight-charts-NOTICE.txt)。
- [Electron](https://www.electronjs.org/)（MIT），[electron-builder / electron-updater](https://www.electron.build/)（MIT）。
- 公开数据：[CoinGecko](https://www.coingecko.com/)、[Kryptex 矿池](https://pool.kryptex.com/)、[Vast.ai](https://vast.ai/)。
