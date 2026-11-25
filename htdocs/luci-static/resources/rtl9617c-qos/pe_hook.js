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
							? ('运行中 · ' + fmtPct(c.util_permille))
							: (c.clk_gated ? '已关钟省电' : '已停止');
						return 'PE' + c.core + ': ' + stStr;
					}).join('  |  ');
					body.push(E('div', { 'class': 'rq-note', 'style': 'margin:0 0 10px;font-size:13px;color:var(--rq-text)' }, [
						E('strong', {}, 'PE 主频 ' + fmtMhz(st.pe_clk_hz) + ' / AXI ' + fmtMhz(st.peaxi_clk_hz) + '  ·  '),
						cText
					]));
				}

				if (st.mode === 'wifi_wfo') {
					body.push(E('div', { 'class': 'rq-note', 'style': 'color:var(--rq-warn)' },
						'当前 PE 处于 Wi-Fi 硬件卸载模式，启用下列有线功能将自动切回通用数据面卸载模式。'));
				}

				if (feats.length) {
					var rows = feats.map(function(f) {
						var sel = E('select', {
							'style': 'padding:3px 7px;border-radius:6px;border:1px solid var(--rq-border);background:var(--rq-surface);color:var(--rq-text);font-size:12px',
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
								E('strong', {}, f.name),
								E('div', { 'class': 'rq-note', 'style': 'margin:2px 0 0' }, f.desc)
							]),
							E('td', {}, sel),
							E('td', {}, f.active && f.hw_bound
								? badge('PE' + f.pe + ' 硬件直通 · ' + fmtPct(f.util_permille), 'good')
								: (f.active
									? badge('仅框架占位', 'warn')
									: (f.enabled ? badge('待机', 'warn') : badge('未启用', '')))),
							E('td', {}, E('button', {
								'class': 'cbi-button ' + (f.enabled ? 'cbi-button-remove' : 'cbi-button-positive'),
								'style': 'padding:3px 10px;font-size:12px',
								'click': function() {
									if (busy) return;
									busy = true;
									var nextEn = !f.enabled;
									callPeSetFeature(f.id, nextEn, f.pe).then(function(res) {
										busy = false;
										if (res && res.ok === false)
											ui.addNotification(null, E('p', 'PE 切换失败: ' + (res.error || '')), 'warning');
										return refresh();
									}).catch(function() { busy = false; });
								}
							}, f.enabled ? '关闭 PE 卸载' : '启用 PE 卸载'))
						]);
					});

					body.push(E('div', { 'class': 'rq-table-wrap' }, [
						E('table', { 'class': 'rq-table' }, [
							E('thead', {}, E('tr', {}, [
								E('th', {}, 'PE 协处理器加速项'),
								E('th', {}, '挂载核'),
								E('th', {}, '实时状态'),
								E('th', {}, '开关')
							])),
							E('tbody', {}, rows)
						])
					]));

					if (featureIds.indexOf('fq_codel') >= 0 && st.params) {
						var inpFq = E('input', {
							'type': 'number', 'min': '0', 'max': '10000000', 'step': '1000',
							'class': 'cbi-input-text', 'style': 'width:110px',
							'value': String(st.params.fq_rate_kbps || 0)
						});
						var inpEcn = E('input', {
							'type': 'checkbox',
							'checked': (st.params.fq_ecn === undefined || st.params.fq_ecn) ? 'checked' : null
						});
						body.push(E('div', { 'style': 'margin-top:10px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:12px' }, [
							E('label', {}, [ 'PE FQ-CoDel 上行整形 (kbps, 0=不限): ', inpFq ]),
							E('label', {}, [ inpEcn, ' ECN' ]),
							E('button', {
								'class': 'cbi-button cbi-button-apply',
								'style': 'padding:3px 10px;font-size:12px',
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
							}, '应用整形参数')
						]));
					}
				}

				dom.content(container, E('div', { 'class': 'rq-card' }, [
					E('div', { 'class': 'rq-card-head' }, [
						E('h3', {}, title || 'PE 协处理器硬件卸载'),
						E('a', {
							'href': L.url('admin/network/rtl9617c_pe'),
							'style': 'font-size:12px;white-space:nowrap'
						}, '打开 PE 看板 ↗')
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
