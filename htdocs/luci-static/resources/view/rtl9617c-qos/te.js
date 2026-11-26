'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';

function renderLiveTe(container, data) {
	var tf = (data && data.te_flow) || {};
	var fe = (data && data.fe_summary) || {};
	var hp = (data && data.hostpol) || {};

	var flowRows = (tf.flow_policers || []).map(function(p) {
		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [String(p.slot)]),
			E('td', {}, [q.formatKbpsLimit(p.cir_kbps)]),
			E('td', {}, [q.formatKbpsLimit(p.pir_kbps)]),
			E('td', { class: 'rq-mono' }, [String(p.cbs) + ' / ' + String(p.pbs)])
		]);
	});
	if (!flowRows.length) {
		flowRows.push(E('tr', {}, [
			E('td', { colspan: 4, class: 'rq-note' }, [_('No active per-flow hardware policer channels (all 160 slots free).')])
		]));
	}

	var grpRows = (tf.group_policers || []).map(function(g) {
		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [String(g.group)]),
			E('td', {}, [q.formatKbpsLimit(g.cir_kbps)]),
			E('td', {}, [q.formatKbpsLimit(g.pir_kbps)]),
			E('td', { class: 'rq-mono' }, [String(g.cbs) + ' / ' + String(g.pbs)])
		]);
	});
	if (!grpRows.length) {
		grpRows.push(E('tr', {}, [
			E('td', { colspan: 4, class: 'rq-note' }, [_('No active multi-flow shared policer groups.')])
		]));
	}

	dom.content(container, [
		q.guideCard(_('How to Use (Hardware Policer Channels & Shared Groups)'), [
			_('1. Manage the RTL9617C forwarding ASIC\'s per-flow policer channels (0–159) and multi-flow shared policer groups (0–63) for precise hardware rate limiting and burst control.'),
			_('2. For per-device rate limiting, use Per-Device Rate Limiting (which has 96 dedicated reserved hardware channels); the 160 channels and 64 shared groups here are for fine-grained flow-level policing.'),
			E('span', {}, [
				_('3. Hardware DoS Protection and Hardware Traffic Mirroring are now separate pages:'), ' ',
				E('a', { href: L.url('admin/network/rtl9617c_dos') }, [_('Network → Hardware DoS Protection')]),
				' / ',
				E('a', { href: L.url('admin/network/rtl9617c_mirror') }, [_('Network → Hardware Traffic Mirroring')])
			])
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Per-Flow Hardware Policer Channels'),
				tf.available ? q.badge(_('160 channels total'), 'good') : q.badge(_('Unavailable'), 'danger'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('%d / %d used').format(tf.flow_slots_used || 0, tf.flow_slots_total || 160)
					]),
					q.meterBar(tf.flow_slots_used || 0, tf.flow_slots_total || 160),
					E('p', { class: 'rq-note' }, [
						_('Flows bound to per-flow hardware policers: %d (in addition, 96 dedicated channels are reserved for Per-Device Rate Limiting; currently %d used).').format(
							fe.pol_flow || 0,
							(hp.entries_used || 0) * 2
						)
					])
				]),
			q.card(_('Multi-Flow Shared Policer Groups'),
				tf.group64_ready ? q.badge(_('64 groups ready'), 'good') : q.badge(_('Standard Mode'), 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						_('%d / %d groups used').format(tf.group_slots_used || 0, tf.group_slots_total || 64)
					]),
					q.meterBar(tf.group_slots_used || 0, tf.group_slots_total || 64),
					E('p', { class: 'rq-note' }, [
						_('Hardware rate-limiting pools allowing multiple connections to share a single combined bandwidth cap.')
					])
				]),
			q.card(_('Hardware Queue WRED / ECN Global Status'),
				(tf.wred_hw_en && tf.wred_port_active && (tf.wred_queues || []).length > 0)
					? q.badge(_('Hardware Active'), 'good')
					: (((tf.wred_queues || []).length > 0 || tf.wred_hw_en) ? q.badge(_('Port Not Enabled'), 'warn') : q.badge(_('Not enabled'), '')),
				[
					E('div', { class: 'rq-kpi' }, [
						_('WRED: %s · ECN: %s').format(
							tf.wred_hw_en ? _('On') : _('Off'),
							tf.wred_ecn_hw_en ? _('On') : _('Off')
						)
					]),
					E('p', { class: 'rq-note' }, [
						_('l3_glb_ctrl: %s · Queues bound to curves: %d%s.').format(
							tf.l3_glb_ctrl || _('unknown'),
							(tf.wred_queues || []).length,
							tf.te_pm
								? ' · ' + _('WRED drop: %d · ECN mark: %d').format(
									(tf.te_pm.wred_g_drop || 0) + (tf.te_pm.wred_y_drop || 0),
									tf.te_pm.ce_mark || 0
								)
								: ''
						)
					])
				])
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Active Per-Flow Hardware Policers (0 ~ 159)'), null, [
				E('div', { class: 'rq-table-wrap' }, [
					E('table', { class: 'rq-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, [_('Slot')]),
								E('th', {}, [_('Committed Rate (CIR)')]),
								E('th', {}, [_('Peak Rate (PIR)')]),
								E('th', {}, [_('Burst Buffer (Bytes)')])
							])
						]),
						E('tbody', {}, flowRows)
					])
				])
			]),
			q.card(_('Active Multi-Flow Shared Policer Groups (0 ~ 63)'), null, [
				E('div', { class: 'rq-table-wrap' }, [
					E('table', { class: 'rq-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, [_('Group')]),
								E('th', {}, [_('Committed Rate (CIR)')]),
								E('th', {}, [_('Peak Rate (PIR)')]),
								E('th', {}, [_('Burst Buffer (Bytes)')])
							])
						]),
						E('tbody', {}, grpRows)
					])
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
		var o;

		var sf = m.section(form.GridSection, 'flow_policer', _('Per-Flow Hardware Policer Presets (Slots 0 ~ 159)'),
			_('Pre-configure the ASIC\'s 160 per-flow hardware policer channels (in kbps, 100000 = 100 Mbps; burst buffer range 1 ~ 4095).'));
		sf.addremove = true;
		sf.anonymous = true;
		sf.nodescriptions = true;

		o = sf.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = sf.option(form.Value, 'slot', _('Hardware Slot (0 ~ 159)'));
		o.datatype = 'range(0,159)';
		o.rmempty = false;
		o.placeholder = '0';

		o = sf.option(form.Value, 'cir_kbps', _('Committed Rate CIR (kbps)'));
		o.datatype = 'range(1,32767999)';
		o.default = '50000';
		o.rmempty = false;

		o = sf.option(form.Value, 'pir_kbps', _('Peak Rate PIR (kbps)'));
		o.datatype = 'range(1,32767999)';
		o.default = '50000';
		o.rmempty = false;

		o = sf.option(form.Value, 'cbs', _('Committed Burst CBS (1~4095)'));
		o.datatype = 'range(1,4095)';
		o.default = '2048';
		o.rmempty = false;

		o = sf.option(form.Value, 'pbs', _('Peak Burst PBS (1~4095)'));
		o.datatype = 'range(1,4095)';
		o.default = '4095';
		o.rmempty = false;

		var sgrp = m.section(form.GridSection, 'group_policer', _('Multi-Flow Shared Policer Groups (Groups 0 ~ 63)'),
			_('Configure the ASIC\'s 64 multi-flow shared bandwidth policer groups (in kbps, 100000 = 100 Mbps; burst buffer range 1 ~ 4095).'));
		sgrp.addremove = true;
		sgrp.anonymous = true;
		sgrp.nodescriptions = true;

		o = sgrp.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = sgrp.option(form.Value, 'group', _('Shared Group ID (0 ~ 63)'));
		o.datatype = 'range(0,63)';
		o.rmempty = false;
		o.placeholder = '0';

		o = sgrp.option(form.Value, 'cir_kbps', _('Shared Committed Rate CIR (kbps)'));
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.rmempty = false;

		o = sgrp.option(form.Value, 'pir_kbps', _('Shared Peak Rate PIR (kbps)'));
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.rmempty = false;

		o = sgrp.option(form.Value, 'cbs', _('Committed Burst CBS (1~4095)'));
		o.datatype = 'range(1,4095)';
		o.default = '2048';
		o.rmempty = false;

		o = sgrp.option(form.Value, 'pbs', _('Peak Burst PBS (1~4095)'));
		o.datatype = 'range(1,4095)';
		o.default = '4095';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				_('Hardware Policer Channels & Shared Groups'),
				_('Monitor and pre-configure RTL9617C\'s 160 per-flow hardware policer channels and 64 multi-flow shared policer groups.'),
				liveMount,
				function(next) {
					renderLiveTe(liveMount, next);
				},
				formNode
			);
		});
	}
});
