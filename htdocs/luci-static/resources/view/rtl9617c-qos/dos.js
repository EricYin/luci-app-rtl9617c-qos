'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require ui';
'require rtl9617c-qos.common as q';

var DOS_LABELS = {
	icmp_flood: 'Ping 洪水攻击（短时间大量 ICMP 请求轰炸）',
	fin_flood: 'TCP FIN 洪水攻击（大量伪造断开连接请求）',
	syn_flood: 'TCP SYN 半连接洪水（耗尽服务器/路由器连接表）',
	syn_with_data: 'TCP SYN 携带异常负载（非标准握手攻击包）',
	udp_bomb: 'UDP 畸形炸弹包（UDP 长度字段与 IP 长度不一致）',
	ping_of_death: '超长死亡之 Ping（分片重组后超 65535 字节的恶意包）',
	icmp_fragment: 'ICMP 分片异常攻击包（伪造分片 ICMP 报文）',
	tcp_frag_error: 'TCP 分片偏移过小异常（逃避防火墙检测的畸形分片）',
	tcp_short_hdr: 'TCP 头部过短畸形包（不足 20 字节的损坏包）',
	syn1024: '低端口 SYN 扫描洪水（针对 0~1023 系统端口的批量扫描）',
	null_scan: 'TCP NULL 隐蔽端口扫描（标志位全 0 的非法探测包）',
	xma_scan: 'TCP 圣诞树恶意扫描（FIN+URG+PSH 同时置位的探测包）',
	syn_fin_scan: 'TCP SYN+FIN 冲突扫描（建连与断连同时置位的非法包）',
	blat_attacks: 'Blat 同端口欺骗攻击（源端口与目标端口完全相同）',
	land_attacks: 'Land 同地址自环攻击（源 IP 与目标 IP 完全相同）',
	smac_eq_dmac: 'MAC 地址自环异常包（源 MAC 与目标 MAC 完全相同）'
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
		var thText = t.l3_th != null ? (parseInt(t.l3_th, 16) + ' (' + t.l3_th + ')') : '收到即拦截';
		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [String(t.idx)]),
			E('td', {}, [E('strong', {}, [DOS_LABELS[t.name] || t.name])]),
			E('td', { class: 'rq-mono' }, [t.name]),
			E('td', { class: 'rq-mono' }, [thText]),
			E('td', {}, [
				t.l3_en ? q.badge('已启用拦截', 'good') : q.badge('未启用', '')
			]),
			E('td', {}, [
				t.l2_en ? q.badge('已启用拦截', 'good') : q.badge('未启用', '')
			])
		]);
	});
	if (!dosRows.length) {
		dosRows.push(E('tr', {}, [
			E('td', { colspan: 6, class: 'rq-note' }, ['暂未读取到硬件防攻击明细表。'])
		]));
	}

	var totalTypes = types.length || 16;
	var activeCount = Math.max(l3Active, l2Active);

	var clearBtn = L.hasViewPermission() ? E('button', {
		type: 'button',
		class: 'btn cbi-button',
		click: function() {
			clearBtn.disabled = true;
			q.callClearDosFlood('all').then(function() {
				clearBtn.disabled = false;
				ui.addNotification(null, E('p', {}, ['硬件防攻击统计计数已清零。']), 'info');
			}).catch(function(err) {
				clearBtn.disabled = false;
				ui.addNotification(null, E('p', {}, ['清零失败：', err.message || String(err)]), 'error');
			});
		}
	}, ['清零攻击计数']) : null;

	dom.content(container, [
		q.guideCard('怎么用？（硬件级网络攻击自动防护）', [
			'1. 当遭遇恶意端口扫描、SYN/Ping 洪水攻击或畸形数据包时，传统路由器靠 CPU 软件防火墙拦截容易占满 CPU 导致断网；开启本页总开关后，RTL9617C 芯片会在网口最前端直接识别并丢弃以下 16 类攻击包，CPU 占用始终为 0%。',
			'2. 推荐设置：勾选下方“启用硬件级网络攻击自动拦截”并点击右下角“保存并应用”即可，既不影响正常上网和游戏，又能防范常见网络洪水与扫描攻击。',
			'3. 如在特定测速、内网扫描或穿透场景下遇到误拦，可通过“豁免（单独关闭）的攻击防护项”取消勾选对应规则，或调整洪水包速率触发阈值。'
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('硬件防攻击拦截统计',
				tf.dos_enabled ? q.badge('实时拦截中', 'good') : q.badge('未开启', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						'外网/三层 ' + String(dos.l3_flood_count != null ? dos.l3_flood_count : 0) +
						' · 内网/二层 ' + String(dos.l2_flood_count != null ? dos.l2_flood_count : 0)
					]),
					E('p', { class: 'rq-note' }, [
						'统计已触发硬件丢弃的洪水攻击报文次数（芯片层面直接拦截，不经过路由器 CPU）。'
					]),
					clearBtn
				]),
			q.card('16 类攻击防护规则状态',
				tf.dos_enabled
					? q.badge('已启用 ' + activeCount + ' / ' + totalTypes + ' 项', 'good')
					: q.badge('全部未启用', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						'三层 ' + String(l3Active) + ' / ' + String(totalTypes) +
						' · 二层 ' + String(l2Active) + ' / ' + String(totalTypes)
					]),
					E('p', { class: 'rq-note' }, [
						'默认启用全部 16 类常见洪水与畸形报文检测，可按需在下方单独豁免单项检测。'
					])
				])
		]),
		q.card('16 种常见网络攻击与畸形包硬件防护明细',
			tf.dos_enabled ? q.badge('防护已激活', 'good') : q.badge('未激活', ''),
			[
				E('div', { class: 'rq-table-wrap' }, [
					E('table', { class: 'rq-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, ['编号']),
								E('th', {}, ['攻击或异常数据包类型说明']),
								E('th', {}, ['硬件特征标识']),
								E('th', {}, ['触发阈值']),
								E('th', {}, ['三层路由防护']),
								E('th', {}, ['二层桥接防护'])
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

		var sg = m.section(form.NamedSection, 'global', 'global', '硬件级网络攻击防护设置');
		sg.anonymous = true;
		sg.addremove = false;

		var o;
		o = sg.option(form.Flag, 'dos_enabled', '启用硬件级网络攻击自动拦截',
			'开启后，RTL9617C 硬件转发芯片将自动启用上方列表中的 16 类网络攻击与畸形数据包防护（包括 Ping 洪水、TCP SYN/FIN 洪水、死亡之 Ping、UDP 炸弹及隐蔽端口扫描等），在硬件层直接丢弃恶意流量，完全不占用 CPU。');
		o.rmempty = false;
		o.default = '0';

		o = sg.option(form.Value, 'dos_icmp_th', 'Ping 洪水攻击触发阈值 (0 ~ 65535)',
			'设置 Ping (ICMP) 洪水拦截的硬件包速率阈值（留空保持芯片默认值）。');
		o.depends('dos_enabled', '1');
		o.datatype = 'range(0,65535)';
		o.placeholder = '例如 1000（留空使用芯片默认）';
		o.rmempty = true;

		o = sg.option(form.Value, 'dos_syn_th', 'TCP SYN 洪水攻击触发阈值 (0 ~ 65535)',
			'设置 TCP SYN 半连接洪水拦截的硬件包速率阈值（留空保持芯片默认值）。');
		o.depends('dos_enabled', '1');
		o.datatype = 'range(0,65535)';
		o.placeholder = '例如 2000（留空使用芯片默认）';
		o.rmempty = true;

		o = sg.option(form.Value, 'dos_fin_th', 'TCP FIN 洪水攻击触发阈值 (0 ~ 65535)',
			'设置 TCP FIN 洪水拦截的硬件包速率阈值（留空保持芯片默认值）。');
		o.depends('dos_enabled', '1');
		o.datatype = 'range(0,65535)';
		o.placeholder = '例如 2000（留空使用芯片默认）';
		o.rmempty = true;

		o = sg.option(form.MultiValue, 'dos_disabled_types', '豁免（单独关闭）的攻击防护项',
			'默认开启全部 16 类防护；如果某一项在您的特殊网络环境中产生误拦，可在此勾选将其单独关闭。');
		o.depends('dos_enabled', '1');
		o.rmempty = true;
		Object.keys(DOS_LABELS).forEach(function(k) {
			o.value(k, DOS_LABELS[k]);
		});

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				'硬件网络攻击防护',
				'管理 RTL9617C 芯片级 16 类网络攻击与畸形包硬件自动拦截、洪水阈值与单项豁免。',
				liveMount,
				function(next) {
					renderLiveDos(liveMount, next);
				},
				formNode
			);
		});
	}
});
