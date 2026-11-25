'use strict';
'require view';
'require dom';
'require form';
'require uci';
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
	syn1024: '低端口 SYN 拦截（警告：会误拦外网 80/443 网站的 SYN+ACK 回包，默认关闭）',
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
		var l3Badge = t.l3_en
			? (t.l3_act === 'trap' ? q.badge('上送 CPU', 'warn') : q.badge('硬件丢弃', 'good'))
			: q.badge('未启用', '');
		var l2Badge = t.l2_en
			? (t.l2_act === 'trap' ? q.badge('上送 CPU', 'warn') : q.badge('硬件丢弃', 'good'))
			: q.badge('未启用', '');
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
			E('td', { colspan: 6, class: 'rq-note' }, ['暂未读取到硬件防攻击明细表。'])
		]));
	}

	var totalTypes = types.length || 16;
	var activeCount = Math.max(l3Active, l2Active);
	var l3Mask = dos.l3_port_mask || '0x0000000000000000';
	var l2Mask = dos.l2_port_mask || '0x0000000000000000';
	var maskArmed = (l3Mask !== '0x0000000000000000' || l2Mask !== '0x0000000000000000');
	var hwActive = activeCount > 0 && maskArmed;

	dom.content(container, [
		q.guideCard('怎么用？（硬件级网络攻击自动防护）', [
			'1. 当遭遇恶意端口扫描、SYN/Ping 洪水攻击或畸形数据包时，传统路由器靠 CPU 软件防火墙拦截容易占满 CPU 导致断网；开启本页总开关后，RTL9617C 芯片会在网口最前端直接识别并丢弃以下 16 类攻击包，CPU 占用始终为 0%。',
			'2. 推荐设置：勾选下方“启用硬件级网络攻击自动拦截”并点击右下角“保存并应用”即可，系统会自动配置安全的默认洪水速率阈值（ICMP 1000 / SYN 2000 / FIN 2000）并仅对物理网口（不含 CPU 口）开启硬件零 CPU 丢弃。',
			'3. 如在特定测速、内网扫描或穿透场景下遇到误拦，可通过“豁免（单独关闭）的攻击防护项”单独关闭对应规则，或调高洪水包速率触发阈值。'
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('硬件防攻击引擎与生效端口',
				hwActive ? q.badge('硬件零 CPU 丢弃中', 'good') : q.badge('未激活', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						hwActive ? '物理口已设防（丢弃动作）' : '未设防'
					]),
					E('p', { class: 'rq-note' }, [
						'L3 端口掩码：' + l3Mask + ' · L2 端口掩码：' + l2Mask +
						' · 洪水检测时间窗寄存器：L3=' + String(dos.l3_flood_count != null ? dos.l3_flood_count : 1018) +
						' / L2=' + String(dos.l2_flood_count != null ? dos.l2_flood_count : 255) + '。'
					])
				]),
			q.card('16 类攻击防护规则状态',
				hwActive
					? q.badge('已启用 ' + activeCount + ' / ' + totalTypes + ' 项', 'good')
					: q.badge('全部未启用', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						'三层 ' + String(l3Active) + ' / ' + String(totalTypes) +
						' · 二层 ' + String(l2Active) + ' / ' + String(totalTypes)
					]),
					E('p', { class: 'rq-note' }, [
						'默认开启 15 项安全洪水与畸形报文检测（硬件直接丢弃），自动关闭会误拦 HTTP/HTTPS 回包的 syn1024；可按需在下方豁免单项检测。'
					])
				])
		]),
		q.card('16 种常见网络攻击与畸形包硬件防护明细',
			hwActive ? q.badge('防护已激活', 'good') : q.badge('未激活', ''),
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

		o = sg.option(form.Value, 'dos_icmp_th', 'Ping 洪水攻击触发阈值 (1 ~ 65535)',
			'设置 Ping (ICMP) 洪水拦截的硬件包速率阈值（留空默认 1000，避免 0 阈值误拦正常 Ping）。');
		o.depends('dos_enabled', '1');
		o.datatype = 'range(1,65535)';
		o.placeholder = '默认 1000';
		o.rmempty = true;

		o = sg.option(form.Value, 'dos_syn_th', 'TCP SYN 洪水攻击触发阈值 (1 ~ 65535)',
			'设置 TCP SYN 半连接洪水拦截的硬件包速率阈值（留空默认 2000，避免 0 阈值误拦正常建连）。');
		o.depends('dos_enabled', '1');
		o.datatype = 'range(1,65535)';
		o.placeholder = '默认 2000';
		o.rmempty = true;

		o = sg.option(form.Value, 'dos_fin_th', 'TCP FIN 洪水攻击触发阈值 (1 ~ 65535)',
			'设置 TCP FIN 洪水拦截的硬件包速率阈值（留空默认 2000，避免 0 阈值误拦正常断连）。');
		o.depends('dos_enabled', '1');
		o.datatype = 'range(1,65535)';
		o.placeholder = '默认 2000';
		o.rmempty = true;

		o = sg.option(form.MultiValue, 'dos_disabled_types', '豁免（单独关闭）的攻击防护项',
			'默认开启 15 类安全防护（不含会误拦 80/443 回包的 syn1024）；如果某一项在您的网络环境中产生误拦，可在此勾选将其单独关闭。');
		o.depends('dos_enabled', '1');
		o.rmempty = true;
		Object.keys(DOS_LABELS).forEach(function(k) {
			if (k !== 'syn1024')
				o.value(k, DOS_LABELS[k]);
		});

		o = sg.option(form.Flag, 'dos_allow_syn1024', '强制开启低端口 SYN 拦截 (syn1024)',
			'警告：该芯片规则匹配所有源端口 < 1024 且置位 SYN 的报文，会拦截外网 80/443/53 网站的正常 SYN+ACK 握手回包导致无法打开网页！仅建议在特殊纯内网环境开启，正常上网务必保持关闭。');
		o.depends('dos_enabled', '1');
		o.default = '0';
		o.rmempty = false;

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
