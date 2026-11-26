'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';

var DOS_LABELS = {
	icmp_flood: _('ICMP Flood (massive ping request flooding)'),
	fin_flood: _('TCP FIN Flood (forged connection teardown packets)'),
	syn_flood: _('TCP SYN Flood (half-open connection table exhaustion)'),
	syn_with_data: _('TCP SYN with Payload (non-standard handshake attack)'),
	udp_bomb: _('UDP Bomb (malformed UDP length mismatching IP length)'),
	ping_of_death: _('Ping of Death (oversized fragmented ping > 65535 bytes)'),
	icmp_fragment: _('ICMP Fragment Attack (forged fragmented ICMP packet)'),
	tcp_frag_error: _('TCP Fragment Offset Error (malformed evasion fragment)'),
	tcp_short_hdr: _('TCP Short Header (corrupted header < 20 bytes)'),
	syn1024: _('Low-Port SYN Block (Warning: breaks WAN 80/443 SYN+ACK replies; off by default)'),
	null_scan: _('TCP NULL Stealth Scan (illegal probe with all flags zero)'),
	xma_scan: _('TCP Xmas Scan (malicious probe with FIN+URG+PSH set)'),
	syn_fin_scan: _('TCP SYN+FIN Scan (illegal packet with both SYN and FIN set)'),
	blat_attacks: _('Blat Same-Port Spoofing (source port equals destination port)'),
	land_attacks: _('LAND Loopback Attack (source IP equals destination IP)'),
	smac_eq_dmac: _('MAC Loopback Packet (source MAC equals destination MAC)')
};

function renderLiveDos(container, data) {
	var tf = (data && data.te_flow) || {};
	var dos = (data && data.dos) || {};
	var types = dos.types || [];
	var l3Active = 0;
	var l2Active = 0;

	var dosRows = types.map(function(t) {
		if (t.l3_en)
			l3Active++;
		if (t.l2_en)
			l2Active++;
		var thText = t.l3_th != null ? (parseInt(t.l3_th, 16) + ' (' + t.l3_th + ')') : _('Instant drop');
		var l3Badge = t.l3_en
			? (t.l3_act === 'trap' ? q.badge(_('Trap to CPU'), 'warn') : q.badge(_('HW Drop'), 'good'))
			: q.badge(_('Not enabled'), '');
		var l2Badge = t.l2_en
			? (t.l2_act === 'trap' ? q.badge(_('Trap to CPU'), 'warn') : q.badge(_('HW Drop'), 'good'))
			: q.badge(_('Not enabled'), '');
		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [String(t.idx)]),
			E('td', {}, [E('strong', {}, [DOS_LABELS[t.name] || t.name])]),
			E('td', { class: 'rq-mono' }, [t.name]),
			E('td', { class: 'rq-mono' }, [thText]),
			E('td', {}, [l3Badge]),
			E('td', {}, [l2Badge])
		]);
	});
	if (!dosRows.length) {
		dosRows.push(E('tr', {}, [
			E('td', { colspan: 6, class: 'rq-note' }, [_('Hardware DoS protection table is not available yet.')])
		]));
	}

	var totalTypes = types.length || 16;
	var activeCount = Math.max(l3Active, l2Active);
	var l3Mask = dos.l3_port_mask || '0x0000000000000000';
	var l2Mask = dos.l2_port_mask || '0x0000000000000000';
	var maskArmed = (l3Mask !== '0x0000000000000000' || l2Mask !== '0x0000000000000000');
	var hwActive = activeCount > 0 && maskArmed;

	dom.content(container, [
		q.guideCard(_('How to Use (Hardware-Level Automatic DoS Protection)'), [
			_('1. During port scans, SYN/ICMP floods, or malformed packet attacks, software firewalls on traditional routers can max out the CPU and drop connectivity. With this master switch enabled, the RTL9617C ASIC inspects and drops all 16 attack types at the physical port front-end with 0% CPU usage.'),
			_('2. Recommended setup: check "Enable Hardware Automatic DoS Blocking" below and click "Save & Apply". Safe default flood thresholds (ICMP 1000 / SYN 2000 / FIN 2000) and zero-CPU hardware drop on physical ports (excluding CPU ports) are configured automatically.'),
			_('3. If false positives occur during speed tests, LAN scanning, or NAT traversal, exempt individual checks under "Exempted (Disabled) Attack Types" or raise the flood rate thresholds.')
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Hardware DoS Engine & Active Ports'),
				hwActive ? q.badge(_('Zero-CPU HW Drop Active'), 'good') : q.badge(_('Inactive'), ''),
				[
					E('div', { class: 'rq-kpi' }, [
						hwActive ? _('Physical Ports Armed (Drop)') : _('Unarmed')
					]),
					E('p', { class: 'rq-note' }, [
						_('L3 port mask: %s · L2 port mask: %s · Flood window registers: L3=%d / L2=%d.').format(
							l3Mask,
							l2Mask,
							dos.l3_flood_count != null ? dos.l3_flood_count : 1018,
							dos.l2_flood_count != null ? dos.l2_flood_count : 255
						)
					])
				]),
			q.card(_('16 Attack Protection Rules Status'),
				hwActive
					? q.badge(_('%d / %d enabled').format(activeCount, totalTypes), 'good')
					: q.badge(_('All disabled'), ''),
				[
					E('div', { class: 'rq-kpi' }, [
						_('L3 %d / %d · L2 %d / %d').format(l3Active, totalTypes, l2Active, totalTypes)
					]),
					E('p', { class: 'rq-note' }, [
						_('Enables 15 safe flood & malformed packet checks (hardware drop) by default, keeping syn1024 off to avoid breaking HTTP/HTTPS replies. Exempt individual rules below as needed.')
					])
				])
		]),
		q.card(_('Hardware Protection Details for 16 Network Attacks & Malformed Packets'),
			hwActive ? q.badge(_('Protection Active'), 'good') : q.badge(_('Inactive'), ''),
			[
				E('div', { class: 'rq-table-wrap' }, [
					E('table', { class: 'rq-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, [_('#')]),
								E('th', {}, [_('Attack / Malformed Packet Type')]),
								E('th', {}, [_('Hardware Signature ID')]),
								E('th', {}, [_('Threshold')]),
								E('th', {}, [_('L3 Routing Protection')]),
								E('th', {}, [_('L2 Bridging Protection')])
							])
						]),
						E('tbody', {}, dosRows)
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

		var sg = m.section(form.NamedSection, 'global', 'global', _('Hardware DoS Protection Settings'));
		sg.anonymous = true;
		sg.addremove = false;

		var o;
		o = sg.option(form.Flag, 'dos_enabled', _('Enable Hardware Automatic DoS Blocking'),
			_('When enabled, the RTL9617C forwarding ASIC automatically blocks the 16 attack and malformed packet types listed above (ICMP/SYN/FIN floods, Ping of Death, UDP bomb, stealth port scans, etc.) directly in hardware with zero CPU overhead.'));
		o.rmempty = false;
		o.default = '0';

		o = sg.option(form.Value, 'dos_icmp_th', _('ICMP Flood Trigger Threshold (1 ~ 65535)'),
			_('Hardware packet-rate threshold for Ping (ICMP) flood blocking (leave blank for default 1000 to avoid dropping normal pings).'));
		o.depends('dos_enabled', '1');
		o.datatype = 'range(1,65535)';
		o.placeholder = _('Default 1000');
		o.rmempty = true;

		o = sg.option(form.Value, 'dos_syn_th', _('TCP SYN Flood Trigger Threshold (1 ~ 65535)'),
			_('Hardware packet-rate threshold for TCP SYN half-open flood blocking (leave blank for default 2000 to avoid blocking normal connections).'));
		o.depends('dos_enabled', '1');
		o.datatype = 'range(1,65535)';
		o.placeholder = _('Default 2000');
		o.rmempty = true;

		o = sg.option(form.Value, 'dos_fin_th', _('TCP FIN Flood Trigger Threshold (1 ~ 65535)'),
			_('Hardware packet-rate threshold for TCP FIN flood blocking (leave blank for default 2000 to avoid blocking normal disconnects).'));
		o.depends('dos_enabled', '1');
		o.datatype = 'range(1,65535)';
		o.placeholder = _('Default 2000');
		o.rmempty = true;

		o = sg.option(form.MultiValue, 'dos_disabled_types', _('Exempted (Disabled) Attack Types'),
			_('15 safe protection rules are enabled by default (excluding syn1024, which blocks 80/443 replies). Select any rule here to disable it individually if false positives occur.'));
		o.depends('dos_enabled', '1');
		o.rmempty = true;
		Object.keys(DOS_LABELS).forEach(function(k) {
			if (k !== 'syn1024')
				o.value(k, DOS_LABELS[k]);
		});

		o = sg.option(form.Flag, 'dos_allow_syn1024', _('Force-Enable Low-Port SYN Block (syn1024)'),
			_('Warning: This hardware rule matches all TCP packets with source port < 1024 and SYN flag set, which drops normal SYN+ACK replies from WAN HTTP/HTTPS/DNS (80/443/53) servers and breaks web browsing! Keep disabled unless in a special LAN-only environment.'));
		o.depends('dos_enabled', '1');
		o.default = '0';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				_('Hardware DoS Protection'),
				_('Manage RTL9617C chip-level automatic blocking for 16 attack & malformed packet types, flood thresholds, and per-type exemptions.'),
				liveMount,
				function(next) {
					renderLiveDos(liveMount, next);
				},
				formNode
			);
		});
	}
});
