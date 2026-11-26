'use strict';
'require baseclass';
'require dom';
'require rpc';
'require ui';

var callPeStatus = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'status'
});

var callPeSetFeature = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'set_feature',
	params: [ 'id', 'enabled', 'pe' ]
});

var callPeSetParams = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'set_params',
	params: [ 'fq_rate_kbps', 'fq_target_us', 'fq_ecn', 'mcast_rate_kbps' ]
});

function fmtMhz(hz) {
	var n = Number(hz) || 0;
	return n ? (n / 1000000).toFixed(0) + ' MHz' : '-- MHz';
}

function fmtPct(permille) {
	var p = Number(permille) || 0;
	if (p < 0) p = 0;
	if (p > 1000) p = 1000;
	return (p / 10).toFixed(1) + '%';
}

function badge(text, tone) {
	return E('span', { 'class': 'rq-badge' + (tone ? ' rq-' + tone : '') }, text);
}

return baseclass.extend({
	mount: function(container, featureIds, title, showSummary) {
		var busy = false;

		function refresh() {
			return callPeStatus().then(function(st) {
				if (!st || !st.driver_loaded) {
					dom.content(container, []);
					return;
				}
				var feats = (st.features || []).filter(function(f) {
					return featureIds.indexOf(f.id) >= 0;
				});
				if (!feats.length && !showSummary) {
					dom.content(container, []);
					return;
				}

				var body = [];

				if (showSummary) {
					var cores = st.cores || [];
					var cText = cores.map(function(c) {
						var stStr = c.state === 'running'
							? _('Running · %s').format(fmtPct(c.util_permille))
							: (c.clk_gated ? _('Clock-gated (power save)') : _('Stopped'));
						return 'PE' + c.core + ': ' + stStr;
					}).join('  |  ');
					body.push(E('div', { 'class': 'rq-note', 'style': 'margin:0 0 10px;font-size:13px;color:var(--rq-text)' }, [
						E('strong', {}, _('PE Clock %s / AXI %s').format(fmtMhz(st.pe_clk_hz), fmtMhz(st.peaxi_clk_hz)) + ' · '),
						cText
					]));
				}

				if (st.mode === 'wifi_wfo') {
					body.push(E('div', { 'class': 'rq-note', 'style': 'color:var(--rq-warn)' },
						_('PE is currently in Wi-Fi hardware offload mode. Enabling any wired feature below will automatically switch back to general data-plane offload mode.')));
				}

				if (feats.length) {
					var rows = feats.map(function(f) {
						var sel = E('select', {
							'class': 'rq-sel',
							'change': function(ev) {
								if (busy) return;
								busy = true;
								var newPe = parseInt(ev.target.value, 10);
								callPeSetFeature(f.id, f.enabled, newPe).then(function() {
									busy = false;
									return refresh();
								}).catch(function() { busy = false; });
							}
						}, [
							E('option', { 'value': '0', 'selected': f.pe === 0 ? 'selected' : null }, 'PE0'),
							E('option', { 'value': '1', 'selected': f.pe === 1 ? 'selected' : null }, 'PE1')
						]);

						return E('tr', {}, [
							E('td', { 'class': 'rq-wrap' }, [
								E('strong', {}, f.name ? _(f.name) : ''),
								E('div', { 'class': 'rq-note', 'style': 'margin:2px 0 0' }, f.desc ? _(f.desc) : '')
							]),
							E('td', {}, sel),
							E('td', { 'title': f.note ? _(f.note) : null }, f.active && f.hw_bound
								? badge(_('PE%d HW Offload · %s').format(f.pe, fmtPct(f.util_permille)), 'good')
								: (f.active
									? badge(_('Framework Placeholder'), 'warn')
									: (f.enabled ? badge(_('Standby'), 'warn') : badge(_('Not enabled'), '')))),
							E('td', {}, E('button', {
								'class': 'cbi-button rq-btn-sm ' + (f.enabled ? 'cbi-button-remove' : 'cbi-button-positive'),
								'click': function() {
									if (busy) return;
									busy = true;
									var nextEn = !f.enabled;
									callPeSetFeature(f.id, nextEn, f.pe).then(function(res) {
										busy = false;
										if (res && res.ok === false)
											ui.addNotification(null, E('p', _('PE switch failed: %s').format(res.error || '')), 'warning');
										return refresh();
									}).catch(function() { busy = false; });
								}
							}, f.enabled ? _('Disable PE Offload') : _('Enable PE Offload')))
						]);
					});

					body.push(E('div', { 'class': 'rq-table-wrap' }, [
						E('table', { 'class': 'rq-table' }, [
							E('thead', {}, E('tr', {}, [
								E('th', {}, _('PE Coprocessor Offload Feature')),
								E('th', {}, _('Core')),
								E('th', {}, _('Live Status')),
								E('th', {}, _('Toggle'))
							])),
							E('tbody', {}, rows)
						])
					]));

					if (featureIds.indexOf('fq_codel') >= 0 && st.params) {
						var inpFq = E('input', {
							'type': 'number', 'min': '0', 'max': '10000000', 'step': '1000',
							'class': 'cbi-input-text',
							'value': String(st.params.fq_rate_kbps || 0)
						});
						var inpEcn = E('input', {
							'type': 'checkbox',
							'checked': (st.params.fq_ecn === undefined || st.params.fq_ecn) ? 'checked' : null
						});
						body.push(E('div', { 'class': 'rq-pe-params' }, [
							E('label', {}, [ _('PE FQ-CoDel Uplink Shaper (kbps, 0=unlimited):'), ' ', inpFq ]),
							E('label', {}, [ inpEcn, ' ECN' ]),
							E('button', {
								'class': 'cbi-button cbi-button-apply rq-btn-sm',
								'click': function() {
									if (busy) return;
									busy = true;
									callPeSetParams(parseInt(inpFq.value, 10) || 0,
											st.params.fq_target_us || 5000,
											inpEcn.checked ? 1 : 0,
											st.params.mcast_rate_kbps || 0)
										.then(function() { busy = false; return refresh(); })
										.catch(function() { busy = false; });
								}
							}, _('Apply Shaping Parameters'))
						]));
					}
				}

				dom.content(container, E('div', { 'class': 'rq-card' }, [
					E('div', { 'class': 'rq-card-head' }, [
						E('h3', {}, title || _('PE Coprocessor Hardware Offload')),
						E('a', {
							'href': L.url('admin/network/rtl9617c_pe'),
							'style': 'font-size:12px;white-space:nowrap'
						}, _('Open PE Dashboard ↗'))
					])
				].concat(body)));
			}).catch(function() {
				/* Soft-decoupled: hide quietly when rtl9617c-pe-offload is not installed */
				dom.content(container, []);
			});
		}

		refresh();
		return refresh;
	}
});
