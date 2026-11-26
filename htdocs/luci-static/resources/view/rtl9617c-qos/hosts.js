'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require ui';
'require rtl9617c-qos.common as q';

function computeRates(next, prev) {
	var out = {};
	if (!next || !prev || !next.hostpol || !prev.hostpol)
		return out;
	var dtMs = Number(next.uptime_ms || 0) - Number(prev.uptime_ms || 0);
	if (!isFinite(dtMs) || dtMs <= 0)
		dtMs = (Number(next.queried_at || 0) - Number(prev.queried_at || 0)) * 1000;
	if (!isFinite(dtMs) || dtMs <= 0)
		return out;

	var prevMap = {};
	(prev.hostpol.items || []).forEach(function(item) {
		prevMap[item.mac] = item;
	});

	(next.hostpol.items || []).forEach(function(item) {
		var old = prevMap[item.mac];
		if (!old)
			return;
		var dRx = Number(item.rx_bytes || 0) - Number(old.rx_bytes || 0);
		var dTx = Number(item.tx_bytes || 0) - Number(old.tx_bytes || 0);
		out[item.mac] = {
			in_bps: dRx >= 0 ? (dRx * 8000 / dtMs) : 0,
			out_bps: dTx >= 0 ? (dTx * 8000 / dtMs) : 0
		};
	});
	return out;
}

function renderLiveHosts(container, data, prevData, hints) {
	var hp = (data && data.hostpol) || {};
	var fe = (data && data.fe_summary) || {};
	var rates = computeRates(data, prevData);
	var items = hp.items || [];

	var nameByMac = {};
	uci.sections('rtl9617c_qos', 'host', function(s) {
		if (s.mac)
			nameByMac[String(s.mac).toLowerCase()] = s.name || '';
	});

	var rows = items.map(function(item) {
		var mac = String(item.mac || '').toLowerCase();
		var hint = hints[mac];
		var label = nameByMac[mac] || (hint && hint.name) || _('Unnamed Device');
		var ipText = (hint && hint.ips && hint.ips.length) ? hint.ips[0] : '';
		var r = rates[mac] || {};

		var clearBtn = L.hasViewPermission() ? E('button', {
			type: 'button',
			class: 'btn cbi-button',
			click: function() {
				clearBtn.disabled = true;
				q.callClearHostMib(mac).then(function() {
					clearBtn.disabled = false;
					ui.addNotification(null, E('p', {}, [_('Cleared cumulative traffic counters for device %s.').format(mac)]), 'info');
				}).catch(function(err) {
					clearBtn.disabled = false;
					ui.addNotification(null, E('p', {}, [_('Clear failed: %s').format(err.message || String(err))]), 'error');
				});
			}
		}, [_('Clear Traffic')]) : '—';

		var inMode = item.ingress_vm >= 0 ? _('Policer %d').format(item.ingress_vm) : _('Stats only');
		var outMode = item.egress_vm >= 0 ? _('Policer %d').format(item.egress_vm) : _('Stats only');

		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [String(item.idx)]),
			E('td', {}, [
				E('strong', {}, [label]),
				ipText ? E('div', { class: 'rq-note', style: 'margin:2px 0 0' }, [ipText]) : null
			]),
			E('td', { class: 'rq-mono' }, [mac]),
			E('td', {}, [q.formatKbpsLimit(item.ingress_kbps)]),
			E('td', {}, [q.formatKbpsLimit(item.egress_kbps)]),
			E('td', { class: 'rq-mono' }, [
				_('UL #%d (%s) / DL #%d (%s)').format(item.ingress_pol1, inMode, item.egress_pol1, outMode)
			]),
			E('td', { class: 'rq-mono' }, [q.formatBps(r.in_bps != null ? r.in_bps : 0)]),
			E('td', { class: 'rq-mono' }, [q.formatBps(r.out_bps != null ? r.out_bps : 0)]),
			E('td', { class: 'rq-mono' }, [
				'↑ ' + q.formatBytes(item.rx_bytes) + ' / ↓ ' + q.formatBytes(item.tx_bytes)
			]),
			E('td', {}, [clearBtn])
		]);
	});

	if (!rows.length) {
		rows.push(E('tr', {}, [
			E('td', { colspan: 10, class: 'rq-note' }, [
				_('No active per-device rate limiting or traffic monitoring rules yet. Click "Add" under "Per-Device Rate Limiting Rules" below, choose a LAN device, and click "Save & Apply".')
			])
		]));
	}

	var clearAllBtn = (L.hasViewPermission() && items.length > 0) ? E('button', {
		type: 'button',
		class: 'btn cbi-button',
		click: function() {
			clearAllBtn.disabled = true;
			q.callClearHostMib('').then(function() {
				clearAllBtn.disabled = false;
				ui.addNotification(null, E('p', {}, [_('Cleared cumulative traffic counters for all devices.')]), 'info');
			}).catch(function(err) {
				clearAllBtn.disabled = false;
				ui.addNotification(null, E('p', {}, [_('Clear failed: %s').format(err.message || String(err))]), 'error');
			});
		}
	}, [_('Clear All Traffic')]) : null;

	dom.content(container, [
		q.guideCard(_('How to Use (Per-Device Rate Limiting & Traffic Monitoring)'), [
			_('1. Click "Add" under "Per-Device Rate Limiting Rules" below and select your phone, PC, or TV from the "Device MAC Address" dropdown.'),
			_('2. Speed unit conversion: 1000 kbps ≈ 1 Mbps (e.g. 50000 for 50 Mbps, 100000 for 100 Mbps, 1000000 for 1000 Mbps).'),
			_('3. To monitor real-time speed and total traffic for a device without throttling it, set both "Upload Limit" and "Download Limit" to 0 (0 = unlimited, stats only).'),
			_('4. After editing rules, click "Save & Apply" (or "Apply Rules Now" at the top right). The ASIC takes over rate limiting and accounting immediately with zero CPU usage.')
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Monitored Devices'),
				hp.available ? q.badge(_('Hardware Engine Ready'), 'good') : q.badge(_('Driver Not Ready'), 'danger'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('%d / %d devices').format(hp.entries_used || 0, hp.entries_max || 32)
					]),
					q.meterBar(hp.entries_used || 0, hp.entries_max || 32),
					E('p', { class: 'rq-note' }, [
						_('Supports up to 32 LAN devices with independent rate limits or traffic counters (each device gets dedicated hardware upload and download accounting channels).')
					])
				]),
			q.card(_('Hardware Rate Limiters Used'),
				q.badge(_('32 total (UL + DL)'), (hp.vmeters_used || 0) >= 28 ? 'warn' : 'good'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('%d / %d used').format(hp.vmeters_used || 0, hp.vmeters_max || 32)
					]),
					q.meterBar(hp.vmeters_used || 0, hp.vmeters_max || 32),
					E('p', { class: 'rq-note' }, [
						_('Each non-zero upload or download limit consumes 1 hardware limiter; setting 0 (stats only, unlimited) does not consume a hardware limiter.')
					])
				]),
			q.card(_('Matched Hardware-Offloaded Flows'),
				q.badge(_('ASIC Line-Rate Forwarding'), (fe.pol_host || 0) > 0 ? 'good' : ''),
				q.activeFlowSummary(
					fe.pol_host || 0,
					fe.total || 0,
					_('Currently %d active hardware-offloaded flows (changing dynamically as connections open/age), of which %d are bound to per-device rate limiting/accounting channels (IPv4 & IPv6 bidirectional).').format(
						fe.total || 0,
						fe.pol_host || 0
					)
				))
		]),
		q.card(_('Active Device Rate Limits & Live Traffic'), clearAllBtn, [
			E('div', { class: 'rq-table-wrap' }, [
				E('table', { class: 'rq-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, [_('#')]),
							E('th', {}, [_('Device Name / IP')]),
							E('th', {}, [_('MAC Address')]),
							E('th', {}, [_('Upload Limit')]),
							E('th', {}, [_('Download Limit')]),
							E('th', {}, [_('Hardware Channels')]),
							E('th', {}, [_('Live Upload Speed')]),
							E('th', {}, [_('Live Download Speed')]),
							E('th', {}, [_('Total Upload / Download')]),
							E('th', {}, [_('Action')])
						])
					]),
					E('tbody', {}, rows)
				])
			])
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('rtl9617c_qos'),
			q.callHostHints()
		]);
	},

	render: function(loaded) {
		var hints = q.normalizeHints(loaded ? loaded[1] : {});
		var liveMount = E('div');

		var m = new form.Map('rtl9617c_qos', null, null);

		var sg = m.section(form.NamedSection, 'global', 'global', _('Master Service Switch'));
		sg.anonymous = true;
		sg.addremove = false;

		var en = sg.option(form.Flag, 'enabled', _('Enable Hardware QoS & Rate Limiting Service'),
			_('Global master switch: disabling pauses and removes all per-device rate limits, app priority rules, and port shaping rules from hardware.'));
		en.rmempty = false;
		en.default = '1';

		var s = m.section(form.GridSection, 'host', _('Per-Device Rate Limiting Rules (Add, Edit, Delete)'),
			_('Add LAN devices to configure independent max upload and download speeds (in kbps; 100000 = 100 Mbps). Set 0 for unlimited speed with hardware traffic statistics only.'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;

		var o;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = s.option(form.Value, 'name', _('Device Remark Name'));
		o.placeholder = _('e.g., Living Room TV / Study PC');
		o.rmempty = true;

		o = s.option(form.Value, 'mac', _('Device MAC Address'));
		o.rmempty = false;
		o.placeholder = 'aa:bb:cc:dd:ee:ff';
		Object.keys(hints).sort().forEach(function(mac) {
			o.value(mac, hints[mac].label);
		});
		o.validate = function(section_id, val) {
			var res = q.validUnicastMac(val);
			if (res !== true)
				return res;
			var norm = String(val).trim().toLowerCase();
			var dup = false;
			uci.sections('rtl9617c_qos', 'host', function(sec) {
				if (sec['.name'] !== section_id && sec.mac &&
				    String(sec.mac).trim().toLowerCase() === norm)
					dup = true;
			});
			if (dup)
				return _('This MAC address already exists in the list; please do not add duplicates');
			return true;
		};

		o = s.option(form.Value, 'ingress_kbps', _('Upload Limit (kbps)'));
		o.datatype = 'range(0,32767999)';
		o.default = '0';
		o.rmempty = false;
		o.placeholder = _('0 = Unlimited (stats only)');
		o.value('0', _('0 (Unlimited, upload stats only)'));
		o.value('10000', _('10000 (~10 Mbps)'));
		o.value('30000', _('30000 (~30 Mbps)'));
		o.value('50000', _('50000 (~50 Mbps)'));
		o.value('100000', _('100000 (~100 Mbps)'));
		o.value('300000', _('300000 (~300 Mbps)'));
		o.value('500000', _('500000 (~500 Mbps)'));
		o.value('1000000', _('1000000 (~1000 Mbps)'));

		o = s.option(form.Value, 'egress_kbps', _('Download Limit (kbps)'));
		o.datatype = 'range(0,32767999)';
		o.default = '0';
		o.rmempty = false;
		o.placeholder = _('0 = Unlimited (stats only)');
		o.value('0', _('0 (Unlimited, download stats only)'));
		o.value('20000', _('20000 (~20 Mbps)'));
		o.value('50000', _('50000 (~50 Mbps)'));
		o.value('100000', _('100000 (~100 Mbps)'));
		o.value('200000', _('200000 (~200 Mbps)'));
		o.value('500000', _('500000 (~500 Mbps)'));
		o.value('1000000', _('1000000 (~1000 Mbps)'));

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				_('Per-Device Upload / Download Rate Limiting & Traffic Stats'),
				_('Configure independent upload/download rate limits and live traffic statistics by MAC address for LAN phones, PCs, NAS, or TVs. All policing and accounting runs directly in the RTL9617C ASIC with zero CPU usage.'),
				liveMount,
				function(next, prev) {
					renderLiveHosts(liveMount, next, prev, hints);
				},
				formNode
			);
		});
	}
});
