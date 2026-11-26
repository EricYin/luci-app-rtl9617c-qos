'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';
'require rtl9617c-qos.pe_hook as peHook';

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
		? q.badge(_('Param On · NIC Inactive'), 'warn')
		: (nicActive ? q.badge(_('Active on NIC'), 'good') : q.badge(_('Not enabled'), ''));

	var txDetails = [
		_('Module params: CSUM %s · TSO %s · TSO6 %s').format(
			txOffload.tx_csum ? _('On') : _('Off'),
			txOffload.tso ? _('On') : _('Off'),
			txOffload.tso_v6 ? _('On') : _('Off')
		)
	];
	if (nic) {
		txDetails.push(
			_('NIC live (%s): TX-CSUM %s · SG %s · TSO %s · TSO6 %s · GSO %s').format(
				nic.device,
				nic.tx_csum ? 'on' : 'off',
				nic.sg ? 'on' : 'off',
				nic.tso ? 'on' : 'off',
				nic.tso_v6 ? 'on' : 'off',
				nic.gso ? 'on' : 'off'
			)
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
				(p.eee.enabled ? (p.eee.active ? _('LPI Active') : _('On')) : _('Off'));
		}).join(' · ')
		: _('No EEE-capable Gigabit ports (LAN2–LAN4) detected yet.');

	dom.content(container, [
		q.guideCard(_('What Is This? (Hardware Acceleration & Silicon Offload)'), [
			_('1. Centrally manage low-level RTL9617C NIC and forwarding ASIC offload features, kept separate from QoS shaping and queueing.'),
			_('2. "Host TX Offload (DMA LSO)" accelerates heavy local router uploads (such as Samba, web server, proxy, or iperf3 server on the router) by offloading checksumming and TCP segmentation to DMA LSO hardware; the status card verifies live ethtool NIC flags.'),
			_('3. "Zero-Copy RX (page_pool)" eliminates full-packet CPU memcpy on receive to lower CPU usage for non-offloaded flows (proxy/VPN/Wi-Fi bridging); "Multi-Core RX Steering" pins NI IRQs and distributes PON & LAN receive across CPU cores with RPS+RFS.'),
			_('4. "VPN Hardware Offload (L2TP / PPTP)" uses the L3PE dual-header ASIC to offload plaintext L2TPv2 and PPTP; "IPTV Hardware Multicast Replication" and "GbE 802.3az EEE Power Saving" can be enabled on demand.')
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Host TX Offload (DMA LSO)'), txBadge, [
				E('div', { class: 'rq-kpi' }, [
					nicActive ? _('Hardware Offload Active') : (paramActive ? _('Awaiting NIC Sync') : _('Not enabled (software)'))
				]),
				E('p', { class: 'rq-note' }, [txDetails.join(' ｜ ')])
			]),
			q.card(_('Zero-Copy RX (page_pool RX)'),
				txOffload.rx_zerocopy ? q.badge(_('Enabled'), 'good') : q.badge(_('Disabled'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						txOffload.rx_zerocopy ? _('Zero-Copy + 128B Fast Copybreak') : _('Legacy Copy Mode')
					]),
					E('p', { class: 'rq-note' }, [
						rxStats
							? _('Zero-copy pkts: %s · Small-pkt copybreak: %s · Alloc fallback: %s').format(
								fmtCount(zcPkts),
								fmtCount(cbPkts),
								fmtCount(fbPkts)
							)
							: _('Waiting for NIC counters (driver uses page_pool + napi_build_skb).')
					])
				]),
			q.card(_('Multi-Core RX Steering (IRQ / RPS / RFS)'),
				(ponMulti && rfsOk) ? q.badge(_('Multi-Core + RFS'), 'good') : q.badge(_('Default Scheduling'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('NI IRQ: CPU%s · RFS %s').format(
							steer.irq_cpu != null ? steer.irq_cpu : '-',
							rfsOk ? String(steer.rfs_global) : _('Off')
						)
					]),
					E('p', { class: 'rq-note' }, [
						_('LAN RPS: 0x%s · PON RPS: 0x%s · Queue flow entries: %s').format(
							lanSteer ? lanSteer.rps_cpus : '0',
							ponSteer ? ponSteer.rps_cpus : '0',
							ponSteer ? String(ponSteer.rps_flow_cnt) : '0'
						)
					])
				]),
			q.card(_('VPN Hardware Tunnel Offload (L2TP / PPTP)'),
				txOffload.vpn_offload ? q.badge(_('Enabled'), 'good') : q.badge(_('Disabled'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						txOffload.vpn_offload
							? _('Active slots %d/16').format(tun.control_used || 0)
							: _('Disabled (software forwarding)')
					]),
					E('p', { class: 'rq-note' }, [
						_('Go to'), ' ',
						E('a', { href: L.url('admin/network/rtl9617c_vpn') }, [_('Network → VPN Hardware Offload')]),
						' ', _('to view L2TP / PPTP hardware slots, dialer diagnostics, and crypto engine status.')
					])
				]),
			q.card(_('GbE 802.3az EEE Power Saving'),
				eeeEnabledCnt > 0
					? q.badge(eeeActiveCnt > 0 ? _('Low-Power Active') : _('Enabled'), 'good')
					: q.badge(_('Off by Default'), ''),
				[
					E('div', { class: 'rq-kpi' }, [
						eeePorts.length
							? _('%d / %d ports enabled').format(eeeEnabledCnt, eeePorts.length)
							: _('Unsupported')
					]),
					E('p', { class: 'rq-note' }, [eeeSummary])
				]),
			q.card(_('IPTV Hardware Multicast Replication'),
				txOffload.mcast_hw ? q.badge(_('Enabled'), 'good') : q.badge(_('Not enabled'), ''),
				[
					E('div', { class: 'rq-kpi' }, [
						txOffload.mcast_hw ? _('MDB Auto-Synced to Hardware') : _('Bridge Software Forwarding')
					]),
					E('p', { class: 'rq-note' }, [
						_('Requires IGMP Snooping enabled in:'), ' ',
						E('a', { href: L.url('admin/onu/iptv') }, [_('ONU → IPTV & Multicast')])
					])
				]),
			q.card(_('Experimental Low-Level Hardware Offload'),
				(txOffload.napt6 || txOffload.dual_hdr) ? q.badge(_('Enabled'), 'warn') : q.badge(_('Off by Default'), 'good'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('NAT66 %s · Dual-Header %s').format(
							txOffload.napt6 ? _('On') : _('Off'),
							txOffload.dual_hdr ? _('On') : _('Off')
						)
					]),
					E('p', { class: 'rq-note' }, [
						_('Standard broadband routing and PPPoE forwarding are already hardware-offloaded at line rate. Leave experimental options off unless needed.')
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

		var sg = m.section(form.NamedSection, 'global', 'global', _('Hardware Offload & Silicon Acceleration Settings'));
		sg.anonymous = true;
		sg.addremove = false;

		sg.tab('offload', _('NIC TX/RX & Multicast Offload'));
		sg.tab('experimental', _('Experimental Low-Level Features (Dev/Test Only)'));

		var o;
		o = sg.taboption('offload', form.Flag, 'tx_csum', _('Enable Hardware TX Checksum Offload (TX CSUM)'),
			_('Offloads outbound TCP/UDP checksum calculation to the RTL9617C DMA LSO engine, reducing CPU usage during high-speed router-originated transmissions.'));
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'tso', _('Enable IPv4 TCP Segmentation Offload (DMA LSO / TSO)'),
			_('Allows the kernel to pass large TCP segments to the NIC DMA engine for hardware segmentation into Ethernet frames (with built-in safe fallback for oversized GRO packets).'));
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'tso_v6', _('Also Enable IPv6 TCP Segmentation Offload (TSO6)'),
			_('Enables hardware TCP segmentation offload for IPv6 TCP traffic as well when TSO is enabled.'));
		o.depends('tso', '1');
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'rx_zerocopy', _('Enable Zero-Copy NIC Receive (page_pool + napi_build_skb)'),
			_('Enabled by default. Builds skbs directly from page_pool buffers for packets > 128 bytes to eliminate full-packet CPU memcpy (hot-toggleable at runtime for A/B testing).'));
		o.default = '1';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'ge_eee', _('Enable GbE LAN 802.3az EEE Power Saving (LAN2–LAN4)'),
			_('Allows Gigabit ports LAN2–LAN4 to enter Low-Power Idle (LPI) when idle to reduce heat; disable if an older NIC exhibits wake-up jitter.'));
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('offload', form.Flag, 'mcast_hw', _('Enable IPTV Hardware Multicast Replication'),
			_('Automatically programs IGMP Snooping bridge multicast subscriptions (MDB) into the ASIC MCE and ARB MC FIB hardware tables.'));
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('experimental', form.Flag, 'napt6', _('Enable IPv6 Hardware NAT66 Offload'),
			_('Hot-switches the forwarding engine to 384-bit action mode to offload IPv6 SNAT / MASQUERADE / DNAT connections (takes effect without reboot). Not needed for standard public IPv6 routing.'));
		o.default = '0';
		o.rmempty = false;

		o = sg.taboption('experimental', form.Flag, 'dual_hdr', _('Enable DS-Lite / 6rd Hardware Dual-Header Tunnel Offload (Experimental)'),
			_('Allows the L3PE dual-header ASIC to parse DS-Lite and 6rd tunnel flows; full flow installation currently depends on proprietary AAL. Keep off for normal use.'));
		o.default = '0';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			var peMount = E('div');
			var refreshPe = peHook.mount(peMount, [ 'mcast' ], _('PE Coprocessor Summary & Multicast Offload'), true);
			var combinedLive = E('div', {}, [ liveMount, peMount ]);
			return q.setupLivePage(
				_('Hardware Acceleration & Silicon Offload'),
				_('Manage NIC DMA LSO TX offload, VPN hardware offload entry, IPTV hardware multicast replication, and experimental ASIC acceleration switches.'),
				combinedLive,
				function(next) {
					renderLiveOffload(liveMount, next);
					refreshPe();
				},
				formNode
			);
		});
	}
});
