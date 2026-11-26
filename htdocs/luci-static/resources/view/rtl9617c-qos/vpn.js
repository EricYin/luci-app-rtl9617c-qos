'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';
'require rtl9617c-qos.pe_hook as peHook';

function makeTable(headers, rows, emptyText) {
	if (!rows.length) {
		return E('p', { class: 'rq-note' }, [emptyText]);
	}
	return E('div', { class: 'rq-table-wrap' }, [
		E('table', { class: 'rq-table' }, [
			E('thead', {}, [
				E('tr', {}, headers.map(function(h) { return E('th', {}, [h]); }))
			]),
			E('tbody', {}, rows)
		])
	]);
}

function renderLiveVpn(container, data) {
	var vpn = (data && data.vpn) || {};
	var tun = vpn.tunnel || {};
	var kmods = vpn.kmods || [];
	var tools = vpn.tools || [];
	var ifaces = vpn.interfaces || [];
	var crypto = vpn.crypto || {};

	var kmodReady = kmods.filter(function(m) { return m.loaded; }).length;
	var toolReady = tools.filter(function(t) { return t.present; }).length;
	var upIfaces = ifaces.filter(function(i) { return i.up; }).length;
	var xl2tpd = tools.filter(function(t) { return t.name === 'xl2tpd'; })[0];

	var slotRows = [];
	(tun.control_items || []).forEach(function(item) {
		slotRows.push(E('tr', {}, [
			E('td', {}, ['Control #' + item.idx]),
			E('td', {}, [q.badge(String(item.type_name || item.type_id).toUpperCase(), 'good')]),
			E('td', {}, [String(item.owner)]),
			E('td', { class: 'rq-mono rq-wrap' }, [item.raw || '—'])
		]));
	});
	(tun.content_items || []).forEach(function(item) {
		slotRows.push(E('tr', {}, [
			E('td', {}, ['Content #' + item.idx]),
			E('td', {}, [q.badge(String(item.type_name || item.type_id).toUpperCase(), 'good')]),
			E('td', {}, [String(item.owner)]),
			E('td', { class: 'rq-mono rq-wrap' }, [item.raw || '—'])
		]));
	});
	(tun.eif_items || []).forEach(function(item) {
		slotRows.push(E('tr', {}, [
			E('td', {}, ['EIF Hash #' + item.hash + ' → Phys #' + item.phys]),
			E('td', {}, [q.badge(_('%d flow refs').format(item.refs), 'good')]),
			E('td', {}, ['FE']),
			E('td', { class: 'rq-mono' }, ['param=0x' + item.param])
		]));
	});

	var envRows = [];
	kmods.forEach(function(m) {
		envRows.push(E('tr', {}, [
			E('td', { class: 'rq-mono' }, [m.name]),
			E('td', {}, [_('Kernel Module')]),
			E('td', {}, [m.loaded ? q.badge(_('Loaded (ref %d)').format(m.refcnt), 'good') : q.badge(_('Not loaded'), 'warn')]),
			E('td', { class: 'rq-wrap' }, [m.role ? _(m.role) : '—'])
		]));
	});
	tools.forEach(function(t) {
		var statusBadge;
		if (!t.present)
			statusBadge = q.badge(_('Missing'), 'danger');
		else if (t.running === true)
			statusBadge = q.badge(_('Ready · Running'), 'good');
		else if (t.running === false)
			statusBadge = q.badge(_('Installed · Standby'), 'good');
		else
			statusBadge = q.badge(_('Installed'), 'good');
		envRows.push(E('tr', {}, [
			E('td', { class: 'rq-mono' }, [t.name]),
			E('td', {}, [_('Userspace Tool')]),
			E('td', {}, [statusBadge]),
			E('td', { class: 'rq-wrap' }, [(t.role ? _(t.role) : '') + ' (' + (t.path || '') + ')'])
		]));
	});

	var ifaceRows = ifaces.map(function(i) {
		return E('tr', {}, [
			E('td', {}, [i.name]),
			E('td', {}, [String(i.proto || '').toUpperCase()]),
			E('td', { class: 'rq-mono' }, [i.server || '—']),
			E('td', { class: 'rq-mono' }, [i.netdev || '—']),
			E('td', {}, [
				i.disabled ? q.badge(_('Disabled'), '') :
				i.up ? q.badge(_('Connected (%s)').format(i.operstate), 'good') : q.badge(_('Disconnected'), 'warn')
			])
		]);
	});

	var bestByAlgo = {};
	(crypto.algos || []).forEach(function(a) {
		if (a.selftest === 'passed' && (bestByAlgo[a.name] == null || a.priority > bestByAlgo[a.name]))
			bestByAlgo[a.name] = a.priority;
	});
	var cryptoRows = (crypto.algos || []).map(function(a) {
		var isDefault = a.selftest === 'passed' && bestByAlgo[a.name] === a.priority;
		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [a.name]),
			E('td', { class: 'rq-mono' }, [a.driver]),
			E('td', {}, [a.hw_engine ? q.badge(_('On-Chip HW Engine'), 'good') : q.badge('CPU ARMv8 CE', '')]),
			E('td', {}, [String(a.priority)]),
			E('td', {}, [
				a.selftest === 'passed'
					? q.badge(isDefault ? _('Passed · Kernel Default') : _('Passed · Fallback'), isDefault ? 'good' : '')
					: q.badge(a.selftest || _('unknown'), 'warn')
			])
		]);
	});

	dom.content(container, [
		q.guideCard(_('What Is This? (RTL9617C VPN Hardware Offload & Crypto Engine)'), [
			_('1. With "L2TPv2 / PPTP Hardware Offload" enabled, plaintext PPP-encapsulated L2TPv2 (UDP 1701) and PPTP (GREv1) data planes are encapsulated/decapsulated directly by the RTL9617C L3PE dual-header tunnel ASIC, sharply reducing CPU usage.'),
			_('2. If a tunnel negotiates MPPE encryption, CCP compression, VJ compression, or IPsec encapsulation, the kernel safely falls back to software processing without affecting connectivity.'),
			_('3. The router includes l2tp_ppp and pptp kernel modules plus xl2tpd/pppd plugins; once you add and connect an L2TP or PPTP client interface under Network → Interfaces, ASIC slot allocations and flow references appear here automatically.'),
			_('4. The on-chip crypto engine 90500000.crypto (100 MHz) passes self-tests and registers at prio=150; because Cortex-A55 includes ARMv8 CE instructions (prio=300, >2.6 Gbps single-core AES-GCM), the kernel prefers the faster CPU crypto instructions by default.')
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('L2TP / PPTP ASIC Offload'),
				vpn.vpn_offload
					? q.badge(tun.ready ? _('Enabled · Engine Ready') : _('Enabled'), 'good')
					: q.badge(_('Disabled'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						'Control ' + (tun.control_used || 0) + '/' + (tun.control_max || 16) +
						' · Content ' + (tun.content_used || 0) + '/' + (tun.content_max || 16)
					]),
					q.meterBar((tun.control_used || 0) + (tun.content_used || 0), (tun.control_max || 16) + (tun.content_max || 16), true),
					E('p', { class: 'rq-note' }, [
						_('L2TP slots: %d · PPTP slots: %d · EIF active flow refs: %d · Clear on free: %s').format(
							tun.l2tp_slots || 0,
							tun.pptp_slots || 0,
							tun.eif_refs || 0,
							vpn.clear_on_free ? _('On') : _('Off')
						)
					])
				]),
			q.card(_('Kernel Modules & Dialer Tools'),
				(kmodReady === kmods.length && toolReady === tools.length)
					? q.badge(_('All Ready'), 'good')
					: q.badge(_('Partially Missing'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('Modules %d/%d · Tools %d/%d').format(kmodReady, kmods.length, toolReady, tools.length)
					]),
					E('p', { class: 'rq-note' }, [
						_('xl2tpd status: %s').format(!xl2tpd || !xl2tpd.present ? _('Not installed') : (xl2tpd.running ? _('Running') : _('Installed (on-demand)')))
					])
				]),
			q.card(_('Configured VPN Dialer Interfaces'),
				upIfaces > 0 ? q.badge(_('%d online').format(upIfaces), 'good')
					: (ifaces.length > 0 ? q.badge(_('All Disconnected'), 'warn') : q.badge(_('Not configured'), '')),
				[
					E('div', { class: 'rq-kpi' }, [
						ifaces.length > 0 ? _('%d / %d connected').format(upIfaces, ifaces.length) : _('0 interfaces')
					]),
					E('p', { class: 'rq-note' }, [
						_('Go to'), ' ',
						E('a', { href: L.url('admin/network/network') }, [_('Network → Interfaces')]),
						' ', _('to add an L2TP or PPTP interface; hardware offload activates automatically.')
					])
				]),
			q.card(_('On-Chip Crypto Engine (90500000.crypto)'),
				(crypto.available && crypto.rtk_passed > 0)
					? q.badge(_('Self-test passed (%d/%d)').format(crypto.rtk_passed, crypto.rtk_total), 'good')
					: q.badge(_('Not ready'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						(crypto.clk_mhz != null ? crypto.clk_mhz + ' MHz' : '—') +
						' · IRQ ' + (crypto.irqs || 0)
					]),
					E('p', { class: 'rq-note' }, [
						_('Priority 150 (fallback); IPsec/TLS defaults to faster CPU ARMv8 CE (priority 300).')
					])
				])
		]),
		q.card(_('Live L3PE Dual-Header Tunnel Hardware Slots'),
			slotRows.length ? q.badge(_('%d active hardware entries').format(slotRows.length), 'good') : q.badge(_('Idle (no active tunnels)'), ''),
			[
				makeTable(
					[_('Hardware Slot'), _('Type / Refs'), _('Owner'), _('Hardware Register Readback / Params')],
					slotRows,
					_('No active L2TP / PPTP hardware offload slots. Once a plaintext L2TPv2 or PPTP tunnel connects and forwards traffic, allocated Control / Content / EIF slots appear here in real time.')
				)
			]),
		q.card(_('Configured L2TP / PPTP Interfaces'),
			ifaces.length ? q.badge(_('%d interfaces').format(ifaces.length), 'good') : q.badge(_('Not configured'), ''),
			[
				makeTable(
					[_('Interface'), _('Protocol'), _('Peer Server'), _('System Netdev'), _('Connection Status')],
					ifaceRows,
					_('No L2TP or PPTP interfaces configured in /etc/config/network yet. Go to Network → Interfaces to add one with the L2TP or PPTP protocol.')
				)
			]),
		q.card(_('VPN Kernel Modules & Userspace Dialer Self-Check'),
			q.badge(_('Live Check'), ''),
			[
				makeTable(
					[_('Component'), _('Category'), _('Status'), _('Description / Path')],
					envRows,
					_('Unable to read module and tool status.')
				)
			]),
		q.card(_('Crypto Algorithm Priority Comparison (On-Chip HW Engine vs CPU ARMv8 CE)'),
			q.badge('/proc/crypto', ''),
			[
				makeTable(
					[_('Algorithm'), _('Driver'), _('Execution Unit'), _('Priority'), _('Self-Test & Selection')],
					cryptoRows,
					_('Unable to read /proc/crypto algorithm list.')
				)
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

		var sg = m.section(form.NamedSection, 'global', 'global', _('VPN Hardware Offload Switch'));
		sg.anonymous = true;
		sg.addremove = false;

		var o = sg.option(form.Flag, 'vpn_offload', _('Enable L2TPv2 / PPTP ASIC Tunnel Hardware Offload'),
			_('Maps to kernel module parameter /sys/module/rtl9617c_ni/parameters/vpn_offload. Offloads plaintext L2TPv2 (UDP/1701) and PPTP (GREv1) flows on the RTL9617C L3PE dual-header ASIC; encrypted/compressed tunnels automatically fall back to software.'));
		o.default = '1';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			var peMount = E('div');
			var refreshPe = peHook.mount(peMount, [ 'ipsec', 'srv6' ], _('PE Coprocessor Tunnel & Crypto Offload (Non-Exclusive)'), false);
			var combinedLive = E('div', {}, [ liveMount, peMount ]);
			return q.setupLivePage(
				_('VPN Hardware Offload & Crypto Engine'),
				_('Centrally manage RTL9617C L2TPv2 / PPTP ASIC tunnel offload, dialer stack diagnostics, and on-chip crypto engine status.'),
				combinedLive,
				function(next) {
					renderLiveVpn(liveMount, next);
					refreshPe();
				},
				formNode
			);
		});
	}
});
