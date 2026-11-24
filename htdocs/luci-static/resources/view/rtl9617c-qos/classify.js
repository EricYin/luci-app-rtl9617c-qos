'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require ui';
'require rtl9617c-qos.common as q';

var COS_LABELS = {
	'7': '等级 7 · 最高优先（网络控制/关键指令）',
	'6': '等级 6 · 极高优先（网络游戏/语音通话）',
	'5': '等级 5 · 高优先（视频会议/直播互动）',
	'4': '等级 4 · 较高优先（高清视频/常用网页）',
	'3': '等级 3 · 普通偏高（日常办公/云盘）',
	'2': '等级 2 · 普通流量（日常基线/默认）',
	'1': '等级 1 · 偏低优先（大文件下载/同步）',
	'0': '等级 0 · 最低队列（BT/后台更新降权，或未设基线时的默认队列）'
};

var PROTO_LABELS = {
	'any': '全部协议',
	'tcp': 'TCP（网页/办公/视频）',
	'udp': 'UDP（游戏/语音/直播）',
	'tcp_udp': 'TCP + UDP',
	'icmp': 'ICMP (Ping)'
};

var DIR_LABELS = {
	'both': '双向（上传 + 下载）',
	'src': '仅上传 / 正向匹配',
	'dst': '仅下载 / 反向匹配'
};

function applyPresetHandler(presetId, presetTitle, btn) {
	btn.disabled = true;
	q.callApplyPreset(presetId).then(function(res) {
		btn.disabled = false;
		if (!res || !res.ok) {
			ui.addNotification(null, E('p', {}, [
				'套用预设失败：', String((res && (res.error || res.code)) || 'unknown')
			]), 'error');
			return;
		}
		ui.addNotification(null, E('p', {}, [
			'已成功套用【', presetTitle, '】并下发到硬件芯片，正在刷新页面…'
		]), 'info');
		window.setTimeout(function() {
			window.location.reload();
		}, 400);
	}).catch(function(err) {
		btn.disabled = false;
		ui.addNotification(null, E('p', {}, [
			'套用预设失败：', err && err.message ? err.message : String(err)
		]), 'error');
	});
}

function detectActivePreset() {
	var saved = uci.get('rtl9617c_qos', 'global', 'preset') || '';
	var sp = uci.get('rtl9617c_qos', 'global', 'small_pkt_prio') === '1';
	var rules = [];
	var appRules = [];
	var hasGamingRule = false;
	var hasOfficeRule = false;

	uci.sections('rtl9617c_qos', 'classify', function(sec) {
		if (sec.enabled !== '0') {
			rules.push(sec);
			if (sec.name && sec.name.indexOf('网络游戏') >= 0)
				hasGamingRule = true;
			if (sec.name && sec.name.indexOf('视频会议') >= 0)
				hasOfficeRule = true;
		}
	});
	uci.sections('rtl9617c_qos', 'app_rule', function(sec) {
		if (sec.enabled !== '0')
			appRules.push(sec);
	});

	if (saved === 'gaming' && sp && hasGamingRule && appRules.length > 0)
		return 'gaming';
	if (saved === 'office' && sp && hasOfficeRule && appRules.length > 0)
		return 'office';
	if ((saved === 'gaming' || saved === 'office') && (!sp || appRules.length === 0 || (saved === 'gaming' && !hasGamingRule) || (saved === 'office' && !hasOfficeRule)))
		return 'legacy';
	if (saved === 'small_only' && sp && rules.length === 0 && appRules.length === 0)
		return 'small_only';

	if (sp && hasGamingRule && appRules.length > 0)
		return 'gaming';
	if (sp && hasOfficeRule && appRules.length > 0)
		return 'office';
	if (sp && rules.length === 0 && appRules.length === 0)
		return 'small_only';
	if (!sp && rules.length === 0 && appRules.length === 0)
		return 'clear';
	return 'custom';
}

function renderPresetCard() {
	var activePreset = detectActivePreset();
	var activeNames = {
		'gaming': '当前已开启：方案一（电竞游戏与语音防卡顿）',
		'office': '当前已开启：方案二（居家办公与视频会议优先）',
		'small_only': '当前已开启：方案三（极简智能小包优先）',
		'legacy': '检测到旧版/不完整预设：缺少应用特征库或规则已漂移，建议重新一键套用预设',
		'custom': '当前状态：使用自定义规则',
		'clear': '当前状态：未开启任何预设'
	};

	var presets = [
		{
			id: 'gaming',
			title: '方案一：电竞游戏与语音防卡顿',
			tagline: '推荐 · 游戏与语音一键防跳 Ping',
			desc: '自动开启【智能小包优先 (≤256B → 等级6)】与默认普通流量基线等级 2 + 启用【应用特征库】手游/端游/语音会议优先并把 BT/下载降权至最低队列 0 + DNS/高频端口规则 + 开启 LAN1 (2.5G 口) 与 PON0 (光口上行) ETS 混合排队（7~5 绝对优先，4~0 按比重）及 WRED 防缓冲膨胀。',
			btnClass: 'btn cbi-button cbi-button-apply',
			btnText: '一键开启游戏预设'
		},
		{
			id: 'office',
			title: '方案二：居家办公与视频会议优先',
			tagline: '远程办公 · 视频会议与网页不卡顿',
			desc: '自动开启【智能小包优先】与默认普通流量基线等级 2 + 启用【应用特征库】视频会议/远程桌面/在线教育优先并把 BT/下载降权至最低队列 0 + DNS/SSH/网页优先规则 + 开启 LAN1 与 PON0 光口 ETS 高低优先级混合排队及 WRED。',
			btnClass: 'btn cbi-button cbi-button-action',
			btnText: '一键开启办公预设'
		},
		{
			id: 'small_only',
			title: '方案三：极简智能小包优先（零规则）',
			tagline: '免配规则 · 纯靠芯片自动识别小包',
			desc: '不添加任何复杂端口规则，仅开启【智能小包优先】总开关与 LAN1 硬件优先排队，靠芯片自动识别游戏、语音、Ping 和网页握手小包并优先转发。',
			btnClass: 'btn cbi-button cbi-button-action',
			btnText: '一键开启小包优先预设'
		},
		{
			id: 'clear',
			title: '关闭预设 / 完全自己配置',
			tagline: '恢复默认 · 清空预设规则从零自由配置',
			desc: '关闭小包优先并清空当前页面的应用分类规则（不会影响您在【单设备限速】中配置的设备限速），方便您从零开始自由添加规则。',
			btnClass: 'btn cbi-button cbi-button-reset',
			btnText: '关闭预设并清空规则'
		}
	];

	return q.card('一键套用场景预设方案（套用后仍可在下方自由修改或增删规则）',
		q.badge(activeNames[activePreset] || '4 套预设可选',
			activePreset === 'legacy' ? 'warn' : (activePreset !== 'clear' ? 'good' : '')),
		[
			E('div', { class: 'rq-grid', style: 'margin-bottom:0' }, presets.map(function(p) {
				var isCurrent = (activePreset === p.id);
				var statusBadge;
				if (p.id === 'clear') {
					statusBadge = isCurrent
						? q.badge('当前未开启预设', '')
						: q.badge('可点击关闭预设', 'warn');
				} else {
					statusBadge = isCurrent
						? q.badge('已开启', 'good')
						: q.badge('未开启', '');
				}

				var btnLabel = isCurrent
					? (p.id === 'clear' ? '当前已处于默认无预设状态' : '当前已开启（点击重新套用默认项）')
					: p.btnText;

				var btn = L.hasViewPermission() ? E('button', {
					type: 'button',
					class: p.btnClass,
					style: 'margin-top:8px;width:100%',
					click: function() {
						applyPresetHandler(p.id, p.title, btn);
					}
				}, [btnLabel]) : null;

				return q.card(p.title, statusBadge, [
					E('p', {
						class: 'rq-note',
						style: 'margin:0 0 6px;font-weight:600;color:var(--rq-accent)'
					}, ['适用定位：' + p.tagline]),
					E('p', { class: 'rq-note', style: 'min-height:66px;margin-top:0' }, [p.desc]),
					btn
				]);
			}))
		]);
}

function renderLiveClassify(container, data, catIndex) {
	var nft = (data && data.nft) || { active: false, rules: {}, app_sets: {}, app_ip_total: 0 };
	var fe = (data && data.fe_summary) || {};
	var ruleMap = nft.rules || {};
	var appSets = nft.app_sets || {};
	var catById = (catIndex && catIndex.catById) || {};
	var appById = (catIndex && catIndex.appById) || {};

	var rows = [];
	var spEnabled = uci.get('rtl9617c_qos', 'global', 'small_pkt_prio') === '1';
	var spBytes = uci.get('rtl9617c_qos', 'global', 'small_pkt_bytes') || '256';
	var spCos = String(uci.get('rtl9617c_qos', 'global', 'small_pkt_cos') || '6');
	var spMode = uci.get('rtl9617c_qos', 'global', 'small_pkt_mode') || 'udp_icmp';
	var spStat = ruleMap['__small_pkt'] || { packets: 0, bytes: 0, instances: 0 };

	if (spEnabled || spStat.instances > 0) {
		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, ['⚡ 智能小包优先（内置免配加速）'])]),
			E('td', {}, [
				spEnabled
					? (spStat.instances > 0 ? q.badge('已生效', 'good') : q.badge('待应用', 'warn'))
					: q.badge('已停用', '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[spCos] || ('等级 ' + spCos), Number(spCos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [
				'包大小 ≤ ' + spBytes + ' Bytes · ' +
				(spMode === 'all' ? '全协议 (TCP+UDP+ICMP)' : '智能模式 (UDP游戏/语音 + Ping + DNS + SSH)')
			]),
			E('td', {}, ['双向（上传 + 下载）']),
			E('td', { class: 'rq-mono' }, [String(spStat.packets || 0) + ' 个包']),
			E('td', { class: 'rq-mono' }, [q.formatBytes(spStat.bytes || 0)])
		]));
	}

	/* App signature domain sets (dnsmasq nftset dynamic IP tracking) */
	for (var c = 7; c >= 0; c--) {
		var dk = '__app_dom_c' + String(c);
		var ds = ruleMap[dk];
		if (!ds || !ds.instances)
			continue;
		var sc = appSets['c' + String(c)] || { v4: 0, v6: 0 };
		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, ['🌐 应用域名动态追踪（等级 ' + String(c) + '）'])]),
			E('td', {}, [q.badge('已生效', 'good')]),
			E('td', {}, [
				q.badge(COS_LABELS[String(c)] || ('等级 ' + c), c >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [
				'dnsmasq nftset 自动捕获服务器 IP：' + String(sc.v4 || 0) + ' 个 IPv4 · ' + String(sc.v6 || 0) + ' 个 IPv6（12h 滚动缓存）'
			]),
			E('td', {}, ['双向（上传 + 下载）']),
			E('td', { class: 'rq-mono' }, [String(ds.packets || 0) + ' 个包']),
			E('td', { class: 'rq-mono' }, [q.formatBytes(ds.bytes || 0)])
		]));
	}

	/* Per-rule app signature entries */
	var activeAppRules = 0;
	uci.sections('rtl9617c_qos', 'app_rule', function(sec) {
		var id = sec['.name'];
		var enabled = sec.enabled !== '0';
		if (enabled)
			activeAppRules++;
		var cos = String(sec.cos != null ? sec.cos : '6');
		var mtype = sec.match_type === 'app' ? 'app' : 'category';
		var st = ruleMap['__app_' + id] || { packets: 0, bytes: 0, instances: 0 };
		var domLive = !!(ruleMap['__app_dom_c' + cos] && ruleMap['__app_dom_c' + cos].instances > 0);
		var title, detail;

		if (mtype === 'app') {
			var ap = appById[sec.app_id];
			title = '🎮 特征库应用：' + (ap ? ap.name : (sec.app_id || id));
			detail = ap
				? ('域名追踪 ' + ap.d_cnt + ' 个 · 专用 TCP ' + ap.t_cnt + ' 项 · UDP ' + ap.u_cnt + ' 项')
				: ('应用 ID: ' + (sec.app_id || '未选择'));
		} else {
			var ct = catById[sec.category];
			title = '📦 特征库大类：' + (ct ? ct.name : (sec.category || id));
			detail = ct
				? ('覆盖 ' + ct.count + ' 款应用（自动合并域名动态追踪 + 专用窄端口）')
				: ('分类: ' + (sec.category || '未选择'));
		}
		if (sec.dscp_set)
			detail += ' · 改写 DSCP→' + sec.dscp_set;

		var isLive = st.instances > 0 || domLive;
		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, [title])]),
			E('td', {}, [
				enabled
					? (isLive ? q.badge('已生效', 'good') : q.badge('待应用', 'warn'))
					: q.badge('已停用', '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[cos] || ('等级 ' + cos), Number(cos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [detail]),
			E('td', {}, ['双向（上传 + 下载）']),
			E('td', { class: 'rq-mono' }, [
				st.instances > 0 ? (String(st.packets || 0) + ' 个包（端口）') : '计入上方域名追踪'
			]),
			E('td', { class: 'rq-mono' }, [
				st.instances > 0 ? q.formatBytes(st.bytes || 0) : '—'
			])
		]));
	});

	uci.sections('rtl9617c_qos', 'classify', function(sec) {
		var id = sec['.name'];
		var st = ruleMap[id] || { packets: 0, bytes: 0, instances: 0 };
		var enabled = sec.enabled !== '0';
		var cos = String(sec.cos != null ? sec.cos : '0');
		var criteria = [];
		if (sec.proto && sec.proto !== 'any')
			criteria.push('协议: ' + (PROTO_LABELS[sec.proto] || sec.proto));
		if (sec.src_ip)
			criteria.push('源地址: ' + sec.src_ip);
		if (sec.dst_ip)
			criteria.push('目标地址: ' + sec.dst_ip);
		if (sec.src_port)
			criteria.push('源端口: ' + sec.src_port);
		if (sec.dst_port)
			criteria.push('目标端口: ' + sec.dst_port);
		if (sec.dscp)
			criteria.push('匹配 DSCP: ' + sec.dscp);
		if (sec.dscp_set)
			criteria.push('改写 DSCP→' + sec.dscp_set);
		if (sec.src_mac)
			criteria.push('设备 MAC: ' + sec.src_mac);

		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, [sec.name || id])]),
			E('td', {}, [
				enabled
					? (st.instances > 0 ? q.badge('已生效', 'good') : q.badge('待应用', 'warn'))
					: q.badge('已停用', '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[cos] || ('等级 ' + cos), Number(cos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [criteria.length ? criteria.join(' · ') : '（未填写匹配条件）']),
			E('td', {}, [DIR_LABELS[sec.direction || 'both'] || '双向']),
			E('td', { class: 'rq-mono' }, [String(st.packets || 0) + ' 个包']),
			E('td', { class: 'rq-mono' }, [q.formatBytes(st.bytes || 0)])
		]));
	});

	var defCos = String(uci.get('rtl9617c_qos', 'global', 'default_cos') || '0');
	var defStat = ruleMap['__default'] || { packets: 0, bytes: 0, instances: 0 };
	if (Number(defCos) > 0 || defStat.instances > 0) {
		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, ['📌 未匹配普通流量基线'])]),
			E('td', {}, [
				Number(defCos) > 0
					? (defStat.instances > 0 ? q.badge('已生效', 'good') : q.badge('待应用', 'warn'))
					: q.badge('已停用', '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[defCos] || ('等级 ' + defCos), Number(defCos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, ['其余未命中上方规则的直连流量默认归入此基线队列']),
			E('td', {}, ['双向（上传 + 下载）']),
			E('td', { class: 'rq-mono' }, [String(defStat.packets || 0) + ' 个包']),
			E('td', { class: 'rq-mono' }, [q.formatBytes(defStat.bytes || 0)])
		]));
	}

	if (!rows.length) {
		rows.push(E('tr', {}, [
			E('td', { colspan: 7, class: 'rq-note' }, [
				'当前还没有添加任何应用或游戏优先规则。您可以在下方点击“添加”，为主力电脑、游戏机或特定游戏端口设置更高优先级。'
			])
		]));
	}

	var highFlows = fe.cos_high != null ? fe.cos_high : (fe.cos_explicit || 0);
	var totalFlows = fe.total || 0;

	var appSetSummary = [];
	Object.keys(appSets).sort().reverse().forEach(function(k) {
		var v = appSets[k];
		appSetSummary.push('等级' + k.slice(1) + ': ' + (v.v4 || 0) + ' v4 / ' + (v.v6 || 0) + ' v6');
	});

	dom.content(container, [
		q.guideCard('怎么用？（让游戏、语音或主力设备不卡顿）', [
			'1. 最省心用法：直接点击下方【一键套用场景预设方案】中的“电竞游戏与语音防卡顿”或“办公与视频会议优先”，系统会自动开启小包优先、加载应用特征库并配置好网口硬件排队。',
			'2. 应用特征库智能识别：内置 308 款精选应用 / 9 大分类（手游、端游、语音会议、远控、网课、下载网盘等），通过 dnsmasq nftset 自动追踪域名服务器 IP + 专用窄端口识别，无需正则 DPI、零持续 CPU 开销且全程走芯片硬件加速（注：仅对直连或绕过代理的流量生效）。',
			'3. 进阶自定义：您也可以在底部“自定义优先转发规则列表”中按内网设备 IP（如 192.168.2.100）、MAC 或特定游戏端口自由添加、修改或删除规则。'
		]),
		renderPresetCard(),
		E('div', { class: 'rq-grid' }, [
			q.card('优先转发识别引擎',
				nft.active ? q.badge('已加载生效', 'good') : q.badge('未启用', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						String(Object.keys(ruleMap).length) + ' 条规则运行中'
					]),
					E('p', { class: 'rq-note' }, [
						'路由器在连接首包自动识别应用/设备优先级，并立即写入硬件加速表，后续数据包全程由芯片线速转发。'
					])
				]),
			q.card('应用特征库识别',
				activeAppRules > 0 ? q.badge(String(activeAppRules) + ' 条特征规则', 'good') : q.badge('未启用', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						'捕获 ' + String(nft.app_ip_total || 0) + ' 个服务器 IP'
					]),
					E('p', { class: 'rq-note' }, [
						appSetSummary.length
							? ('域名动态集合：' + appSetSummary.join(' · '))
							: ('内置 ' + String((catIndex && catIndex.appCount) || 308) + ' 款应用特征，开启后通过 dnsmasq nftset + 专用端口自动识别。')
					])
				]),
			q.card('已加速的高优先级连接',
				highFlows > 0
					? q.badge('高优通道生效', 'good')
					: q.badge('硬件优先通道', ''),
				q.activeFlowSummary(
					highFlows,
					totalFlows,
					'当前瞬时活跃硬件加速流共 ' + String(totalFlows) +
					' 条（随连接新建/老化动态变化）：高优（等级 5~7）' +
					String(highFlows) + ' 条 · 普通（等级 2~4）' +
					String(fe.cos_normal || 0) + ' 条 · 低优（等级 0~1）' +
					String(fe.cos_low || 0) + ' 条。'
				))
		]),
		q.card('正在生效的优先转发规则与命中统计', null, [
			E('div', { class: 'rq-table-wrap' }, [
				E('table', { class: 'rq-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, ['规则名称']),
							E('th', {}, ['当前状态']),
							E('th', {}, ['优先等级']),
							E('th', {}, ['匹配条件']),
							E('th', {}, ['生效方向']),
							E('th', {}, ['已命中数据包']),
							E('th', {}, ['已命中流量'])
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
			q.callHostHints(),
			q.callAppCatalog()
		]);
	},

	render: function(loaded) {
		var hints = q.normalizeHints(loaded ? loaded[1] : {});
		var catalog = (loaded && loaded[2]) || { categories: [], apps: [] };
		var catById = {};
		var appById = {};
		(catalog.categories || []).forEach(function(c) { catById[c.id] = c; });
		(catalog.apps || []).forEach(function(a) { appById[a.id] = a; });
		var catIndex = {
			catById: catById,
			appById: appById,
			appCount: (catalog.apps || []).length
		};
		var liveMount = E('div');
		var m = new form.Map('rtl9617c_qos', null, null);

		var sg = m.section(form.NamedSection, 'global', 'global',
			'智能小包优先（免配规则，一键提升游戏 / 语音 / 网页反应速度）');
		sg.anonymous = true;
		sg.addremove = false;

		var go;
		go = sg.option(form.Flag, 'small_pkt_prio', '启用智能小包优先',
			'开启后，系统会自动识别小数据包并分配更高硬件转发优先级，省去手动一条条查端口配规则的麻烦。');
		go.default = '0';
		go.rmempty = false;

		go = sg.option(form.ListValue, 'small_pkt_mode', '小包识别模式',
			'推荐使用“智能模式”，专门提权 UDP 游戏/语音小包、Ping、DNS 与 SSH 控制包，同时避免大文件 TCP 下载的确认包把整条下载连接误提权。');
		go.depends('small_pkt_prio', '1');
		go.default = 'udp_icmp';
		go.value('udp_icmp', '智能模式（推荐 · UDP 游戏/语音小包 + Ping + DNS + SSH）');
		go.value('all', '全协议模式（所有小于阈值的 TCP + UDP + ICMP 小包均优先）');

		go = sg.option(form.Value, 'small_pkt_bytes', '小包大小判定阈值 (Bytes)',
			'数据包总长度小于或等于该字节数时判定为小包（范围 64 ~ 1024，默认推荐 256 字节）。');
		go.depends('small_pkt_prio', '1');
		go.datatype = 'range(64,1024)';
		go.default = '256';
		go.value('128', '128 字节（仅极小控制包/语音帧）');
		go.value('256', '256 字节（推荐 · 覆盖绝大多数游戏与语音包）');
		go.value('384', '384 字节（覆盖较长游戏状态同步包）');
		go.value('512', '512 字节（宽松小包阈值）');

		go = sg.option(form.ListValue, 'small_pkt_cos', '小包分配的优先等级');
		go.depends('small_pkt_prio', '1');
		go.default = '6';
		for (var sp = 7; sp >= 1; sp--)
			go.value(String(sp), COS_LABELS[String(sp)]);

		go = sg.option(form.ListValue, 'default_cos', '未匹配普通流量基线等级',
			'为未命中上方规则与小包的普通流量设置基线优先等级（推荐设为 2，使设成等级 0/1 的 BT 或后台下载真正低于普通上网流量）。');
		go.default = '0';
		go.rmempty = false;
		go.value('0', '0（不额外打标 · 未匹配流量保留最低队列 0）');
		for (var dc = 7; dc >= 1; dc--)
			go.value(String(dc), COS_LABELS[String(dc)]);

		var sa = m.section(form.GridSection, 'app_rule',
			'应用特征库智能识别（内置 ' + String(catIndex.appCount || 308) + ' 款应用 · 域名动态追踪 + 专用端口）',
			'无需手查端口号，直接按应用大类（如热门手游、端游、视频会议、下载/网盘降权）或具体应用名添加规则。单个应用的规则优先级高于大类规则；开启后通过 dnsmasq nftset 自动追踪服务器 IP 并同步芯片硬件加速。');
		sa.addremove = true;
		sa.anonymous = true;
		sa.sortable = true;
		sa.nodescriptions = true;

		var ao;
		ao = sa.option(form.Flag, 'enabled', '启用');
		ao.default = '1';
		ao.rmempty = false;
		ao.editable = true;

		ao = sa.option(form.ListValue, 'match_type', '识别方式');
		ao.default = 'category';
		ao.rmempty = false;
		ao.value('category', '按应用大类一键匹配');
		ao.value('app', '按单个应用精准匹配');

		ao = sa.option(form.ListValue, 'category', '应用大类');
		ao.depends('match_type', 'category');
		ao.default = 'mobile_game';
		(catalog.categories || []).forEach(function(c) {
			ao.value(c.id, c.name + '（' + c.count + ' 款 · 推荐等级 ' + c.default_cos + '）');
		});

		ao = sa.option(form.ListValue, 'app_id', '具体应用');
		ao.depends('match_type', 'app');
		(catalog.apps || []).forEach(function(a) {
			var cname = catById[a.cat] ? catById[a.cat].name : a.cat;
			ao.value(a.id, '[' + cname + '] ' + a.name + '（' + a.d_cnt + '域名 / ' + (a.t_cnt + a.u_cnt) + '端口）');
		});

		ao = sa.option(form.ListValue, 'cos', '优先等级 (0~7)');
		ao.default = '6';
		ao.rmempty = false;
		for (var ap = 7; ap >= 0; ap--)
			ao.value(String(ap), COS_LABELS[String(ap)]);

		ao = sa.option(form.Value, 'dscp_set', '改写发出标记 (DSCP)');
		ao.modalonly = true;
		ao.placeholder = '留空=不改写';
		ao.rmempty = true;
		[
			['ef', 'ef (46 · 改写为语音/游戏极低延迟标记)'],
			['cs6', 'cs6 (48 · 改写为网络控制最高优标记)'],
			['cs5', 'cs5 (40 · 改写为实时视频/直播标记)'],
			['af41', 'af41 (34 · 改写为视频会议标记)'],
			['cs1', 'cs1 (8 · 改写为后台低优先标记)'],
			['cs0', 'cs0 (0 · 清除标记为默认 0)']
		].forEach(function(pair) {
			ao.value(pair[0], pair[1]);
		});

		var s = m.section(form.GridSection, 'classify', '自定义优先转发规则列表（按从上到下顺序匹配，可自由增删改）',
			'每条规则至少填写一项匹配条件（如内网设备 IP、设备 MAC、游戏端口或应用 DSCP 标记）。当選擇“双向（上传 + 下载）”时，系统会自动把回程下载流量也归入同一优先等级。');
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;

		var o;

		o = s.option(form.Flag, 'enabled', '启用');
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = s.option(form.Value, 'name', '规则名称');
		o.placeholder = '例如：主力电脑游戏优先 / 视频会议优先';
		o.rmempty = false;

		o = s.option(form.ListValue, 'cos', '优先等级 (0~7)');
		o.default = '6';
		o.rmempty = false;
		for (var p = 7; p >= 0; p--)
			o.value(String(p), COS_LABELS[String(p)]);

		o = s.option(form.ListValue, 'family', '网络类型');
		o.default = 'any';
		o.value('any', 'IPv4 + IPv6 双栈');
		o.value('ip', '仅 IPv4');
		o.value('ip6', '仅 IPv6');

		o = s.option(form.ListValue, 'proto', '协议类型');
		o.default = 'any';
		o.value('any', '全部协议');
		o.value('tcp', 'TCP（网页/办公/视频）');
		o.value('udp', 'UDP（游戏/语音通话/直播）');
		o.value('tcp_udp', 'TCP + UDP');
		o.value('icmp', 'ICMP / Ping 测试');

		o = s.option(form.Value, 'src_ip', '源 IP（内网设备地址）');
		o.placeholder = '留空=不限，或如 192.168.2.100';
		o.rmempty = true;

		o = s.option(form.Value, 'dst_ip', '目标 IP（远程服务器）');
		o.placeholder = '留空=不限，或填服务器 IP/网段';
		o.rmempty = true;

		o = s.option(form.Value, 'src_port', '源端口');
		o.placeholder = '留空=不限';
		o.rmempty = true;

		o = s.option(form.Value, 'dst_port', '目标端口（游戏/应用端口）');
		o.placeholder = '如 53, 3074, 27015-27030';
		o.rmempty = true;

		o = s.option(form.Value, 'dscp', '匹配应用标记 (DSCP)');
		o.placeholder = '留空=不限，或选 ef / cs5 / af41';
		o.rmempty = true;
		[
			['ef', 'ef (46 · 语音通话/游戏极低延迟标记)'],
			['cs6', 'cs6 (48 · 网络控制协议标记)'],
			['cs5', 'cs5 (40 · 实时视频/互动直播标记)'],
			['af41', 'af41 (34 · 高清视频会议标记)'],
			['cs3', 'cs3 (24 · 通话信令标记)'],
			['cs1', 'cs1 (8 · 后台低优先下载标记)'],
			['cs0', 'cs0 (0 · 普通默认标记)']
		].forEach(function(pair) {
			o.value(pair[0], pair[1]);
		});

		o = s.option(form.Value, 'dscp_set', '改写发出标记 (DSCP)');
		o.placeholder = '留空=不改写';
		o.rmempty = true;
		[
			['ef', 'ef (46 · 改写为语音/游戏极低延迟标记)'],
			['cs6', 'cs6 (48 · 改写为网络控制最高优标记)'],
			['cs5', 'cs5 (40 · 改写为实时视频/直播标记)'],
			['af41', 'af41 (34 · 改写为视频会议标记)'],
			['cs3', 'cs3 (24 · 改写为信令优先标记)'],
			['cs1', 'cs1 (8 · 改写为后台低优先标记)'],
			['cs0', 'cs0 (0 · 清除标记为默认 0)']
		].forEach(function(pair) {
			o.value(pair[0], pair[1]);
		});

		o = s.option(form.Value, 'src_mac', '指定内网设备 MAC');
		o.placeholder = '留空=不限';
		o.rmempty = true;
		Object.keys(hints).sort().forEach(function(mac) {
			o.value(mac, hints[mac].label);
		});
		o.validate = function(section_id, val) {
			if (val == null || val === '')
				return true;
			return q.validUnicastMac(val);
		};

		o = s.option(form.ListValue, 'direction', '生效方向');
		o.default = 'both';
		o.value('both', '双向（上传 + 下载自动匹配）');
		o.value('src', '单向（仅按所填源→目标方向匹配）');

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				'应用、游戏与设备优先转发',
				'通过内置应用特征库（域名动态追踪 + 专用端口）、智能小包优先或自定义 IP/MAC/端口规则，为重要流量分配更高的转发优先等级（0 ~ 7 级），并在连接建立时自动同步给 RTL9617C 硬件转发引擎。',
				liveMount,
				function(next) {
					renderLiveClassify(liveMount, next, catIndex);
				},
				formNode
			);
		});
	}
});
