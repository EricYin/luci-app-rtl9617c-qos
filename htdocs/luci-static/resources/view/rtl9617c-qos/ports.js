'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';
'require rtl9617c-qos.pe_hook as peHook';

var PORT_FRIENDLY_NAMES = {
	'lan1': _('LAN1 Port (2.5G · Primary PC / Downstream Router / Switch)'),
	'lan2': _('LAN2 Port (GbE · PC / Downstream Router / Switch)'),
	'lan3': _('LAN3 Port (GbE · PC / Downstream Router / Switch)'),
	'lan4': _('LAN4 Port (GbE · PC / Downstream Router / Switch)'),
	'pon0': _('PON Optical Port (ISP Fiber WAN Uplink)')
};

function formatEgressSummary(p) {
	var info = p.egress_info;
	if (info) {
		if (info.mode === 'no_tc')
			return _('tc not installed');
		if (info.mode === 'tbf')
			return _('Port download shaping %s (burst %s)').format(info.rate, info.burst);
		if (info.mode === 'sp')
			return _('Strict priority queueing (8 priority queues)');
		if (info.mode === 'ets')
			return _('Hybrid priority queueing (top %s strict + remaining WRR)').format(info.strict);
		if (info.mode === 'ets_bands')
			return _('Multi-queue priority scheduling (%s queues)').format(info.bands);
		return _('Default (unlimited port download speed)');
	}
	return p.egress_summary ? _(p.egress_summary) : _('Default (unlimited port download speed)');
}

function formatIngressSummary(p) {
	var info = p.ingress_info;
	if (info) {
		if (info.mode === 'no_tc')
			return _('tc not installed');
		if (info.mode === 'police') {
			return info.in_hw
				? _('Port upload policing %s (burst %s · HW offload active)').format(info.rate, info.burst)
				: _('Port upload policing %s (burst %s)').format(info.rate, info.burst);
		}
		return _('Default (unlimited port upload speed)');
	}
	return p.ingress_summary ? _(p.ingress_summary) : _('Default (unlimited port upload speed)');
}

function renderLivePorts(container, data) {
	var ports = (data && data.ni_ports) || [];
	var teFlow = (data && data.te_flow) || {};
	var wredQueues = teFlow.wred_queues || [];

	var cards = ports.map(function(p) {
		var up = p.carrier && p.operstate === 'up';
		var badge = up
			? q.badge(p.speed ? _('%s Mbps · Connected').format(p.speed) : _('Connected'), 'good')
			: q.badge(_('Unplugged'), '');

		var title = PORT_FRIENDLY_NAMES[p.device] || p.device;

		return q.card(title, badge, [
			E('p', { class: 'rq-note' }, [
				E('strong', {}, [_('To this port (Download / Egress):')]), ' ',
				formatEgressSummary(p)
			]),
			E('p', { class: 'rq-note' }, [
				E('strong', {}, [_('From this port (Upload / Ingress):')]), ' ',
				formatIngressSummary(p)
			]),
			(p.eee && p.eee.supported) ? E('p', { class: 'rq-note' }, [
				E('strong', {}, [_('802.3az EEE Power Saving:')]), ' ',
				p.eee.enabled
					? (p.eee.active ? _('Enabled · LPI Active') : _('Enabled (activates when idle)'))
					: _('Disabled (can be enabled in Hardware Offload)')
			]) : null,
			(p.qdisc_raw || p.ingress_raw) ? E('details', { class: 'rq-fold' }, [
				E('summary', {}, [_('View low-level hardware queue details')]),
				E('pre', { class: 'rq-mono' }, [
					(p.qdisc_raw || _('(no egress qdisc info)')) +
					(p.ingress_raw ? ('\n\n' + _('[Ingress Policing Policy]') + '\n' + p.ingress_raw) : '')
				])
			]) : null
		]);
	});

	if (!cards.length) {
		cards.push(q.card(_('Physical Port Status'), q.badge(_('No ports detected'), 'warn'), [
			E('p', { class: 'rq-note' }, [_('No online RTL9617C physical ports found yet.')])
		]));
	}

	var wredHwEn = !!teFlow.wred_hw_en;
	var wredPortActive = !!teFlow.wred_port_active;
	var wredEcnHwEn = !!teFlow.wred_ecn_hw_en;
	var wredActive = wredHwEn && wredPortActive && wredQueues.length > 0;
	var wredBadge = wredActive
		? q.badge(_('HW Active Queue Management On'), 'good')
		: ((wredHwEn || wredQueues.length > 0) ? q.badge(_('Port Not Enabled'), 'warn') : q.badge(_('Default Tail-Drop Mode'), ''));
	var pm = teFlow.te_pm || null;
	var pmText = pm
		? ' · ' + _('HW stats: WRED drop %d / ECN mark %d / Tail drop %d').format(
			(pm.wred_g_drop || 0) + (pm.wred_y_drop || 0),
			pm.ce_mark || 0,
			pm.tail_drop || 0
		)
		: '';

	cards.push(q.card(_('Hardware Queue Anti-Bufferbloat (WRED)'),
		wredBadge,
		[
			E('div', { class: 'rq-kpi' }, [
				wredActive
					? _('%d queues active · ECN %s').format(wredQueues.length, wredEcnHwEn ? _('On') : _('Off'))
					: (wredQueues.length > 0 ? _('%d queues bound (globally off)').format(wredQueues.length) : _('Not enabled'))
			]),
			E('p', { class: 'rq-note' }, [
				_('Global ctrl: %s%s. Under full download load, the ASIC proactively drops packets or marks ECN by probability as queues build up, preventing slow browsing and gaming ping spikes.').format(
					teFlow.l3_glb_ctrl || _('unknown'),
					pmText
				)
			])
		]));

	dom.content(container, [
		q.guideCard(_('How to Use (Per-Port Shaping & Anti-Lag Queueing)'), [
			_('1. Configure scheduling and rate limits on physical Ethernet ports (LAN1–LAN4) and the PON optical port (pon0) using the ASIC\'s 8-level hardware priority queues.'),
			_('2. Choosing a mode: (a) To cap total download speed on a LAN port, select "Port Download Shaping"; (b) To let high-priority gaming/voice traffic always go first, select "Strict Priority Queueing" (VoQ 7 highest → VoQ 0 lowest); (c) Recommended: "Hybrid Priority Queueing (ETS)", e.g., top 3 high-priority queues (CoS 7–5) strict and CoS 4–0 sharing bandwidth by weight. (Note: pon0 hardware PUC supports sp and ets only.)'),
			_('3. Enabling "Hardware Queue Anti-Bufferbloat (WRED)" below is recommended to reduce queueing delay under saturation. (Note: NIC TX offload and IPTV multicast offload switches are in Network → Hardware Offload.)')
		]),
		E('div', { class: 'rq-grid' }, cards)
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('rtl9617c_qos'),
			q.callStatus()
		]);
	},

	render: function(loaded) {
		var initial = (loaded && loaded[1]) || {};
		var niPorts = initial.ni_ports || [];
		var liveMount = E('div');

		var m = new form.Map('rtl9617c_qos', null, null);

		var sg = m.section(form.NamedSection, 'global', 'global', _('Hardware Queue Anti-Bufferbloat (Low Latency Under Load)'));
		sg.anonymous = true;
		sg.addremove = false;

		var go;
		go = sg.option(form.Flag, 'wred_enabled', _('Enable Hardware Anti-Bufferbloat (WRED Active Queue Management)'),
			_('When enabled, the L3TE WRED engine keeps high-priority queues lossless (VoQ 5–7) while probabilistically dropping or ECN-marking mid/low-priority queues early, sharply reducing queueing latency under full download load.'));
		go.default = '0';
		go.rmempty = false;

		go = sg.option(form.Value, 'wred_profile', _('WRED Congestion Curve Profile'),
			_('Select or enter a hardware WRED curve profile ID (built-in: 1=Gentle, 2=Balanced, 3=Aggressive Low-Latency; advanced: 1–31).'));
		go.depends('wred_enabled', '1');
		go.datatype = 'range(1,31)';
		go.default = '1';
		go.value('1', _('1 (Gentle · intervenes past half queue, prioritizes throughput & compatibility)'));
		go.value('2', _('2 (Balanced · throttles earlier, balances low latency & throughput)'));
		go.value('3', _('3 (Aggressive Low-Latency · earliest intervention to prevent ping spikes)'));

		go = sg.option(form.Flag, 'wred_ecn', _('Enable ECN Marking (instead of packet drops)'),
			_('When enabled, the ASIC marks ECN congestion bits in IP headers as queues grow so ECN-capable hosts slow down smoothly with fewer retransmissions (applies to ECN-capable traffic only).'));
		go.depends('wred_enabled', '1');
		go.default = '0';
		go.rmempty = false;

		var s = m.section(form.GridSection, 'port', _('Per-Port Shaping & Priority Queueing Policies'),
			_('Click "Add" to configure priority queueing or whole-port rate limiting for physical ports (lan1–lan4) or PON optical port (pon0, hardware supports sp/ets only).'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = false;
		s.nodescriptions = true;

		s.tab('egress', _('Port Download Shaping & Queueing (Router → Port)'));
		s.tab('ingress', _('Port Upload Policing (Port → Router)'));

		var o;

		o = s.taboption('egress', form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = s.taboption('egress', form.Value, 'device', _('Target Physical Port'));
		o.rmempty = false;
		o.placeholder = 'lan1';
		niPorts.forEach(function(p) {
			if (p && p.device) {
				var friendly = PORT_FRIENDLY_NAMES[p.device] || p.device;
				o.value(p.device, friendly + ' ' + (p.operstate === 'up' ? _('[Connected]') : _('[Unplugged]')));
			}
		});
		['lan1', 'lan2', 'lan3', 'lan4', 'pon0'].forEach(function(d) {
			o.value(d, PORT_FRIENDLY_NAMES[d] || d);
		});
		o.validate = function(section_id, val) {
			if (!val || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,14}$/.test(val))
				return _('Please enter a valid physical interface name (e.g., lan1)');
			var dup = false;
			uci.sections('rtl9617c_qos', 'port', function(sec) {
				if (sec['.name'] !== section_id && sec.device === val)
					dup = true;
			});
			if (dup)
				return _('A configuration rule already exists for this port; please edit the existing rule');
			return true;
		};

		o = s.taboption('egress', form.ListValue, 'egress_mode', _('Download Shaping & Queueing Mode'));
		o.default = 'none';
		o.rmempty = false;
		o.value('none', _('Default (unlimited port download speed)'));
		o.value('tbf', _('Port Download Shaping (cap total speed from router to PC/downstream router)'));
		o.value('sp', _('Strict Priority Queueing (CoS 7 → 0 strict priority; great for gaming/voice)'));
		o.value('ets', _('Hybrid Priority Queueing (top queues strict, remaining queues share bandwidth by weight)'));

		o = s.taboption('egress', form.Value, 'shaper_kbps', _('Max Port Download Speed (kbps)'));
		o.depends('egress_mode', 'tbf');
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.placeholder = '100000 (= 100 Mbps)';
		o.value('50000', _('50000 (~50 Mbps)'));
		o.value('100000', _('100000 (~100 Mbps)'));
		o.value('200000', _('200000 (~200 Mbps)'));
		o.value('500000', _('500000 (~500 Mbps)'));
		o.value('1000000', _('1000000 (~1000 Mbps)'));

		o = s.taboption('egress', form.Value, 'shaper_burst', _('Download Burst Buffer (Bytes)'));
		o.depends('egress_mode', 'tbf');
		o.datatype = 'range(4096,1048320)';
		o.default = '65536';
		o.placeholder = _('Default 65536 (64 KB)');
		o.modalonly = true;

		o = s.taboption('egress', form.ListValue, 'strict_bands', _('Strict High-Priority Queues (Allocated Down From CoS 7)'));
		o.depends('egress_mode', 'ets');
		o.default = '2';
		for (var b = 0; b <= 8; b++) {
			o.value(String(b), b === 0
				? _('0 (all 8 priority levels share bandwidth by weight)')
				: (b === 8
					? _('8 (all 8 priority levels use strict priority)')
					: _('Top %d priority queues (CoS 7 → %d) strict, CoS %d → 0 WRR').format(b, 8 - b, 7 - b)));
		}

		for (var qIdx = 7; qIdx >= 0; qIdx--) {
			var qo = s.taboption('egress', form.Value, 'voq' + qIdx + '_quantum',
				_('Priority Level %d Weight (Bytes · WRR queues only)').format(qIdx));
			qo.depends('egress_mode', 'ets');
			qo.datatype = 'range(256,1048576)';
			qo.default = '1500';
			qo.placeholder = '1500';
			qo.modalonly = true;
		}

		o = s.taboption('ingress', form.Flag, 'ingress_enable', _('Enable Whole-Port Upload Policing'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('ingress', form.Value, 'ingress_cir_kbps', _('Sustained Upload Limit (kbps)'));
		o.depends('ingress_enable', '1');
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.placeholder = '100000 (= 100 Mbps)';
		o.value('20000', _('20000 (~20 Mbps)'));
		o.value('50000', _('50000 (~50 Mbps)'));
		o.value('100000', _('100000 (~100 Mbps)'));
		o.value('300000', _('300000 (~300 Mbps)'));
		o.value('500000', _('500000 (~500 Mbps)'));
		o.value('1000000', _('1000000 (~1000 Mbps)'));

		o = s.taboption('ingress', form.Value, 'ingress_pir_kbps', _('Peak Burst Upload Speed (kbps)'));
		o.depends('ingress_enable', '1');
		o.datatype = 'range(1,32767999)';
		o.placeholder = _('Leave blank to match sustained upload limit');
		o.rmempty = true;
		o.modalonly = true;

		o = s.taboption('ingress', form.Value, 'ingress_burst', _('Upload Burst Buffer (Bytes)'));
		o.depends('ingress_enable', '1');
		o.datatype = 'range(4096,1048320)';
		o.default = '65536';
		o.placeholder = _('Default 65536 (64 KB)');
		o.modalonly = true;

		return m.render().then(function(formNode) {
			var peMount = E('div');
			var refreshPe = peHook.mount(peMount, [ 'fq_codel' ], _('PE Coprocessor Fair Queueing Offload (Non-Exclusive)'), false);
			var combinedLive = E('div', {}, [ liveMount, peMount ]);
			return q.setupLivePage(
				_('Physical Port Bandwidth Shaping & Priority Queueing'),
				_('Configure whole-port download/upload caps, 8-level ASIC hardware priority queueing on LAN1–LAN4 & PON0, and hardware queue anti-bufferbloat (WRED).'),
				combinedLive,
				function(next) {
					renderLivePorts(liveMount, next);
					refreshPe();
				},
				formNode
			);
		});
	}
});
