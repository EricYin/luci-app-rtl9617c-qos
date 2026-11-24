'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';
'require rtl9617c-qos.pe_hook as peHook';

function makeTable(headers, rows, emptyText) {
	if (!rows.length) {
		return E('p', { class: 'rq-note' }, [emptyText]);
	}
	return E('div', { class: 'rq-table-wrap' }, [
		E('table', { class: 'rq-table' }, [
			E('thead', {}, [
				E('tr', {}, headers.map(function(h) { return E('th', {}, [h]); }))
			]),
			E('tbody', {}, rows)
		])
	]);
}

function renderLiveVpn(container, data) {
	var vpn = (data && data.vpn) || {};
	var tun = vpn.tunnel || {};
	var kmods = vpn.kmods || [];
	var tools = vpn.tools || [];
	var ifaces = vpn.interfaces || [];
	var crypto = vpn.crypto || {};

	var kmodReady = kmods.filter(function(m) { return m.loaded; }).length;
	var toolReady = tools.filter(function(t) { return t.present; }).length;
	var upIfaces = ifaces.filter(function(i) { return i.up; }).length;
	var xl2tpd = tools.filter(function(t) { return t.name === 'xl2tpd'; })[0];

	var slotRows = [];
	(tun.control_items || []).forEach(function(item) {
		slotRows.push(E('tr', {}, [
			E('td', {}, ['Control #' + item.idx]),
			E('td', {}, [q.badge(String(item.type_name || item.type_id).toUpperCase(), 'good')]),
			E('td', {}, [String(item.owner)]),
			E('td', { class: 'rq-mono rq-wrap' }, [item.raw || '—'])
		]));
	});
	(tun.content_items || []).forEach(function(item) {
		slotRows.push(E('tr', {}, [
			E('td', {}, ['Content #' + item.idx]),
			E('td', {}, [q.badge(String(item.type_name || item.type_id).toUpperCase(), 'good')]),
			E('td', {}, [String(item.owner)]),
			E('td', { class: 'rq-mono rq-wrap' }, [item.raw || '—'])
		]));
	});
	(tun.eif_items || []).forEach(function(item) {
		slotRows.push(E('tr', {}, [
			E('td', {}, ['EIF Hash #' + item.hash + ' → Phys #' + item.phys]),
			E('td', {}, [q.badge('引用 ' + item.refs + ' 条流', 'good')]),
			E('td', {}, ['FE']),
			E('td', { class: 'rq-mono' }, ['param=0x' + item.param])
		]));
	});

	var envRows = [];
	kmods.forEach(function(m) {
		envRows.push(E('tr', {}, [
			E('td', { class: 'rq-mono' }, [m.name]),
			E('td', {}, ['内核模块']),
			E('td', {}, [m.loaded ? q.badge('已加载 (ref ' + m.refcnt + ')', 'good') : q.badge('未加载', 'warn')]),
			E('td', { class: 'rq-wrap' }, [m.role || '—'])
		]));
	});
	tools.forEach(function(t) {
		var statusBadge;
		if (!t.present)
			statusBadge = q.badge('缺失', 'danger');
		else if (t.running === true)
			statusBadge = q.badge('就绪 · 运行中', 'good');
		else if (t.running === false)
			statusBadge = q.badge('已安装 · 待命', 'good');
		else
			statusBadge = q.badge('已安装', 'good');
		envRows.push(E('tr', {}, [
			E('td', { class: 'rq-mono' }, [t.name]),
			E('td', {}, ['用户态工具']),
			E('td', {}, [statusBadge]),
			E('td', { class: 'rq-wrap' }, [(t.role || '') + ' (' + (t.path || '') + ')'])
		]));
	});

	var ifaceRows = ifaces.map(function(i) {
		return E('tr', {}, [
			E('td', {}, [i.name]),
			E('td', {}, [String(i.proto || '').toUpperCase()]),
			E('td', { class: 'rq-mono' }, [i.server || '—']),
			E('td', { class: 'rq-mono' }, [i.netdev || '—']),
			E('td', {}, [
				i.disabled ? q.badge('已禁用', '') :
				i.up ? q.badge('已连接 (' + i.operstate + ')', 'good') : q.badge('未连接', 'warn')
			])
		]);
	});

	var bestByAlgo = {};
	(crypto.algos || []).forEach(function(a) {
		if (a.selftest === 'passed' && (bestByAlgo[a.name] == null || a.priority > bestByAlgo[a.name]))
			bestByAlgo[a.name] = a.priority;
	});
	var cryptoRows = (crypto.algos || []).map(function(a) {
		var isDefault = a.selftest === 'passed' && bestByAlgo[a.name] === a.priority;
		return E('tr', {}, [
			E('td', { class: 'rq-mono' }, [a.name]),
			E('td', { class: 'rq-mono' }, [a.driver]),
			E('td', {}, [a.hw_engine ? q.badge('片内硬件引擎', 'good') : q.badge('CPU ARMv8 CE', '')]),
			E('td', {}, [String(a.priority)]),
			E('td', {}, [
				a.selftest === 'passed'
					? q.badge(isDefault ? '通过 · 内核默认选用' : '通过 · 备用', isDefault ? 'good' : '')
					: q.badge(a.selftest || '未知', 'warn')
			])
		]);
	});

	dom.content(container, [
		q.guideCard('这是什么？（RTL9617C VPN 硬件加速与加密引擎）', [
			'1. 开启「L2TPv2 / PPTP 硬件卸载」后，明文 PPP 封装的 L2TPv2（UDP 1701）与 PPTP（GREv1）数据面会由 RTL9617C 的 L3PE 双头隧道 ASIC 直接硬件封装/解封装，显著降低 CPU 占用。',
			'2. 若隧道协商了 MPPE 加密、CCP 压缩、VJ 压缩或 IPsec 封装，内核会自动安全回退到软件处理，不会影响正常连通性。',
			'3. 路由器已预置 l2tp_ppp、pptp 内核模块及 xl2tpd / pppd 插件；在【网络 → 接口】新建 L2TP 或 PPTP 客户端接口并拨通后，本页会自动显示芯片槽位分配与流引用情况。',
			'4. 片内加密引擎 90500000.crypto（100 MHz）已完成自检并注册（prio=150）；因 Cortex-A55 自带 ARMv8 CE 指令集（prio=300，单核 AES-GCM 已超 2.6 Gbps），内核默认优先使用更快的 CPU 加密指令。'
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('L2TP / PPTP 芯片卸载',
				vpn.vpn_offload
					? q.badge(tun.ready ? '已开启 · 引擎就绪' : '已开启', 'good')
					: q.badge('已关闭', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						'Control ' + (tun.control_used || 0) + '/' + (tun.control_max || 16) +
						' · Content ' + (tun.content_used || 0) + '/' + (tun.content_max || 16)
					]),
					q.meterBar((tun.control_used || 0) + (tun.content_used || 0), (tun.control_max || 16) + (tun.content_max || 16), true),
					E('p', { class: 'rq-note' }, [
						'L2TP 槽位: ' + (tun.l2tp_slots || 0) +
						' · PPTP 槽位: ' + (tun.pptp_slots || 0) +
						' · EIF 活跃引用流: ' + (tun.eif_refs || 0) +
						' · 释放清表: ' + (vpn.clear_on_free ? '开' : '关')
					])
				]),
			q.card('内核模块与拨号工具',
				(kmodReady === kmods.length && toolReady === tools.length)
					? q.badge('全部就绪', 'good')
					: q.badge('部分缺失', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						'模块 ' + kmodReady + '/' + kmods.length + ' · 工具 ' + toolReady + '/' + tools.length
					]),
					E('p', { class: 'rq-note' }, [
						'xl2tpd 状态: ' + (!xl2tpd || !xl2tpd.present ? '未安装' : (xl2tpd.running ? '运行中' : '已安装（按需启动）'))
					])
				]),
			q.card('已配置 VPN 拨号接口',
				upIfaces > 0 ? q.badge(upIfaces + ' 个在线', 'good')
					: (ifaces.length > 0 ? q.badge('均未连接', 'warn') : q.badge('尚未配置', '')),
				[
					E('div', { class: 'rq-kpi' }, [
						ifaces.length > 0 ? (upIfaces + ' / ' + ifaces.length + ' 个已连接') : '0 个接口'
					]),
					E('p', { class: 'rq-note' }, [
						'前往 ',
						E('a', { href: L.url('admin/network/network') }, ['网络 → 接口']),
						' 新建 L2TP 或 PPTP 拨号接口即可自动接入硬件卸载。'
					])
				]),
			q.card('片内加密引擎 (90500000.crypto)',
				(crypto.available && crypto.rtk_passed > 0)
					? q.badge('自检通过 (' + crypto.rtk_passed + '/' + crypto.rtk_total + ')', 'good')
					: q.badge('未就绪', 'warn'),
				[
					E('div', { class: 'rq-kpi' }, [
						(crypto.clk_mhz != null ? crypto.clk_mhz + ' MHz' : '—') +
						' · IRQ ' + (crypto.irqs || 0)
					]),
					E('p', { class: 'rq-note' }, [
						'优先级 150（备用）；IPsec/TLS 默认走更快的 CPU ARMv8 CE（优先级 300）。'
					])
				])
		]),
		q.card('L3PE 双头隧道硬件槽位实况',
			slotRows.length ? q.badge(slotRows.length + ' 条活跃硬件项', 'good') : q.badge('空闲（无活跃隧道）', ''),
			[
				makeTable(
					['硬件槽位', '类型 / 引用', 'Owner', '硬件寄存器回读 / 参数'],
					slotRows,
					'当前没有活跃的 L2TP / PPTP 硬件卸载槽位。建立明文 L2TPv2 或 PPTP 隧道并产生转发流量后，此处会实时显示分配的 Control / Content / EIF 槽位。'
				)
			]),
		q.card('已配置的 L2TP / PPTP 接口',
			ifaces.length ? q.badge(ifaces.length + ' 个接口', 'good') : q.badge('未配置', ''),
			[
				makeTable(
					['接口名', '协议', '对端服务器', '系统网卡', '连接状态'],
					ifaceRows,
					'尚未在 /etc/config/network 中配置 L2TP 或 PPTP 接口。请前往【网络 → 接口】添加新接口并选择 L2TP 或 PPTP 协议。'
				)
			]),
		q.card('VPN 内核模块与用户态拨号工具自检',
			q.badge('实时检测', ''),
			[
				makeTable(
					['组件', '类别', '状态', '说明 / 路径'],
					envRows,
					'未读取到模块与工具状态。'
				)
			]),
		q.card('加解密算法优先级对照（片内硬件引擎 vs CPU ARMv8 CE）',
			q.badge('/proc/crypto', ''),
			[
				makeTable(
					['算法', '驱动名称', '执行单元', '优先级', '自检与选用状态'],
					cryptoRows,
					'未读取到 /proc/crypto 算法列表。'
				)
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

		var sg = m.section(form.NamedSection, 'global', 'global', 'VPN 硬件加速开关');
		sg.anonymous = true;
		sg.addremove = false;

		var o = sg.option(form.Flag, 'vpn_offload', '启用 L2TPv2 / PPTP 芯片硬件隧道卸载',
			'对应内核模块参数 /sys/module/rtl9617c_ni/parameters/vpn_offload。开启后由 RTL9617C L3PE 双头隧道 ASIC 直接卸载明文 L2TPv2（UDP/1701）与 PPTP（GREv1）数据流；加密/压缩隧道自动回退软件。');
		o.default = '1';
		o.rmempty = false;

		return m.render().then(function(formNode) {
			var peMount = E('div');
			var refreshPe = peHook.mount(peMount, [ 'ipsec', 'srv6' ], 'PE 协处理器隧道与加密卸载（非独占）', false);
			var combinedLive = E('div', {}, [ liveMount, peMount ]);
			return q.setupLivePage(
				'VPN 硬件加速与加密模块',
				'集中管理 RTL9617C 的 L2TPv2 / PPTP ASIC 隧道硬件卸载、拨号工具栈自检及片内加解密引擎状态。',
				combinedLive,
				function(next) {
					renderLiveVpn(liveMount, next);
					refreshPe();
				},
				formNode
			);
		});
	}
});
