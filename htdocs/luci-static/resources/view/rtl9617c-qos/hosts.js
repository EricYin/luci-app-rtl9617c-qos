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
		var label = nameByMac[mac] || (hint && hint.name) || '未命名设备';
		var ipText = (hint && hint.ips && hint.ips.length) ? hint.ips[0] : '';
		var r = rates[mac] || {};

		var clearBtn = L.hasViewPermission() ? E('button', {
			type: 'button',
			class: 'btn cbi-button',
			click: function() {
				clearBtn.disabled = true;
				q.callClearHostMib(mac).then(function() {
					clearBtn.disabled = false;
					ui.addNotification(null, E('p', {}, ['已清零设备 ', mac, ' 的累计流量统计。']), 'info');
				}).catch(function(err) {
					clearBtn.disabled = false;
					ui.addNotification(null, E('p', {}, ['清零失败：', err.message || String(err)]), 'error');
				});
			}
		}, ['清零流量']) : '—';

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
				'上传 #' + item.ingress_pol1 + (item.ingress_vm >= 0 ? ' (限速器 ' + item.ingress_vm + ')' : ' (仅统计)') +
				' / 下载 #' + item.egress_pol1 + (item.egress_vm >= 0 ? ' (限速器 ' + item.egress_vm + ')' : ' (仅统计)')
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
				'当前还没有正在生效的单设备限速或流量统计规则。您可以在下方“单设备限速规则列表”点击“添加”，选择局域网设备并点击页面右下角“保存并应用”。'
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
				ui.addNotification(null, E('p', {}, ['已清零全部设备的累计流量统计。']), 'info');
			}).catch(function(err) {
				clearAllBtn.disabled = false;
				ui.addNotification(null, E('p', {}, ['清零失败：', err.message || String(err)]), 'error');
			});
		}
	}, ['全部流量清零']) : null;

	dom.content(container, [
		q.guideCard('怎么用？（单设备限速与流量监控）', [
			'1. 在下方“单设备限速规则列表”点击“添加”，在“设备 MAC 地址”下拉框中直接选择您的手机、电脑或电视。',
			'2. 速度单位换算：1000 kbps ≈ 1 Mbps（例如：限制 50 Mbps 填 50000，限制 100 Mbps 填 100000，限制 1000 Mbps 填 1000000）。',
			'3. 如果您只想查看某台设备的实时网速与累计总流量、不想限制它的网速，将“上传限速”和“下载限速”都填 0 即可（0 = 不限速仅统计流量）。',
			'4. 修改规则后点击页面右下角“保存并应用”（或右上角“立即应用规则”），芯片会立即接管该设备的限速与流量统计，全程硬件加速不占 CPU。'
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('已监控设备数',
				hp.available ? q.badge('硬件引擎就绪', 'good') : q.badge('驱动未就绪', 'danger'),
				[
					E('div', { class: 'rq-kpi' }, [
						String(hp.entries_used || 0) + ' / ' + String(hp.entries_max || 32) + ' 台'
					]),
					q.meterBar(hp.entries_used || 0, hp.entries_max || 32),
					E('p', { class: 'rq-note' }, [
						'最多同时支持 32 台局域网设备独立限速或统计流量（每台设备自动分配独立的上传与下载硬件统计通道）。'
					])
				]),
			q.card('已用硬件限速器',
				q.badge('双向合计 32 个', (hp.vmeters_used || 0) >= 28 ? 'warn' : 'good'),
				[
					E('div', { class: 'rq-kpi' }, [
						String(hp.vmeters_used || 0) + ' / ' + String(hp.vmeters_max || 32) + ' 个'
					]),
					q.meterBar(hp.vmeters_used || 0, hp.vmeters_max || 32),
					E('p', { class: 'rq-note' }, [
						'上传或下载限速值大于 0 时各占用 1 个硬件限速器；填 0（仅统计流量不限速）不占用硬件限速器。'
					])
				]),
			q.card('已命中硬件加速连接',
				q.badge('芯片级实时转发', (fe.pol_host || 0) > 0 ? 'good' : ''),
				q.activeFlowSummary(
					fe.pol_host || 0,
					fe.total || 0,
					'当前瞬时活跃硬件加速流共 ' + String(fe.total || 0) +
					' 条（随连接新建/老化动态变化），其中 ' +
					String(fe.pol_host || 0) +
					' 条已关联到单设备限速/统计通道（含 IPv4 与 IPv6 双向流）。'
				))
		]),
		q.card('正在生效的设备限速与实时流量表', clearAllBtn, [
			E('div', { class: 'rq-table-wrap' }, [
				E('table', { class: 'rq-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, ['序号']),
							E('th', {}, ['设备名称 / IP']),
							E('th', {}, ['MAC 地址']),
							E('th', {}, ['上传限速']),
							E('th', {}, ['下载限速']),
							E('th', {}, ['硬件通道号']),
							E('th', {}, ['实时上传网速']),
							E('th', {}, ['实时下载网速']),
							E('th', {}, ['累计上传 / 下载总流量']),
							E('th', {}, ['操作'])
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

		var sg = m.section(form.NamedSection, 'global', 'global', '功能总开关');
		sg.anonymous = true;
		sg.addremove = false;

		var en = sg.option(form.Flag, 'enabled', '启用硬件流控与限速服务',
			'全局总开关：关闭后，所有单设备限速、应用优先及网口限速规则都会暂停并从硬件卸载。');
		en.rmempty = false;
		en.default = '1';

		var s = m.section(form.GridSection, 'host', '单设备限速规则列表（支持添加、修改、删除）',
			'添加局域网设备后，可分别设置它的最高上传速度和下载速度（单位 kbps，100000 = 100 Mbps）。填 0 表示不限制速度、仅开启硬件流量统计。');
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;

		var o;

		o = s.option(form.Flag, 'enabled', '启用');
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = s.option(form.Value, 'name', '设备备注名称');
		o.placeholder = '例如：客厅电视 / 书房电脑';
		o.rmempty = true;

		o = s.option(form.Value, 'mac', '设备 MAC 地址');
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
				return '该 MAC 地址已在列表中存在，请勿重复添加';
			return true;
		};

		o = s.option(form.Value, 'ingress_kbps', '上传限速 (kbps)');
		o.datatype = 'range(0,32767999)';
		o.default = '0';
		o.rmempty = false;
		o.placeholder = '0 = 不限速仅统计';
		o.value('0', '0（不限速，仅统计上传流量）');
		o.value('10000', '10000 (约 10 Mbps)');
		o.value('30000', '30000 (约 30 Mbps)');
		o.value('50000', '50000 (约 50 Mbps)');
		o.value('100000', '100000 (约 100 Mbps)');
		o.value('300000', '300000 (约 300 Mbps)');
		o.value('500000', '500000 (约 500 Mbps)');
		o.value('1000000', '1000000 (约 1000 Mbps)');

		o = s.option(form.Value, 'egress_kbps', '下载限速 (kbps)');
		o.datatype = 'range(0,32767999)';
		o.default = '0';
		o.rmempty = false;
		o.placeholder = '0 = 不限速仅统计';
		o.value('0', '0（不限速，仅统计下载流量）');
		o.value('20000', '20000 (约 20 Mbps)');
		o.value('50000', '50000 (约 50 Mbps)');
		o.value('100000', '100000 (约 100 Mbps)');
		o.value('200000', '200000 (约 200 Mbps)');
		o.value('500000', '500000 (约 500 Mbps)');
		o.value('1000000', '1000000 (约 1000 Mbps)');

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				'单设备上传 / 下载限速与流量统计',
				'按设备 MAC 地址对局域网内的手机、电脑、NAS 或电视进行独立上传/下载限速与实时流量统计。所有限速与计数均由 RTL9617C 硬件芯片直接执行，不占用 CPU。',
				liveMount,
				function(next, prev) {
					renderLiveHosts(liveMount, next, prev, hints);
				},
				formNode
			);
		});
	}
});
