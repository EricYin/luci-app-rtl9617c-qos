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
			E('td', { colspan: 4, class: 'rq-note' }, ['当前没有占用的单连接硬件限速通道（160 个通道全部空闲）。'])
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
			E('td', { colspan: 4, class: 'rq-note' }, ['当前没有占用的多连接共享限速组。'])
		]));
	}

	dom.content(container, [
		q.guideCard('怎么用？（硬件限速通道与共享组资源）', [
			'1. 本页管理 RTL9617C 硬件转发引擎中的“单连接限速通道 (0 ~ 159)”和“多连接共享限速组 (0 ~ 63)”，用于在硬件层对特定连接或共享分组做精确限速与突发缓冲控制。',
			'2. 按设备固定 IP 限速请前往【单设备限速】（芯片额外为其专属保留了 96 个底层通道）；本页的 160 个通道与 64 个共享组主要用于连接级精细限速。',
			E('span', {}, [
				'3. 原“硬件级网络攻击防护”和“硬件流量镜像抓包”已分别拆分至侧边栏【',
				E('a', { href: L.url('admin/network/rtl9617c_dos') }, ['网络 → 硬件网络攻击防护']),
				'】与【',
				E('a', { href: L.url('admin/network/rtl9617c_mirror') }, ['网络 → 硬件流量镜像抓包']),
				'】。'
			])
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('单连接硬件限速通道余量',
				tf.available ? q.badge('共 160 个通道', 'good') : q.badge('不可用', 'danger'),
				[
					E('div', { class: 'rq-kpi' }, [
						String(tf.flow_slots_used || 0) + ' / ' + String(tf.flow_slots_total || 160) + ' 个已用'
					]),
					q.meterBar(tf.flow_slots_used || 0, tf.flow_slots_total || 160),
					E('p', { class: 'rq-note' }, [
						'已关联硬件限速的单条连接数：' + String(fe.pol_flow || 0) +
						' 条（另外芯片已为【单设备限速】专属保留 96 个独立底层通道，当前已用 ' +
						String((hp.entries_used || 0) * 2) + ' 个）。'
					])
				]),
			q.card('多连接共享限速组余量',
				tf.group64_ready ? q.badge('64 组就绪', 'good') : q.badge('标准模式', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						String(tf.group_slots_used || 0) + ' / ' + String(tf.group_slots_total || 64) + ' 组已用'
					]),
					q.meterBar(tf.group_slots_used || 0, tf.group_slots_total || 64),
					E('p', { class: 'rq-note' }, [
						'用于多条网络连接共享同一个总带宽上限的硬件限速池。'
					])
				]),
			q.card('硬件队列 WRED / ECN 全局状态',
				(tf.wred_hw_en && tf.wred_port_active && (tf.wred_queues || []).length > 0)
					? q.badge('硬件已激活', 'good')
					: (((tf.wred_queues || []).length > 0 || tf.wred_hw_en) ? q.badge('端口未使能', 'warn') : q.badge('未开启', '')),
				[
					E('div', { class: 'rq-kpi' }, [
						'WRED: ' + (tf.wred_hw_en ? '开启' : '关闭') +
						' · ECN: ' + (tf.wred_ecn_hw_en ? '开启' : '关闭')
					]),
					E('p', { class: 'rq-note' }, [
						'l3_glb_ctrl: ' + (tf.l3_glb_ctrl || '未知') +
						' · 已绑定曲线队列数：' + String((tf.wred_queues || []).length) +
						(tf.te_pm
							? (' · WRED 丢包：' + String((tf.te_pm.wred_g_drop || 0) + (tf.te_pm.wred_y_drop || 0)) +
							   ' · ECN 标记：' + String(tf.te_pm.ce_mark || 0))
							: '') + '。'
					])
				])
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('活跃的单连接硬件限速通道（0 ~ 159）', null, [
				E('div', { class: 'rq-table-wrap' }, [
					E('table', { class: 'rq-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, ['通道号']),
								E('th', {}, ['保证网速']),
								E('th', {}, ['最高网速']),
								E('th', {}, ['突发缓冲 (Bytes)'])
							])
						]),
						E('tbody', {}, flowRows)
					])
				])
			]),
			q.card('活跃的多连接共享限速组（0 ~ 63）', null, [
				E('div', { class: 'rq-table-wrap' }, [
					E('table', { class: 'rq-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, ['组号']),
								E('th', {}, ['保证网速']),
								E('th', {}, ['最高网速']),
								E('th', {}, ['突发缓冲 (Bytes)'])
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

		var sf = m.section(form.GridSection, 'flow_policer', '单连接硬件限速通道预置表（通道 0 ~ 159）',
			'可手动预配置芯片的 160 个单连接硬件限速通道（单位 kbps，100000 = 100 Mbps；突发缓冲范围 1 ~ 4095）。');
		sf.addremove = true;
		sf.anonymous = true;
		sf.nodescriptions = true;

		o = sf.option(form.Flag, 'enabled', '启用');
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = sf.option(form.Value, 'slot', '硬件通道号 (0 ~ 159)');
		o.datatype = 'range(0,159)';
		o.rmempty = false;
		o.placeholder = '0';

		o = sf.option(form.Value, 'cir_kbps', '保证网速 (kbps)');
		o.datatype = 'range(1,32767999)';
		o.default = '50000';
		o.rmempty = false;

		o = sf.option(form.Value, 'pir_kbps', '最高网速 (kbps)');
		o.datatype = 'range(1,32767999)';
		o.default = '50000';
		o.rmempty = false;

		o = sf.option(form.Value, 'cbs', '常规缓冲 (1~4095)');
		o.datatype = 'range(1,4095)';
		o.default = '2048';
		o.rmempty = false;

		o = sf.option(form.Value, 'pbs', '峰值缓冲 (1~4095)');
		o.datatype = 'range(1,4095)';
		o.default = '4095';
		o.rmempty = false;

		var sgrp = m.section(form.GridSection, 'group_policer', '多连接共享限速组配置表（组 0 ~ 63）',
			'配置芯片的 64 个多连接共享带宽限速组（单位 kbps，100000 = 100 Mbps；突发缓冲范围 1 ~ 4095）。');
		sgrp.addremove = true;
		sgrp.anonymous = true;
		sgrp.nodescriptions = true;

		o = sgrp.option(form.Flag, 'enabled', '启用');
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = sgrp.option(form.Value, 'group', '共享限速组号 (0 ~ 63)');
		o.datatype = 'range(0,63)';
		o.rmempty = false;
		o.placeholder = '0';

		o = sgrp.option(form.Value, 'cir_kbps', '共享保证网速 (kbps)');
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.rmempty = false;

		o = sgrp.option(form.Value, 'pir_kbps', '共享最高网速 (kbps)');
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.rmempty = false;

		o = sgrp.option(form.Value, 'cbs', '常规缓冲 (1~4095)');
		o.datatype = 'range(1,4095)';
		o.default = '2048';
		o.rmempty = false;

		o = sgrp.option(form.Value, 'pbs', '峰值缓冲 (1~4095)');
		o.datatype = 'range(1,4095)';
		o.default = '4095';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				'硬件限速通道与共享组',
				'监控与预配置 RTL9617C 的 160 个单连接硬件限速通道及 64 个多连接共享限速组资源。',
				liveMount,
				function(next) {
					renderLiveTe(liveMount, next);
				},
				formNode
			);
		});
	}
});
