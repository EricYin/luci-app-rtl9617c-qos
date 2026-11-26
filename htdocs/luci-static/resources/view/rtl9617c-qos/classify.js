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
			E('div', { class: 'rq-preset-grid' }, presets.map(function(p) {
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
					class: p.btnClass + ' rq-preset-action',
					click: function() {
						applyPresetHandler(p.id, p.title, btn);
					}
				}, [btnLabel]) : null;

				return q.card(p.title, statusBadge, [
					E('p', { class: 'rq-note rq-preset-tagline' }, ['适用定位：' + p.tagline]),
					E('p', { class: 'rq-note rq-preset-desc' }, [p.desc]),
					btn
				], 'rq-preset-card');
			}))
		]);
}

var SAMPLE_JSON_IMPORT = JSON.stringify([
	{
		id: 'custom_geforce',
		name: '示例：云游戏 / 自定义加速',
		cat: 'pc_game',
		domains: ['example-game.qq.com', 'match.example-game.com'],
		tcp: ['31003'],
		udp: ['17005', '27015-27030']
	},
	{
		name: '示例：自定义网盘降权',
		cat: 'download_bulk',
		domains: ['dl.example-cloud.cn'],
		tcp: [],
		udp: []
	}
], null, 2);

var SAMPLE_LINES_IMPORT = [
	'# 格式：分类ID | 应用名称 | 域名列表(分号或空格分隔) | TCP端口 | UDP端口',
	'# 常用分类：mobile_game / pc_game / voice_meeting / remote_desk / education / im_chat / video_live / finance / download_bulk / custom',
	'voice_meeting | 示例语音会议 | meet.example.com;rtc.example.com | 8801 | 8801-8810',
	'download_bulk | 示例后台下载 | dl.example.net;cdn.example.net | | '
].join('\n');

var SAMPLE_DOMAINS_IMPORT = [
	'# 每行一个域名，也支持 Clash DOMAIN-SUFFIX / *.通配符 / +.前缀',
	'DOMAIN-SUFFIX,pvp.qq.com',
	'*.smoba.qq.com',
	'match.example-game.cn'
].join('\n');

function openCatalogManager(initialTab, onDirtyClose) {
	var state = {
		tab: initialTab === 'import' ? 'import' : 'manage',
		catalog: null,
		filterCat: '',
		query: '',
		limit: 80,
		editing: null,
		dirty: false,
		busy: false,
		importResult: null
	};

	var modalRoot = E('div', { class: 'rq-cat-modal' }, [
		E('p', { class: 'rq-note' }, ['正在读取完整应用特征库…'])
	]);

	function closeModal() {
		ui.hideModal();
		if (state.dirty && typeof onDirtyClose === 'function')
			onDirtyClose();
	}

	function downloadJson() {
		if (!state.catalog)
			return;
		var doc = {
			version: state.catalog.version || 'custom-v1',
			source: state.catalog.source || 'RTL9617C App Signature Catalog',
			categories: state.catalog.categories || [],
			apps: state.catalog.apps || []
		};
		var blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = E('a', { href: url, download: 'rtl9617c-app-signatures.json' });
		a.click();
		window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
	}

	function reloadCatalog() {
		return q.callAppCatalogFull().then(function(res) {
			state.catalog = res || { categories: [], apps: [], custom: false };
			renderModal();
		}).catch(function(err) {
			dom.content(modalRoot, [
				E('div', { class: 'rq-cat-result is-error' }, [
					'读取特征库失败：', err && err.message ? err.message : String(err)
				]),
				E('div', { class: 'rq-cat-footer' }, [
					E('span'),
					E('button', { type: 'button', class: 'btn cbi-button', click: closeModal }, ['关闭'])
				])
			]);
		});
	}

	function buildManagePanel(cats, catNameMap, apps) {
		var canWrite = L.hasViewPermission();
		var qLower = (state.query || '').trim().toLowerCase();
		var filtered = apps.filter(function(a) {
			if (state.filterCat && a.cat !== state.filterCat)
				return false;
			if (!qLower)
				return true;
			if ((a.name || '').toLowerCase().indexOf(qLower) >= 0)
				return true;
			if ((a.id || '').toLowerCase().indexOf(qLower) >= 0)
				return true;
			if ((a.domains || []).some(function(d) { return d.toLowerCase().indexOf(qLower) >= 0; }))
				return true;
			if ((a.tcp || []).concat(a.udp || []).some(function(p) { return String(p).toLowerCase().indexOf(qLower) >= 0; }))
				return true;
			return false;
		});

		var catSel = E('select', {
			change: function(ev) {
				state.filterCat = ev.target.value;
				state.limit = 80;
				renderModal();
			}
		}, [E('option', { value: '' }, ['全部分类（' + apps.length + ' 款）'])].concat(cats.map(function(c) {
			return E('option', {
				value: c.id,
				selected: state.filterCat === c.id ? 'selected' : null
			}, [c.name + '（' + (c.count || 0) + '）']);
		})));

		var searchInput = E('input', {
			type: 'search',
			value: state.query,
			placeholder: '按应用名 / ID / 域名 / 端口筛选…',
			input: function(ev) {
				state.query = ev.target.value;
				state.limit = 80;
				renderModal();
			}
		});

		var addBtn = canWrite ? E('button', {
			type: 'button',
			class: 'btn cbi-button cbi-button-add',
			click: function() {
				state.editing = {
					orig_id: '',
					id: '',
					name: '',
					cat: state.filterCat || 'custom',
					domains: '',
					tcp: '',
					udp: ''
				};
				renderModal();
			}
		}, ['+ 新增应用特征']) : null;

		var editorNode = null;
		if (state.editing && canWrite) {
			var ed = state.editing;
			var inpName = E('input', { type: 'text', value: ed.name || '', placeholder: '如：原神 / 某办公平台' });
			var selCat = E('select', {}, cats.map(function(c) {
				return E('option', { value: c.id, selected: (ed.cat || 'custom') === c.id ? 'selected' : null }, [c.name + ' (' + c.id + ')']);
			}));
			var inpId = E('input', { type: 'text', value: ed.id || '', placeholder: '留空自动生成，如 custom_app1' });
			var inpDoms = E('textarea', { placeholder: '每行一个域名，或逗号分隔；支持 *.example.com 与 Clash DOMAIN-SUFFIX,example.com' }, [ed.domains || '']);
			var inpTcp = E('input', { type: 'text', value: ed.tcp || '', placeholder: '如：31003, 50011-50016（可留空）' });
			var inpUdp = E('input', { type: 'text', value: ed.udp || '', placeholder: '如：8000-8100, 17005（可留空）' });
			var edErr = E('div', { class: 'rq-cat-result is-error', style: 'display:none' });

			var saveBtn = E('button', {
				type: 'button',
				class: 'btn cbi-button cbi-button-apply',
				click: function() {
					if (state.busy) return;
					state.busy = true;
					saveBtn.disabled = true;
					edErr.style.display = 'none';
					q.callAppCatalogSaveApp(
						inpId.value.trim(),
						ed.orig_id || '',
						inpName.value.trim(),
						selCat.value,
						inpDoms.value,
						inpTcp.value.trim(),
						inpUdp.value.trim()
					).then(function(res) {
						state.busy = false;
						saveBtn.disabled = false;
						if (!res || !res.ok) {
							edErr.textContent = (res && res.error) ? res.error : '保存失败';
							edErr.style.display = 'block';
							return;
						}
						state.dirty = true;
						state.editing = null;
						ui.addNotification(null, E('p', {}, [
							'已保存应用特征「', res.entry.name, '」',
							res.applied ? '并已同步更新运行中的硬件流控规则。' : '（写入持久自定义特征库）。'
						]), 'info');
						return reloadCatalog();
					}).catch(function(err) {
						state.busy = false;
						saveBtn.disabled = false;
						edErr.textContent = '保存异常：' + (err && err.message ? err.message : String(err));
						edErr.style.display = 'block';
					});
				}
			}, [ed.orig_id ? '保存修改' : '保存并加入特征库']);

			editorNode = E('div', { class: 'rq-cat-editor' }, [
				E('strong', {}, [ed.orig_id ? ('编辑应用特征：' + ed.name + ' (' + ed.orig_id + ')') : '新增应用特征']),
				E('div', { class: 'rq-cat-form-grid' }, [
					E('div', { class: 'rq-cat-field' }, [E('label', {}, ['应用名称 *']), inpName]),
					E('div', { class: 'rq-cat-field' }, [E('label', {}, ['所属分类 *']), selCat]),
					E('div', { class: 'rq-cat-field' }, [E('label', {}, ['应用 ID（选填）']), inpId])
				]),
				E('div', { class: 'rq-cat-field' }, [E('label', {}, ['匹配域名（dnsmasq nftset 自动追踪服务器 IP）']), inpDoms]),
				E('div', { class: 'rq-cat-form-grid' }, [
					E('div', { class: 'rq-cat-field' }, [E('label', {}, ['专用 TCP 端口 / 端口段']), inpTcp]),
					E('div', { class: 'rq-cat-field' }, [E('label', {}, ['专用 UDP 端口 / 端口段']), inpUdp])
				]),
				edErr,
				E('div', { class: 'rq-actions-row', style: 'padding-top:2px' }, [
					saveBtn,
					E('button', {
						type: 'button',
						class: 'btn cbi-button',
						click: function() { state.editing = null; renderModal(); }
					}, ['取消'])
				])
			]);
		}

		var visible = filtered.slice(0, state.limit);
		var rows = visible.map(function(a) {
			var doms = a.domains || [];
			var tcp = a.tcp || [];
			var udp = a.udp || [];
			var chips = [];
			doms.slice(0, 4).forEach(function(d) {
				chips.push(E('span', { class: 'rq-cat-chip rq-mono' }, [d]));
			});
			if (doms.length > 4)
				chips.push(E('span', { class: 'rq-cat-chip' }, ['+' + (doms.length - 4) + ' 域名']));
			if (tcp.length)
				chips.push(E('span', { class: 'rq-cat-chip rq-mono' }, ['TCP: ' + tcp.slice(0, 3).join(',') + (tcp.length > 3 ? '…' : '')]));
			if (udp.length)
				chips.push(E('span', { class: 'rq-cat-chip rq-mono' }, ['UDP: ' + udp.slice(0, 3).join(',') + (udp.length > 3 ? '…' : '')]));

			return E('tr', {}, [
				E('td', { class: 'rq-wrap' }, [
					E('strong', {}, [a.name]),
					E('div', { class: 'rq-note', style: 'margin:2px 0 0' }, [
						(catNameMap[a.cat] || a.cat) + ' · ID: ' + a.id
					])
				]),
				E('td', { class: 'rq-wrap' }, [
					E('div', { class: 'rq-cat-chips' }, chips.length ? chips : [E('span', { class: 'rq-note', style: 'margin:0' }, ['—'])])
				]),
				canWrite ? E('td', {}, [
					E('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
						E('button', {
							type: 'button',
							class: 'btn cbi-button rq-btn-sm',
							click: function() {
								state.editing = {
									orig_id: a.id,
									id: a.id,
									name: a.name,
									cat: a.cat,
									domains: doms.join('\n'),
									tcp: tcp.join(', '),
									udp: udp.join(', ')
								};
								renderModal();
							}
						}, ['编辑']),
						E('button', {
							type: 'button',
							class: 'btn cbi-button cbi-button-remove rq-btn-sm',
							click: function() {
								if (state.busy) return;
								if (!window.confirm('确认从特征库中删除「' + a.name + '」(' + a.id + ') 吗？'))
									return;
								state.busy = true;
								q.callAppCatalogDeleteApp(a.id).then(function(res) {
									state.busy = false;
									if (!res || !res.ok) {
										ui.addNotification(null, E('p', {}, ['删除失败：', (res && res.error) || 'unknown']), 'error');
										return;
									}
									state.dirty = true;
									return reloadCatalog();
								}).catch(function(err) {
									state.busy = false;
									ui.addNotification(null, E('p', {}, ['删除异常：', err && err.message ? err.message : String(err)]), 'error');
								});
							}
						}, ['删除'])
					])
				]) : null
			]);
		});

		if (!rows.length) {
			rows.push(E('tr', {}, [
				E('td', { colspan: canWrite ? 3 : 2, class: 'rq-note' }, ['没有匹配当前筛选条件的应用特征。'])
			]));
		}

		var moreBtn = filtered.length > visible.length ? E('button', {
			type: 'button',
			class: 'btn cbi-button rq-btn-sm',
			style: 'margin:8px auto;display:flex',
			click: function() {
				state.limit = filtered.length;
				renderModal();
			}
		}, ['显示全部 ' + filtered.length + ' 条（当前展示前 ' + visible.length + ' 条）']) : null;

		return [
			E('div', { class: 'rq-cat-toolbar' }, [catSel, searchInput, addBtn]),
			editorNode,
			E('div', { class: 'rq-cat-list-wrap' }, [
				E('table', { class: 'rq-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, ['应用 / 分类']),
							E('th', {}, ['域名与端口特征']),
							canWrite ? E('th', {}, ['操作']) : null
						])
					]),
					E('tbody', {}, rows)
				]),
				moreBtn
			])
		];
	}

	function buildImportPanel(cats, apps) {
		var canWrite = L.hasViewPermission();
		var modeSel = E('select', {}, [
			E('option', { value: 'merge' }, ['合并更新（保留现有特征，新增或更新匹配项）']),
			E('option', { value: 'replace' }, ['覆盖替换（清空现有列表，完全替换为导入内容）'])
		]);
		var fmtSel = E('select', {}, [
			E('option', { value: 'auto' }, ['自动识别（推荐 · 支持 JSON / 表格文本 / Clash 域名规则）']),
			E('option', { value: 'json' }, ['JSON 特征库（完整导出文件或应用对象数组）']),
			E('option', { value: 'lines' }, ['表格 / 文本行（分类|名称|域名|TCP|UDP 或 CSV）']),
			E('option', { value: 'domains' }, ['纯域名列表导入到指定应用（自动去重合并）'])
		]);
		var defCatSel = E('select', {}, cats.map(function(c) {
			return E('option', { value: c.id, selected: c.id === 'custom' ? 'selected' : null }, [c.name + ' (' + c.id + ')']);
		}));
		var targetAppSel = E('select', {}, [
			E('option', { value: '' }, ['新建应用（填写右侧新应用名称）'])
		].concat(apps.map(function(a) {
			return E('option', { value: a.id }, [a.name + ' (' + a.id + ')']);
		})));
		var targetNameInp = E('input', { type: 'text', placeholder: '仅新建域名组时生效，如：公司内网加速' });
		var textArea = E('textarea', {
			style: 'min-height:170px',
			placeholder: '在此粘贴 JSON、表格文本行（分类|名称|域名|TCP|UDP）或 Clash/纯域名列表，或点击上方选择本地文件导入…'
		});
		var fileInput = E('input', {
			type: 'file',
			accept: '.json,.txt,.csv,.list,application/json,text/plain',
			change: function(ev) {
				var file = ev.target.files && ev.target.files[0];
				if (!file) return;
				if (file.size > 524288) {
					state.importResult = { ok: false, error: '文件超过 512 KB 上限，请精简后再导入。' };
					renderModal();
					return;
				}
				var reader = new FileReader();
				reader.onload = function() {
					textArea.value = String(reader.result || '');
				};
				reader.readAsText(file, 'utf-8');
			}
		});

		var targetWrap = E('div', { class: 'rq-cat-form-grid' }, [
			E('div', { class: 'rq-cat-field' }, [E('label', {}, ['默认归属分类（未指明分类时使用）']), defCatSel]),
			E('div', { class: 'rq-cat-field' }, [E('label', {}, ['域名列表追加到已有应用（选填）']), targetAppSel]),
			E('div', { class: 'rq-cat-field' }, [E('label', {}, ['或新建应用名称（纯域名列表时）']), targetNameInp])
		]);

		var resBox = null;
		if (state.importResult) {
			var r = state.importResult;
			if (r.ok) {
				resBox = E('div', { class: 'rq-cat-result is-good' }, [
					E('strong', {}, [
						'导入成功：新增 ' + String(r.added || 0) + ' 款 · 更新 ' + String(r.updated || 0) +
						' 款 · 跳过 ' + String(r.skipped || 0) + ' 项（当前共 ' + String(r.total_apps || 0) +
						' 款应用 / ' + String(r.total_domains || 0) + ' 个域名）'
					]),
					r.applied ? E('div', {}, ['已自动热同步至 nftables 与 dnsmasq 规则。']) : null,
					(r.warnings && r.warnings.length) ? E('div', { class: 'rq-note', style: 'margin:4px 0 0' }, [
						'提示：' + r.warnings.slice(0, 5).join('；')
					]) : null
				]);
			} else {
				resBox = E('div', { class: 'rq-cat-result is-error' }, [
					'导入失败：' + (r.error || '未知错误')
				]);
			}
		}

		var runBtn = canWrite ? E('button', {
			type: 'button',
			class: 'btn cbi-button cbi-button-apply',
			click: function() {
				if (state.busy) return;
				if (!textArea.value.trim()) {
					state.importResult = { ok: false, error: '请先粘贴导入内容或选择本地文件。' };
					renderModal();
					return;
				}
				if (modeSel.value === 'replace' && !window.confirm('确认使用导入内容【覆盖替换】当前整个特征库吗？可随时通过「恢复出厂库」还原。'))
					return;
				state.busy = true;
				runBtn.disabled = true;
				q.callAppCatalogImport(
					fmtSel.value,
					modeSel.value,
					textArea.value,
					defCatSel.value,
					targetAppSel.value,
					targetNameInp.value.trim()
				).then(function(res) {
					state.busy = false;
					runBtn.disabled = false;
					state.importResult = res || { ok: false, error: '返回为空' };
					if (res && res.ok) {
						state.dirty = true;
						return reloadCatalog();
					}
					renderModal();
				}).catch(function(err) {
					state.busy = false;
					runBtn.disabled = false;
					state.importResult = { ok: false, error: err && err.message ? err.message : String(err) };
					renderModal();
				});
			}
		}, ['开始批量导入并保存']) : null;

		return [
			E('div', { class: 'rq-cat-form-grid' }, [
				E('div', { class: 'rq-cat-field' }, [E('label', {}, ['导入模式']), modeSel]),
				E('div', { class: 'rq-cat-field' }, [E('label', {}, ['数据格式']), fmtSel])
			]),
			targetWrap,
			E('div', { class: 'rq-cat-field' }, [
				E('label', {}, ['从本地文件导入（.json / .csv / .txt）或一键填入示例']),
				E('div', { class: 'rq-cat-file-row' }, [
					fileInput,
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: function() { fmtSel.value = 'json'; textArea.value = SAMPLE_JSON_IMPORT; } }, ['JSON 示例']),
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: function() { fmtSel.value = 'lines'; textArea.value = SAMPLE_LINES_IMPORT; } }, ['文本行示例']),
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: function() { fmtSel.value = 'domains'; textArea.value = SAMPLE_DOMAINS_IMPORT; } }, ['域名列表示例'])
				])
			]),
			E('div', { class: 'rq-cat-field' }, [
				E('label', {}, ['批量导入内容']),
				textArea
			]),
			resBox,
			E('div', { class: 'rq-actions-row', style: 'padding-top:2px' }, [
				runBtn,
				E('span', { class: 'rq-note', style: 'margin:0' }, ['所有域名与端口均会做安全合法性校验并去重；保存后持久化于 /etc/rtl9617c-qos/app_signatures.json（升级保留）。'])
			])
		];
	}

	function renderModal() {
		var cat = state.catalog || { categories: [], apps: [], custom: false };
		var cats = cat.categories || [];
		var apps = cat.apps || [];
		var catNameMap = {};
		var domCount = 0;
		cats.forEach(function(c) { catNameMap[c.id] = c.name; });
		apps.forEach(function(a) { domCount += (a.domains || []).length; });

		var resetBtn = (L.hasViewPermission() && cat.custom) ? E('button', {
			type: 'button',
			class: 'btn cbi-button cbi-button-reset rq-btn-sm',
			click: function() {
				if (state.busy) return;
				if (!window.confirm('确认删除自定义覆盖文件并恢复为固件出厂特征库吗？'))
					return;
				state.busy = true;
				q.callAppCatalogReset().then(function(res) {
					state.busy = false;
					if (res && res.ok) {
						state.dirty = true;
						state.editing = null;
						state.importResult = null;
						ui.addNotification(null, E('p', {}, ['已恢复固件出厂应用特征库（共 ' + String(res.total_apps || 0) + ' 款应用）。']), 'info');
						return reloadCatalog();
					}
				}).catch(function(err) {
					state.busy = false;
					ui.addNotification(null, E('p', {}, ['恢复失败：', err && err.message ? err.message : String(err)]), 'error');
				});
			}
		}, ['恢复出厂库']) : null;

		var body = state.tab === 'import'
			? buildImportPanel(cats, apps)
			: buildManagePanel(cats, catNameMap, apps);

		dom.content(modalRoot, [
			E('div', { class: 'rq-cat-topbar' }, [
				E('div', { class: 'rq-cat-meta' }, [
					cat.custom ? q.badge('自定义持久化特征库', 'warn') : q.badge('出厂特征库', 'good'),
					E('span', {}, ['共 ' + String(apps.length) + ' 款应用 · ' + String(domCount) + ' 条域名']),
					cat.version ? E('span', { class: 'rq-mono' }, ['v' + cat.version]) : null
				]),
				E('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: downloadJson }, ['导出 JSON']),
					resetBtn
				])
			]),
			E('div', { class: 'rq-cat-tabs' }, [
				E('button', {
					type: 'button',
					class: 'rq-cat-tab' + (state.tab === 'manage' ? ' is-active' : ''),
					click: function() { state.tab = 'manage'; renderModal(); }
				}, ['特征列表与维护 (' + String(apps.length) + ')']),
				E('button', {
					type: 'button',
					class: 'rq-cat-tab' + (state.tab === 'import' ? ' is-active' : ''),
					click: function() { state.tab = 'import'; renderModal(); }
				}, ['批量导入 (JSON / 文本 / 域名)'])
			])
		].concat(body).concat([
			E('div', { class: 'rq-cat-footer' }, [
				E('span', { class: 'rq-note', style: 'margin:0' }, [
					state.dirty ? '特征库已变更，关闭弹窗后将自动刷新页面以更新下拉列表。' : '提示：支持增删改单项、批量合并/覆盖导入与导出备份。'
				]),
				E('div', {}, [
					E('button', { type: 'button', class: 'btn cbi-button cbi-button-action', click: closeModal }, [
						state.dirty ? '完成并刷新页面' : '关闭'
					])
				])
			])
		]));
	}

	ui.showModal('应用特征库维护与批量导入', [modalRoot]);
	reloadCatalog();
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
			'2. 应用特征库智能识别：当前已加载 ' + String((catIndex && catIndex.appCount) || 302) + ' 款应用特征（' + ((catIndex && catIndex.custom) ? '自定义持久化库' : '出厂精校库') + '），通过 dnsmasq nftset 自动追踪域名服务器 IP + 专用窄端口识别，零持续 CPU 开销且全程走芯片硬件加速；可随时点击下方【维护特征库 / 批量导入】自由增删或导入规则（注：仅对直连或绕过代理的流量生效）。',
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
				activeAppRules > 0
					? q.badge(String(activeAppRules) + ' 条特征规则' + ((catIndex && catIndex.custom) ? ' · 自定义库' : ''), 'good')
					: q.badge((catIndex && catIndex.custom) ? '自定义特征库' : '未启用', (catIndex && catIndex.custom) ? 'warn' : ''),
				[
					E('div', { class: 'rq-kpi' }, [
						'捕获 ' + String(nft.app_ip_total || 0) + ' 个服务器 IP'
					]),
					E('p', { class: 'rq-note' }, [
						appSetSummary.length
							? ('域名动态集合：' + appSetSummary.join(' · '))
							: ('已加载 ' + String((catIndex && catIndex.appCount) || 302) + ' 款应用特征，开启后通过 dnsmasq nftset + 专用端口自动识别。')
					]),
					E('div', { class: 'rq-actions-row' }, [
						E('button', {
							type: 'button',
							class: 'btn cbi-button cbi-button-action rq-btn-sm',
							click: function() {
								openCatalogManager('manage', function() { window.location.reload(); });
							}
						}, ['维护特征库 (' + String((catIndex && catIndex.appCount) || 302) + ')']),
						L.hasViewPermission() ? E('button', {
							type: 'button',
							class: 'btn cbi-button cbi-button-apply rq-btn-sm',
							click: function() {
								openCatalogManager('import', function() { window.location.reload(); });
							}
						}, ['批量导入']) : null
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
			appCount: (catalog.apps || []).length,
			custom: !!catalog.custom
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
