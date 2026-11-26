'use strict';
'require baseclass';
'require poll';
'require rpc';
'require ui';

var callStatusRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'status',
	expect: { '': {} },
	reject: true
});

var callClearHostMibRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'clear_host_mib',
	params: ['mac'],
	expect: { '': {} },
	reject: true
});

var callClearDosFloodRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'clear_dos_flood',
	params: ['scope'],
	expect: { '': {} },
	reject: true
});

var callApplyRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'apply',
	expect: { '': {} },
	reject: true
});

var callApplyPresetRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'apply_preset',
	params: ['preset'],
	expect: { '': {} },
	reject: true
});

var callAppCatalogRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'app_catalog',
	expect: { '': {} },
	reject: false
});

var callAppCatalogFullRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'app_catalog_full',
	expect: { '': {} },
	reject: true
});

var callAppCatalogSaveAppRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'app_catalog_save_app',
	params: ['id', 'orig_id', 'name', 'cat', 'domains', 'tcp', 'udp'],
	expect: { '': {} },
	reject: true
});

var callAppCatalogDeleteAppRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'app_catalog_delete_app',
	params: ['id'],
	expect: { '': {} },
	reject: true
});

var callAppCatalogImportRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'app_catalog_import',
	params: ['format', 'mode', 'payload', 'default_cat', 'target_app_id', 'target_app_name'],
	expect: { '': {} },
	reject: true
});

var callAppCatalogResetRpc = rpc.declare({
	object: 'luci.rtl9617c-qos',
	method: 'app_catalog_reset',
	expect: { '': {} },
	reject: true
});

var callHostHintsRpc = rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints',
	expect: { '': {} },
	reject: false
});

function ensureCss() {
	var id = 'rtl9617c-qos-css';
	if (document.getElementById(id))
		return;
	var link = E('link', {
		id: id,
		rel: 'stylesheet',
		href: L.resource('rtl9617c-qos/common.css') + '?v=20261126b'
	});
	document.head.appendChild(link);
}

function badge(text, tone) {
	return E('span', { class: 'rq-badge ' + (tone ? 'rq-' + tone : '') }, [text]);
}

function card(title, badgeNode, body, extraClass) {
	return E('section', { class: 'rq-card' + (extraClass ? ' ' + extraClass : '') }, [
		E('div', { class: 'rq-card-head' }, [
			E('h3', {}, [title]),
			badgeNode || E('span')
		]),
		E('div', { class: 'rq-card-body' }, body)
	]);
}

function meterBar(used, total, noAlert) {
	var u = Number(used || 0);
	var t = Math.max(1, Number(total || 1));
	var pct = Math.min(100, Math.round((u / t) * 100));
	var cls = 'rq-meter' + (noAlert ? '' : (pct >= 90 ? ' is-danger' : pct >= 70 ? ' is-warn' : ''));
	return E('div', { class: cls, title: u + ' / ' + t }, [
		E('span', { style: 'width:' + pct + '%' })
	]);
}

function activeFlowSummary(count, total, note) {
	var c = Number(count || 0);
	var t = Number(total || 0);
	var pct = t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0;
	return [
		E('div', { class: 'rq-kpi' }, [
			String(c) + ' 条活跃流（占比 ' + String(pct) + '%）'
		]),
		meterBar(c, Math.max(1, t), true),
		E('p', { class: 'rq-note' }, [note])
	];
}

function formatBytes(v) {
	if (v == null || !isFinite(Number(v)))
		return '—';
	var n = Number(v);
	var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	var i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return n.toFixed(i ? 2 : 0) + ' ' + units[i];
}

function formatBps(bps) {
	if (bps == null || !isFinite(Number(bps)) || bps < 0)
		return '—';
	var n = Number(bps);
	if (n === 0)
		return '0 bps';
	var units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
	var i = 0;
	while (n >= 1000 && i < units.length - 1) {
		n /= 1000;
		i++;
	}
	return n.toFixed(i ? 2 : 0) + ' ' + units[i];
}

function formatKbpsLimit(kbps) {
	var n = Number(kbps || 0);
	if (!isFinite(n) || n <= 0)
		return '不限速（仅统计流量）';
	if (n >= 1000000)
		return (n / 1000000).toFixed(2).replace(/\.00$/, '') + ' Gbps (' + n + ' kbps)';
	if (n >= 1000)
		return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' Mbps (' + n + ' kbps)';
	return n + ' kbps';
}

function guideCard(title, tips) {
	return card(title || '使用说明', badge('配置指南', 'muted'), [
		E('ul', { class: 'rq-note', style: 'margin:0;padding-left:18px;line-height:1.8' },
			(tips || []).map(function(t) { return E('li', {}, [t]); }))
	]);
}

function validUnicastMac(val) {
	if (val == null || val === '')
		return '请输入 MAC 地址';
	var s = String(val).trim().toLowerCase();
	if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(s))
		return 'MAC 格式应为 xx:xx:xx:xx:xx:xx';
	if (s === '00:00:00:00:00:00' || s === 'ff:ff:ff:ff:ff:ff')
		return '不能使用全零或广播 MAC';
	var first = parseInt(s.slice(0, 2), 16);
	if (first & 1)
		return '不能使用组播 MAC（首字节最低位须为 0）';
	return true;
}

function normalizeHints(raw) {
	var out = {};
	raw = raw || {};
	Object.keys(raw).forEach(function(mac) {
		var item = raw[mac] || {};
		var norm = String(mac).toLowerCase();
		var ips = L.toArray(item.ipaddrs || item.ipv4).concat(L.toArray(item.ip6addrs || item.ipv6));
		out[norm] = {
			name: item.name || '',
			ips: ips,
			label: norm + (item.name ? (' (' + item.name + (ips.length ? ' · ' + ips[0] : '') + ')') :
				(ips.length ? (' (' + ips[0] + ')') : ''))
		};
	});
	return out;
}

function setupLivePage(title, subtitle, liveMount, onData, formNode) {
	ensureCss();
	var updatedEl = E('span', { class: 'rq-updated' }, ['加载中…']);
	var paused = false;
	var prevState = null;

	function refresh() {
		return callStatusRpc().then(function(next) {
			var t = new Date();
			updatedEl.textContent = '更新于 ' + t.toTimeString().slice(0, 8);
			onData(next, prevState);
			prevState = next;
		}).catch(function(err) {
			updatedEl.textContent = '读取失败：' + (err && err.message ? err.message : err);
		});
	}

	var toggleBtn = E('button', {
		type: 'button',
		class: 'btn cbi-button',
		click: function() {
			paused = !paused;
			toggleBtn.textContent = paused ? '恢复刷新' : '暂停刷新';
			if (paused)
				poll.stop();
			else {
				poll.start();
				refresh();
			}
		}
	}, ['暂停刷新']);

	var applyBtn = E('button', {
		type: 'button',
		class: 'btn cbi-button cbi-button-apply',
		click: function() {
			applyBtn.disabled = true;
			callApplyRpc().then(function(res) {
				applyBtn.disabled = false;
				if (!res || !res.ok)
					ui.addNotification(null, E('p', {}, ['应用 QoS 配置返回错误码：', String(res ? res.code : 'unknown')]), 'warning');
				return refresh();
			}).catch(function(err) {
				applyBtn.disabled = false;
				ui.addNotification(null, E('p', {}, ['下发失败：', err.message || String(err)]), 'error');
			});
		}
	}, ['立即应用规则']);

	poll.add(refresh, 3);
	refresh();

	return E('div', { class: 'rtlqos' }, [
		E('div', { class: 'rq-header' }, [
			E('div', {}, [
				E('p', { class: 'rq-eyebrow' }, ['硬件级智能流控与限速 · 全程芯片加速不占 CPU']),
				E('h2', {}, [title]),
				E('p', { class: 'rq-note' }, [subtitle])
			]),
			E('div', { class: 'rq-controls' }, [
				updatedEl,
				toggleBtn,
				L.hasViewPermission() ? applyBtn : null
			])
		]),
		liveMount,
		E('div', { class: 'rq-form' }, [formNode])
	]);
}

return baseclass.extend({
	callStatus: callStatusRpc,
	callClearHostMib: callClearHostMibRpc,
	callClearDosFlood: callClearDosFloodRpc,
	callApply: callApplyRpc,
	callApplyPreset: callApplyPresetRpc,
	callAppCatalog: callAppCatalogRpc,
	callAppCatalogFull: callAppCatalogFullRpc,
	callAppCatalogSaveApp: callAppCatalogSaveAppRpc,
	callAppCatalogDeleteApp: callAppCatalogDeleteAppRpc,
	callAppCatalogImport: callAppCatalogImportRpc,
	callAppCatalogReset: callAppCatalogResetRpc,
	callHostHints: callHostHintsRpc,
	badge: badge,
	card: card,
	guideCard: guideCard,
	meterBar: meterBar,
	activeFlowSummary: activeFlowSummary,
	formatBytes: formatBytes,
	formatBps: formatBps,
	formatKbpsLimit: formatKbpsLimit,
	validUnicastMac: validUnicastMac,
	normalizeHints: normalizeHints,
	setupLivePage: setupLivePage
});
