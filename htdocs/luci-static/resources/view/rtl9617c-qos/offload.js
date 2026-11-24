'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';

function fmtCount(n) {
	n = Number(n) || 0;
	if (n >= 1000000000)
		return (n / 1000000000).toFixed(2) + 'G';
	if (n >= 1000000)
		return (n / 1000000).toFixed(2) + 'M';
	if (n >= 1000)
		return (n / 1000).toFixed(1) + 'K';
	return String(n);
}

function renderLiveOffload(container, data) {
	var txOffload = (data && data.tx_offload) || {};
	var nic = txOffload.nic_features || null;
	var rxStats = txOffload.rx_stats || null;
	var steer = txOffload.steering || {};
	var vpn = (data && data.vpn) || {};
	var tun = vpn.tunnel || {};
	var paramActive = txOffload.tx_csum || txOffload.tso || txOffload.tso_v6;
	var nicActive = nic ? (nic.tx_csum || nic.tso || nic.tso_v6) : paramActive;
	var nicMismatch = nic && paramActive && !nicActive;

	var txBadge = nicMismatch
		? q.badge('参数已开 · 网卡未生效', 'warn')
		: (nicActive ? q.badge('网卡已生效', 'good') : q.badge('未开启', ''));

	var txDetails = [
		'模块参数: CSUM ' + (txOffload.tx_csum ? '开' : '关') +
		' · TSO ' + (txOffload.tso ? '开' : '关') +
		' · TSO6 ' + (txOffload.tso_v6 ? '开' : '关')
	];
	if (nic) {
		txDetails.push(
			'网卡实况 (' + nic.device + '): TX-CSUM ' + (nic.tx_csum ? 'on' : 'off') +
			' · SG ' + (nic.sg ? 'on' : 'off') +
			' · TSO ' + (nic.tso ? 'on' : 'off') +
			' · TSO6 ' + (nic.tso_v6 ? 'on' : 'off') +
			' · GSO ' + (nic.gso ? 'on' : 'off')
		);
	}

	var zcPkts = rxStats ? (rxStats.ni_rx_zerocopy || 0) : 0;
	var cbPkts = rxStats ? (rxStats.ni_rx_copybreak || 0) : 0;
	var fbPkts = rxStats ? (rxStats.ni_rx_alloc_fallback || 0) : 0;
	var steerDevs = steer.devs || [];
	var ponSteer = null;
	var lanSteer = null;
	steerDevs.forEach(function(d) {
		if (d.device === 'pon0')
			ponSteer = d;
		else if (!lanSteer && d.device.indexOf('lan') === 0)
			lanSteer = d;
	});
	var rfsOk = (steer.rfs_global || 0) > 0;
	var ponMulti = ponSteer && ponSteer.rps_cpus && ponSteer.rps_cpus !== '0' &&
		ponSteer.rps_cpus !== '1' && ponSteer.rps_cpus !== '2' &&
		ponSteer.rps_cpus !== '4' && ponSteer.rps_cpus !== '8';

	var niPorts = (data && data.ni_ports) || [];
	var eeePorts = niPorts.filter(function(p) {
		return p && p.eee && p.eee.supported;
	});
	var eeeEnabledCnt = eeePorts.filter(function(p) { return p.eee.enabled; }).length;
	var eeeActiveCnt = eeePorts.filter(function(p) { return p.eee.active; }).length;
	var eeeSummary = eeePorts.length
		? eeePorts.map(function(p) {
			return p.device.toUpperCase() + ':' +
				(p.eee.enabled ? (p.eee.active ? 'LPI激活' : '已开') : '关');
		}).join(' · ')
		: '暂未检测到支持 EEE 的千兆端口（LAN2 ~ LAN4）。';

	dom.content(container, [
		q.guideCard('这是什么？（硬件加速与芯片卸载）', [
			'1. 这里集中管理 RTL9617C 网卡与硬件转发引擎的底层加速特性（与限速、排队功能独立开来，避免混杂）。',
			'2. 「网卡本机发包硬件加速」适合路由器本机跑大流量上传（如路由器上的 Samba/Web/代理/iperf3 服务端），由 DMA LSO 硬件计算校验和及分段；状态卡片会同时核验 ethtool 网卡层是否真实生效。',
			'3. 「零拷贝收包 (page_pool)」消除 CPU 收包时的整包内存拷贝，降低非硬件流转发（如代理/VPN/Wi-Fi 桥接）的 CPU 占用；「多核收包调度」将 NI 硬中断独立绑核并让 PON 光口与 LAN 口均衡利用多核 RPS+RFS。',
			'4. 「VPN 硬件加速 (L2TP / PPTP)」由芯片 L3PE 双头隧道引擎直接卸载明文 L2TPv2 与 PPTP；「IPTV 硬件组播复制」与「GE 网口 802.3az EEE 节能」均可按需开启。'
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('本机发包加速 (DMA LSO)', txBadge, [
				E('div', { class: 'rq-kpi' }, [
					nicActive ? '硬件卸载运行中' : (paramActive ? '等待网卡同步' : '未开启（软件计算）')
				]),
				E('p', { class: 'rq-note' }, [txDetails.join(' ｜ ')])
			]),
			q.card('零拷贝收包 (page_pool RX)',
				txOffload.rx_zerocopy ? q.badge('已开启', 'good') : q.badge('已关闭', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						txOffload.rx_zerocopy ? '零拷贝 + 128B 小包快路径' : '传统拷贝模式'
					]),
					E('p', { class: 'rq-note' }, [
						rxStats
							? ('零拷贝包: ' + fmtCount(zcPkts) +
								' · 小包快拷贝: ' + fmtCount(cbPkts) +
								' · 内存回退: ' + fmtCount(fbPkts))
							: '等待网卡统计就绪（驱动已启用 page_pool + napi_build_skb）。'
					])
				]),
			q.card('多核收包调度 (IRQ / RPS / RFS)',
				(ponMulti && rfsOk) ? q.badge('多核均衡 + RFS', 'good') : q.badge('默认调度', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						'NI IRQ: CPU' + (steer.irq_cpu != null ? steer.irq_cpu : '-') +
						' · RFS ' + (rfsOk ? String(steer.rfs_global) : '关')
					]),
					E('p', { class: 'rq-note' }, [
						'LAN RPS: 0x' + (lanSteer ? lanSteer.rps_cpus : '0') +
						' · PON RPS: 0x' + (ponSteer ? ponSteer.rps_cpus : '0') +
						' · 队列流表: ' + (ponSteer ? String(ponSteer.rps_flow_cnt) : '0')
					])
				]),
			q.card('VPN 硬件隧道卸载 (L2TP / PPTP)',
				txOffload.vpn_offload ? q.badge('已开启', 'good') : q.badge('已关闭', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						txOffload.vpn_offload
							? ('活跃槽位 ' + (tun.control_used || 0) + '/16')
							: '已关闭（软件转发）'
					]),
					E('p', { class: 'rq-note' }, [
						'前往 ',
						E('a', { href: L.url('admin/network/rtl9617c_vpn') }, ['网络 → VPN 硬件加速']),
						' 查看 L2TP / PPTP 硬件槽位、拨号工具自检与硬件加密引擎状态。'
					])
				]),
			q.card('千兆网口 802.3az EEE 节能',
				eeeEnabledCnt > 0
					? q.badge(eeeActiveCnt > 0 ? '低功耗运行中' : '已开启', 'good')
					: q.badge('默认关闭', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						eeePorts.length
							? (eeeEnabledCnt + ' / ' + eeePorts.length + ' 口已开启')
							: '不支持'
					]),
					E('p', { class: 'rq-note' }, [eeeSummary])
				]),
			q.card('IPTV 硬件组播复制',
				txOffload.mcast_hw ? q.badge('已开启', 'good') : q.badge('未开启', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						txOffload.mcast_hw ? 'MDB 自动同步硬件' : '纯网桥转发'
					]),
					E('p', { class: 'rq-note' }, [
						'需配合 ',
						E('a', { href: L.url('admin/onu/iptv') }, ['ONU → IPTV 与组播']),
						' 中的 IGMP Snooping 使用。'
					])
				]),
			q.card('实验性底层硬件转发',
				(txOffload.napt6 || txOffload.dual_hdr) ? q.badge('已开启', 'warn') : q.badge('默认关闭', 'good'),
				[
					E('div', { class: 'rq-kpi' }, [
						'NAT66 ' + (txOffload.napt6 ? '开' : '关') + ' · 双头隧道 ' + (txOffload.dual_hdr ? '开' : '关')
					]),
					E('p', { class: 'rq-note' }, [
						'日常普通宽带上网与 PPPoE 转发已默认全速硬件卸载，以下实验项无特殊需求请保持关闭。'
					])
				])
		])
	]);
}

return view.extend({
	load: function() {
		return uci.load('rtl9617c_qos');
	},

	render: function() {
		var liveMount = E('div');
		var m = new form.Map('rtl9617c_qos', null, null);

		var sg = m.section(form.NamedSection, 'global', 'global', '硬件加速与芯片卸载设置');
		sg.anonymous = true;
		sg.addremove = false;

		sg.tab('offload', '网卡发包与组播加速');
		sg.tab('experimental', '实验性底层特性（仅供开发/测试）');

		var o;
		o = sg.taboption('offload', form.Flag, 'tx_csum', '启用网口硬件发包校验和卸载 (TX CSUM)',
			'由 RTL9617C DMA LSO 硬件引擎自动计算发出数据包的 TCP/UDP 校验和，降低路由器本机高速发包时的 CPU 占用。');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'tso', '启用 IPv4 TCP 大包硬件分段加速 (DMA LSO / TSO)',
			'允许内核直接把超长 TCP 数据块交给网卡 DMA 引擎自动切分为标准以太网帧发送（已内置 GRO 超长包安全回退）。');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'tso_v6', '同时启用 IPv6 TCP 硬件分段加速 (TSO6)',
			'在开启 TCP 硬件分段加速时，同时对 IPv6 TCP 流量启用硬件分段。');
		o.depends('tso', '1');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'rx_zerocopy', '启用网卡零拷贝收包 (page_pool + napi_build_skb)',
			'默认开启。对大于 128 字节的数据包直接使用 page_pool 零拷贝构建 skb，消除 CPU 收包整包 memcpy（支持运行期热切换，方便 A/B 对比）。');
		o.default = '1';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'ge_eee', '启用千兆 LAN 口 802.3az EEE 节能以太网 (LAN2 ~ LAN4)',
			'开启后，千兆网口 LAN2 ~ LAN4 在链路空闲时自动进入低功耗空闲态 (LPI) 降低整机发热量；若个别老旧网卡唤醒偶发抖动可关闭。');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'mcast_hw', '启用 IPTV 硬件组播复制加速',
			'当网桥收到 IGMP Snooping 组播订阅 (MDB) 时，自动将组播端口掩码写入芯片 MCE 与 ARB MC FIB 硬件表。');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('experimental', form.Flag, 'napt6', '启用 IPv6 硬件 NAT66 地址转换加速',
			'开启后会自动将芯片转发引擎热切换至 384-bit 动作表模式，对 IPv6 SNAT / MASQUERADE / DNAT 连接启用硬件地址转换卸载（免重启即时生效）。普通公网 IPv6 直通转发无需开启。');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('experimental', form.Flag, 'dual_hdr', '启用 DS-Lite / 6rd 硬件双头隧道卸载（实验性）',
			'允许芯片 L3PE 双头隧道引擎解析 DS-Lite 与 6rd 隧道流，当前完整装流动作依赖闭源 AAL，普通用户请保持关闭。');
		o.default = '0';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				'硬件加速与芯片卸载',
				'统一管理网卡 DMA LSO 发包加速、VPN 硬件卸载入口、IPTV 硬件组播复制及芯片底层实验性加速开关。',
				liveMount,
				function(next) {
					renderLiveOffload(liveMount, next);
				},
				formNode
			);
		});
	}
});
