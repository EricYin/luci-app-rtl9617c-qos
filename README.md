# luci-app-rtl9617c-qos

LuCI Web UI, RPCD backend, and UCI control service for Realtek RTL9617C (Taurus) hardware QoS, traffic engineering, packet offloads, and VPN tunnel acceleration.

## Features

- **Hardware Offload & NIC Acceleration**: DMA LSO (`tx_csum` / `tso` / `tso_v6`) with live `ethtool -k` verification, `page_pool` zero-copy RX, multi-core IRQ/RPS/RFS steering status, GE 802.3az EEE toggle (`lan2`–`lan4`), IPTV hardware multicast replication, and experimental NAT66 / Dual-Header controls
- **VPN Hardware Acceleration**: L2TPv2 / PPTP L3PE dual-header ASIC offload toggle, live Control/Content/EIF hardware slot inspection, kernel module & dialer tool self-check, and `/proc/crypto` engine comparison
- **Host Policing**: Per-MAC hardware rate limiting & traffic counters (32-entry hardware policer)
- **Port Shaping & 8-VoQ**: L2TE per-port shaper, 8-VoQ WRR/SP scheduling, WRED, and port EEE status
- **Flow Priority Classification**: Hardware CoS priority rules with built-in application signature catalog
- **DoS Protection & Port Mirroring**: Hardware L2/L3 DoS filters and hardware port mirroring

## Installation via OpenWrt / ImmortalWrt Feed

Add the unified feed to `feeds.conf.default`:

```
src-git rtl9617c https://github.com/crysister/rtl9617c-packages.git
```

Then update and install:

```sh
./scripts/feeds update rtl9617c
./scripts/feeds install -a -p rtl9617c
```

## License

GPL-2.0-or-later
