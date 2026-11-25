'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';
'require rtl9617c-qos.pe_hook as peHook';

var PORT_FRIENDLY_NAMES = {
	'lan1': 'LAN1 网口（2.5G 口 · 连接主力电脑 / 下级路由 / 交换机）',
	'lan2': 'LAN2 网口（千兆口 · 连接电脑 / 下级路由 / 交换机）',
	'lan3': 'LAN3 网口（千兆口 · 连接电脑 / 下级路由 / 交换机）',
	'lan4': 'LAN4 网口（千兆口 · 连接电脑 / 下级路由 / 交换机）',
	'pon0': 'PON 光口（连接运营商光纤外网总出口）'
};

function renderLivePorts(container, data) {
	var ports = (data && data.ni_ports) || [];
	var teFlow = (data && data.te_flow) || {};
	var wredQueues = teFlow.wred_queues || [];

	var cards = ports.map(function(p) {
		var up = p.carrier && p.operstate === 'up';
		var badge = up
			? q.badge((p.speed ? p.speed + ' Mbps · ' : '') + '已连接', 'good')
			: q.badge('网口未插线', '');

		var title = PORT_FRIENDLY_NAMES[p.device] || p.device;

		return q.card(title, badge, [
			E('p', { class: 'rq-note' }, [
				E('strong', {}, ['发往该网口（下载 / 出站）：']),
				p.egress_summary || '默认（不限制网口下载速度）'
			]),
			E('p', { class: 'rq-note' }, [
				E('strong', {}, ['从该网口进入（上传 / 入站）：']),
				p.ingress_summary || '默认（不限制网口上传速度）'
			]),
			(p.eee && p.eee.supported) ? E('p', { class: 'rq-note' }, [
				E('strong', {}, ['802.3az EEE 节能：']),
				p.eee.enabled
					? (p.eee.active ? '已启用 · 低功耗激活' : '已启用（待机空闲时生效）')
					: '已关闭（可在【硬件加速与卸载】中开启）'
			]) : null,
			(p.qdisc_raw || p.ingress_raw) ? E('details', { class: 'rq-fold' }, [
				E('summary', {}, ['查看底层硬件队列详情']),
				E('pre', { class: 'rq-mono' }, [
					(p.qdisc_raw || '（无出站队列信息）') +
					(p.ingress_raw ? ('\n\n[入站限速策略]\n' + p.ingress_raw) : '')
				])
			]) : null
		]);
	});

	if (!cards.length) {
		cards.push(q.card('物理网口状态', q.badge('未检测到网口', 'warn'), [
			E('p', { class: 'rq-note' }, ['暂未发现在线的 RTL9617C 物理网口。'])
		]));
	}

	var wredHwEn = !!teFlow.wred_hw_en;
	var wredPortActive = !!teFlow.wred_port_active;
	var wredEcnHwEn = !!teFlow.wred_ecn_hw_en;
	var wredActive = wredHwEn && wredPortActive && wredQueues.length > 0;
	var wredBadge = wredActive
		? q.badge('硬件主动控队生效', 'good')
		: ((wredHwEn || wredQueues.length > 0) ? q.badge('端口未使能', 'warn') : q.badge('默认尾丢弃模式', ''));
	var pm = teFlow.te_pm || null;
	var pmText = pm
		? (' · 硬件统计：WRED 丢包 ' + String((pm.wred_g_drop || 0) + (pm.wred_y_drop || 0)) +
		   ' / ECN 标记 ' + String(pm.ce_mark || 0) +
		   ' / 尾丢弃 ' + String(pm.tail_drop || 0))
		: '';

	cards.push(q.card('硬件队列防缓冲膨胀 (WRED)',
		wredBadge,
		[
			E('div', { class: 'rq-kpi' }, [
				wredActive
					? (wredQueues.length + ' 队列生效 · ECN ' + (wredEcnHwEn ? '开' : '关'))
					: (wredQueues.length > 0 ? (wredQueues.length + ' 队列已绑但全局未启') : '未开启')
			]),
			E('p', { class: 'rq-note' }, [
				'全局控制：' + (teFlow.l3_glb_ctrl || '未知') + pmText +
				'。满载下载时当队列开始积压，芯片按概率提前丢包或标记 ECN，防止网页变慢与游戏跳 Ping。'
			])
		]));

	dom.content(container, [
		q.guideCard('怎么用？（网口整口限速与满载防卡顿排队）', [
			'1. 这里针对路由器背后的物理网口（如 LAN1 ~ LAN4）与 PON 光口（pon0）进行调度与限速控制，开启芯片内置的 8 级硬件优先排队通道。',
			'2. 模式怎么选？① 只想限制某个 LAN 口的总下载速度：选“整口下载限速”；② 想让高优游戏/语音无条件抢先：选“按优先级严格排队”（VoQ 7 最高 → VoQ 0 最低）；③ 推荐预设方案：“高低优先级混合排队 (ETS)”，如前 3 个高优通道（等级 7~5）绝对优先，其余 4~0 通道按比重公平分摊带宽。（注：pon0 光口上行硬件 PUC 仅支持 sp 与 ets 排队调度）。',
			'3. 建议同时开启下方“硬件队列防缓冲膨胀 (WRED)”，减少跑满带宽时的排队延迟。（注：网卡发包加速、IPTV 组播卸载等硬件开关已独立至【网络 → 硬件加速与卸载】页面）。'
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

		var sg = m.section(form.NamedSection, 'global', 'global', '硬件队列防缓冲膨胀（满载低延迟优化）');
		sg.anonymous = true;
		sg.addremove = false;

		var go;
		go = sg.option(form.Flag, 'wred_enabled', '启用硬件防缓冲膨胀 (WRED 主动队列管理)',
			'开启后，芯片启用 L3TE WRED 引擎保护高优队列 (VoQ 5~7 不丢包)，对中低优先级队列按概率提前触发丢包或 ECN 拥塞标记，显著降低满载下载时的排队延迟。');
		go.default = '0';
		go.rmempty = false;

		go = sg.option(form.Value, 'wred_profile', 'WRED 拥塞控制曲线模板',
			'选择或输入硬件 WRED 曲线模板号（内置 1=温和均衡、2=标准平衡、3=激进低延迟，高级可填 1~31）。');
		go.depends('wred_enabled', '1');
		go.datatype = 'range(1,31)';
		go.default = '1';
		go.value('1', '1（温和均衡 · 队列过半温和介入，优先吞吐与日常兼容）');
		go.value('2', '2（标准平衡 · 较早开始提前降速，兼顾低延迟与吞吐）');
		go.value('3', '3（激进低延迟 · 更早介入控队，极度防满载跳 Ping）');

		go = sg.option(form.Flag, 'wred_ecn', '启用 ECN 显式拥塞通知标记（代替直接丢包）',
			'开启后，芯片在队列开始积压时优先在 IP 包头写入 ECN 拥塞标记，让支持 ECN 的设备平滑降速且减少重传（仅对支持 ECN 的流量生效）。');
		go.depends('wred_enabled', '1');
		go.default = '0';
		go.rmempty = false;

		var s = m.section(form.GridSection, 'port', '各物理网口限速与优先排队策略',
			'点击“添加”可为指定物理网口（如 lan1 ~ lan4）或 PON 光口（pon0，硬件仅支持 sp/ets）设置优先排队或整口限速。');
		s.addremove = true;
		s.anonymous = true;
		s.sortable = false;
		s.nodescriptions = true;

		s.tab('egress', '网口下载限速与优先排队（路由器发往该网口）');
		s.tab('ingress', '网口上传限速（从该网口进入路由器）');

		var o;

		o = s.taboption('egress', form.Flag, 'enabled', '启用');
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = s.taboption('egress', form.Value, 'device', '目标物理网口');
		o.rmempty = false;
		o.placeholder = 'lan1';
		niPorts.forEach(function(p) {
			if (p && p.device) {
				var friendly = PORT_FRIENDLY_NAMES[p.device] || p.device;
				o.value(p.device, friendly + (p.operstate === 'up' ? ' [已连接]' : ' [未插线]'));
			}
		});
		['lan1', 'lan2', 'lan3', 'lan4', 'pon0'].forEach(function(d) {
			o.value(d, PORT_FRIENDLY_NAMES[d] || d);
		});
		o.validate = function(section_id, val) {
			if (!val || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,14}$/.test(val))
				return '请输入有效的物理网口名称（如 lan1）';
			var dup = false;
			uci.sections('rtl9617c_qos', 'port', function(sec) {
				if (sec['.name'] !== section_id && sec.device === val)
					dup = true;
			});
			if (dup)
				return '该物理网口已存在一条配置规则，请直接编辑原规则';
			return true;
		};

		o = s.taboption('egress', form.ListValue, 'egress_mode', '下载限速与排队模式');
		o.default = 'none';
		o.rmempty = false;
		o.value('none', '默认（不限制网口下载速度）');
		o.value('tbf', '整口下载限速（限制该网口发往电脑/下级路由的最高总网速）');
		o.value('sp', '按优先级严格排队（等级 7 → 0 高优先级绝对优先，推荐游戏/语音防卡顿）');
		o.value('ets', '高低优先级混合排队（高优通道绝对优先，其余通道按比重分摊带宽）');

		o = s.taboption('egress', form.Value, 'shaper_kbps', '网口最高下载速度 (kbps)');
		o.depends('egress_mode', 'tbf');
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.placeholder = '100000 (= 100 Mbps)';
		o.value('50000', '50000 (约 50 Mbps)');
		o.value('100000', '100000 (约 100 Mbps)');
		o.value('200000', '200000 (约 200 Mbps)');
		o.value('500000', '500000 (约 500 Mbps)');
		o.value('1000000', '1000000 (约 1000 Mbps)');

		o = s.taboption('egress', form.Value, 'shaper_burst', '下载突发缓冲大小 (Bytes)');
		o.depends('egress_mode', 'tbf');
		o.datatype = 'range(4096,1048320)';
		o.default = '65536';
		o.placeholder = '默认 65536 (64 KB)';
		o.modalonly = true;

		o = s.taboption('egress', form.ListValue, 'strict_bands', '绝对优先的高优通道数量（从等级 7 向下分配）');
		o.depends('egress_mode', 'ets');
		o.default = '2';
		for (var b = 0; b <= 8; b++) {
			o.value(String(b), b === 0
				? '0（全部 8 个优先等级均按比重共享带宽）'
				: (b === 8
					? '8（全部 8 个优先等级均按严格优先级排队）'
					: ('前 ' + b + ' 个高优通道（等级 7 → ' + (8 - b) + '）绝对优先，等级 ' + (7 - b) + ' → 0 按比重分配')));
		}

		for (var qIdx = 7; qIdx >= 0; qIdx--) {
			var qo = s.taboption('egress', form.Value, 'voq' + qIdx + '_quantum',
				'优先等级 ' + qIdx + ' 调度比重 (Bytes · 仅非绝对优先时生效)');
			qo.depends('egress_mode', 'ets');
			qo.datatype = 'range(256,1048576)';
			qo.default = '1500';
			qo.placeholder = '1500';
			qo.modalonly = true;
		}

		o = s.taboption('ingress', form.Flag, 'ingress_enable', '启用该网口整口上传限速');
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('ingress', form.Value, 'ingress_cir_kbps', '网口日常上传限速 (kbps)');
		o.depends('ingress_enable', '1');
		o.datatype = 'range(1,32767999)';
		o.default = '100000';
		o.placeholder = '100000 (= 100 Mbps)';
		o.value('20000', '20000 (约 20 Mbps)');
		o.value('50000', '50000 (约 50 Mbps)');
		o.value('100000', '100000 (约 100 Mbps)');
		o.value('300000', '300000 (约 300 Mbps)');
		o.value('500000', '500000 (约 500 Mbps)');
		o.value('1000000', '1000000 (约 1000 Mbps)');

		o = s.taboption('ingress', form.Value, 'ingress_pir_kbps', '网口短时峰值上传速度 (kbps)');
		o.depends('ingress_enable', '1');
		o.datatype = 'range(1,32767999)';
		o.placeholder = '留空则与日常上传限速相同';
		o.rmempty = true;
		o.modalonly = true;

		o = s.taboption('ingress', form.Value, 'ingress_burst', '上传突发缓冲大小 (Bytes)');
		o.depends('ingress_enable', '1');
		o.datatype = 'range(4096,1048320)';
		o.default = '65536';
		o.placeholder = '默认 65536 (64 KB)';
		o.modalonly = true;

		return m.render().then(function(formNode) {
			var peMount = E('div');
			var refreshPe = peHook.mount(peMount, [ 'fq_codel' ], 'PE 协处理器公平队列卸载（非独占）', false);
			var combinedLive = E('div', {}, [ liveMount, peMount ]);
			return q.setupLivePage(
				'物理网口总带宽限速与优先级排队',
				'为每个物理网口（LAN1 ~ LAN4）配置整口总下载/上传最高速度、启用芯片 8 级硬件优先排队通道，并管理硬件队列防缓冲膨胀 (WRED)。',
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
