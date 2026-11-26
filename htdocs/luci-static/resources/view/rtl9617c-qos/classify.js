'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require ui';
'require rtl9617c-qos.common as q';

var COS_LABELS = {
	'7': _('CoS 7 · Highest Priority (Network Control / Critical)'),
	'6': _('CoS 6 · Very High Priority (Gaming / Voice Calls)'),
	'5': _('CoS 5 · High Priority (Video Conferencing / Live Interactive)'),
	'4': _('CoS 4 · Medium-High Priority (HD Video / Web Browsing)'),
	'3': _('CoS 3 · Above-Normal Priority (Daily Office / Cloud Storage)'),
	'2': _('CoS 2 · Normal Traffic (Default Baseline)'),
	'1': _('CoS 1 · Low Priority (Large Downloads / Sync)'),
	'0': _('CoS 0 · Lowest Queue (BT/Background Updates Deprioritized, or Default When No Baseline Set)')
};

var PROTO_LABELS = {
	'any': _('All Protocols'),
	'tcp': _('TCP (Web / Office / Video)'),
	'udp': _('UDP (Gaming / Voice / Live)'),
	'tcp_udp': _('TCP + UDP'),
	'icmp': _('ICMP (Ping)')
};

var DIR_LABELS = {
	'both': _('Bidirectional (Upload + Download)'),
	'src': _('Upload Only / Forward Match'),
	'dst': _('Download Only / Reverse Match')
};

function applyPresetHandler(presetId, presetTitle, btn) {
	btn.disabled = true;
	q.callApplyPreset(presetId).then(function(res) {
		btn.disabled = false;
		if (!res || !res.ok) {
			var errDetail = (res && (res.error ? _(res.error) : res.code)) || _('unknown');
			ui.addNotification(null, E('p', {}, [
				_('Failed to apply preset: %s').format(String(errDetail))
			]), 'error');
			return;
		}
		ui.addNotification(null, E('p', {}, [
			_('Successfully applied "%s" and pushed to hardware ASIC; refreshing page…').format(presetTitle)
		]), 'info');
		window.setTimeout(function() {
			window.location.reload();
		}, 400);
	}).catch(function(err) {
		btn.disabled = false;
		ui.addNotification(null, E('p', {}, [
			_('Failed to apply preset: %s').format(err && err.message ? err.message : String(err))
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
			if (sec.name && (sec.name.indexOf('High-Frequency Gaming') >= 0 || sec.name.indexOf('\u7f51\u7edc\u6e38\u620f') >= 0))
				hasGamingRule = true;
			if (sec.name && (sec.name.indexOf('Video Conferencing') >= 0 || sec.name.indexOf('\u89c6\u9891\u4f1a\u8bae') >= 0))
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
		'gaming': _('Currently Active: Preset 1 (Esports Gaming & Voice Anti-Lag)'),
		'office': _('Currently Active: Preset 2 (Work-From-Home & Video Conferencing Priority)'),
		'small_only': _('Currently Active: Preset 3 (Minimalist Smart Small-Packet Priority)'),
		'legacy': _('Legacy or incomplete preset detected: missing app signatures or drifted rules; re-applying a preset is recommended'),
		'custom': _('Current Status: Using Custom Rules'),
		'clear': _('Current Status: No Preset Active')
	};

	var presets = [
		{
			id: 'gaming',
			title: _('Preset 1: Esports Gaming & Voice Anti-Lag'),
			tagline: _('Recommended · One-click anti-ping-spike for gaming & voice'),
			desc: _('Automatically enables Smart Small-Packet Priority (<=256B -> CoS 6) and default normal traffic baseline CoS 2 + enables App Signature Library priority for mobile/PC games & voice meetings while deprioritizing BT/downloads to lowest queue 0 + DNS/high-frequency port rules + enables LAN1 (2.5G) and PON0 (optical uplink) ETS hybrid queueing (CoS 7-5 strict priority, 4-0 weighted) and WRED anti-bufferbloat.'),
			btnClass: 'btn cbi-button cbi-button-apply',
			btnText: _('Apply Gaming Preset')
		},
		{
			id: 'office',
			title: _('Preset 2: Work-From-Home & Video Conferencing Priority'),
			tagline: _('Remote Work · Smooth video meetings & web browsing'),
			desc: _('Automatically enables Smart Small-Packet Priority and default normal traffic baseline CoS 2 + enables App Signature Library priority for video conferencing, remote desktop, and online education while deprioritizing BT/downloads to lowest queue 0 + DNS/SSH/web priority rules + enables LAN1 and PON0 ETS hybrid priority queueing and WRED.'),
			btnClass: 'btn cbi-button cbi-button-action',
			btnText: _('Apply Office Preset')
		},
		{
			id: 'small_only',
			title: _('Preset 3: Minimalist Smart Small-Packet Priority (Zero Rules)'),
			tagline: _('Zero-Config · Pure hardware small-packet auto-detection'),
			desc: _('Adds no complex port rules; enables only the Smart Small-Packet Priority master switch and LAN1 hardware priority queueing, letting the ASIC automatically detect and prioritize small gaming, voice, Ping, and TCP handshake packets.'),
			btnClass: 'btn cbi-button cbi-button-action',
			btnText: _('Apply Small-Packet Preset')
		},
		{
			id: 'clear',
			title: _('Disable Preset / Full Manual Configuration'),
			tagline: _('Restore Defaults · Clear preset rules and configure from scratch'),
			desc: _('Disables small-packet priority and clears app classification rules on this page (without affecting device limits configured in Per-Device Rate Limiting), allowing you to add custom rules from scratch.'),
			btnClass: 'btn cbi-button cbi-button-reset',
			btnText: _('Disable Preset & Clear Rules')
		}
	];

	return q.card(_('One-Click Scenario Presets (rules can still be customized freely below after applying)'),
		q.badge(activeNames[activePreset] || _('4 presets available'),
			activePreset === 'legacy' ? 'warn' : (activePreset !== 'clear' ? 'good' : '')),
		[
			E('div', { class: 'rq-preset-grid' }, presets.map(function(p) {
				var isCurrent = (activePreset === p.id);
				var statusBadge;
				if (p.id === 'clear') {
					statusBadge = isCurrent
						? q.badge(_('No Preset Active'), '')
						: q.badge(_('Click to Disable Preset'), 'warn');
				} else {
					statusBadge = isCurrent
						? q.badge(_('Active'), 'good')
						: q.badge(_('Inactive'), '');
				}

				var btnLabel = isCurrent
					? (p.id === 'clear' ? _('Currently Default') : _('Active · Re-apply'))
					: p.btnText;

				var btn = L.hasViewPermission() ? E('button', {
					type: 'button',
					class: p.btnClass + ' rq-preset-action',
					click: function() {
						applyPresetHandler(p.id, p.title, btn);
					}
				}, [btnLabel]) : null;

				return q.card(p.title, statusBadge, [
					E('p', { class: 'rq-note rq-preset-tagline' }, [_('Best For: %s').format(p.tagline)]),
					E('p', { class: 'rq-note rq-preset-desc' }, [p.desc]),
					btn
				], 'rq-preset-card');
			}))
		]);
}

function getSampleJsonImport() {
	return JSON.stringify([
		{
			id: 'custom_geforce',
			name: _('Example: Cloud Gaming / Custom Boost'),
			cat: 'pc_game',
			domains: ['example-game.qq.com', 'match.example-game.com'],
			tcp: ['31003'],
			udp: ['17005', '27015-27030']
		},
		{
			name: _('Example: Custom Cloud Drive Deprioritize'),
			cat: 'download_bulk',
			domains: ['dl.example-cloud.cn'],
			tcp: [],
			udp: []
		}
	], null, 2);
}

function getSampleLinesImport() {
	return [
		_('# Format: CategoryID | App Name | Domain List (semicolon or space separated) | TCP Ports | UDP Ports'),
		_('# Common categories: mobile_game / pc_game / voice_meeting / remote_desk / education / im_chat / video_live / finance / download_bulk / custom'),
		_('voice_meeting | Example Voice Meeting | meet.example.com;rtc.example.com | 8801 | 8801-8810'),
		_('download_bulk | Example Background Download | dl.example.net;cdn.example.net | |')
	].join('\n');
}

function getSampleDomainsImport() {
	return [
		_('# One domain per line; also supports Clash DOMAIN-SUFFIX / *.wildcard / +.prefix'),
		'DOMAIN-SUFFIX,pvp.qq.com',
		'*.smoba.qq.com',
		'match.example-game.cn'
	].join('\n');
}

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
		E('p', { class: 'rq-note' }, [_('Loading full app signature catalog…')])
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
					_('Failed to load signature catalog: %s').format(err && err.message ? err.message : String(err))
				]),
				E('div', { class: 'rq-cat-footer' }, [
					E('span'),
					E('button', { type: 'button', class: 'btn cbi-button', click: closeModal }, [_('Close')])
				])
			]);
		});
	}

	function buildManagePanel(cats, catNameMap, apps) {
		var canWrite = L.hasViewPermission();
		var listMount = E('div', { class: 'rq-cat-list-wrap' });
		var composing = false;

		function renderList() {
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
				if ((catNameMap[a.cat] || '').toLowerCase().indexOf(qLower) >= 0)
					return true;
				if ((a.cat || '').toLowerCase().indexOf(qLower) >= 0)
					return true;
				if ((a.domains || []).some(function(d) { return d.toLowerCase().indexOf(qLower) >= 0; }))
					return true;
				if ((a.tcp || []).concat(a.udp || []).some(function(p) { return String(p).toLowerCase().indexOf(qLower) >= 0; }))
					return true;
				return false;
			});

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
					chips.push(E('span', { class: 'rq-cat-chip' }, [_('+%d domains').format(doms.length - 4)]));
				if (tcp.length)
					chips.push(E('span', { class: 'rq-cat-chip rq-mono' }, ['TCP: ' + tcp.slice(0, 3).join(',') + (tcp.length > 3 ? '…' : '')]));
				if (udp.length)
					chips.push(E('span', { class: 'rq-cat-chip rq-mono' }, ['UDP: ' + udp.slice(0, 3).join(',') + (udp.length > 3 ? '…' : '')]));

				return E('tr', {}, [
					E('td', { class: 'rq-wrap' }, [
						E('strong', {}, [a.name ? _(a.name) : '']),
						E('div', { class: 'rq-note', style: 'margin:2px 0 0' }, [
							_('%s · ID: %s').format(catNameMap[a.cat] || a.cat, a.id)
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
							}, [_('Edit')]),
							E('button', {
								type: 'button',
								class: 'btn cbi-button cbi-button-remove rq-btn-sm',
								click: function() {
									if (state.busy) return;
									if (!window.confirm(_('Remove "%s" (%s) from the signature catalog?').format(a.name ? _(a.name) : a.id, a.id)))
										return;
									state.busy = true;
									q.callAppCatalogDeleteApp(a.id).then(function(res) {
										state.busy = false;
										if (!res || !res.ok) {
											ui.addNotification(null, E('p', {}, [_('Delete failed: %s').format((res && res.error) ? _(res.error) : _('unknown'))]), 'error');
											return;
										}
										state.dirty = true;
										return reloadCatalog();
									}).catch(function(err) {
										state.busy = false;
										ui.addNotification(null, E('p', {}, [_('Delete error: %s').format(err && err.message ? err.message : String(err))]), 'error');
									});
								}
							}, [_('Delete')])
						])
					]) : null
				]);
			});

			if (!rows.length) {
				rows.push(E('tr', {}, [
					E('td', { colspan: canWrite ? 3 : 2, class: 'rq-note' }, [_('No app signatures match the current filter.')])
				]));
			}

			var moreBtn = filtered.length > visible.length ? E('button', {
				type: 'button',
				class: 'btn cbi-button rq-btn-sm',
				style: 'margin:8px auto;display:flex',
				click: function() {
					state.limit = filtered.length;
					renderList();
				}
			}, [_('Show all %d entries (showing first %d)').format(filtered.length, visible.length)]) : null;

			var colTitle = (qLower || state.filterCat)
				? _('App / Category (%d matched)').format(filtered.length)
				: _('App / Category');

			dom.content(listMount, [
				E('table', { class: 'rq-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, [colTitle]),
							E('th', {}, [_('Domain & Port Signatures')]),
							canWrite ? E('th', {}, [_('Action')]) : null
						])
					]),
					E('tbody', {}, rows)
				]),
				moreBtn
			]);
		}

		var catSel = E('select', {
			change: function(ev) {
				state.filterCat = ev.target.value;
				state.limit = 80;
				renderList();
			}
		}, [E('option', { value: '' }, [_('All Categories (%d apps)').format(apps.length)])].concat(cats.map(function(c) {
			return E('option', {
				value: c.id,
				title: c.desc ? _(c.desc) : null,
				selected: state.filterCat === c.id ? 'selected' : null
			}, [(c.name ? _(c.name) : c.id) + ' (' + (c.count || 0) + ')']);
		})));

		var searchInput = E('input', {
			type: 'search',
			value: state.query,
			placeholder: _('Filter by app name / ID / domain / port…'),
			compositionstart: function() {
				composing = true;
			},
			compositionend: function(ev) {
				composing = false;
				state.query = ev.target.value;
				state.limit = 80;
				renderList();
			},
			input: function(ev) {
				if (composing)
					return;
				state.query = ev.target.value;
				state.limit = 80;
				renderList();
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
		}, [_('+ Add App Signature')]) : null;

		var editorNode = null;
		if (state.editing && canWrite) {
			var ed = state.editing;
			var inpName = E('input', { type: 'text', value: ed.name || '', placeholder: _('e.g., Genshin Impact / Custom Office App') });
			var selCat = E('select', {}, cats.map(function(c) {
				return E('option', {
					value: c.id,
					title: c.desc ? _(c.desc) : null,
					selected: (ed.cat || 'custom') === c.id ? 'selected' : null
				}, [(c.name ? _(c.name) : c.id) + ' (' + c.id + ')']);
			}));
			var inpId = E('input', { type: 'text', value: ed.id || '', placeholder: _('Leave blank to auto-generate, e.g., custom_app1') });
			var inpDoms = E('textarea', { placeholder: _('One domain per line or comma-separated; supports *.example.com and Clash DOMAIN-SUFFIX,example.com') }, [ed.domains || '']);
			var inpTcp = E('input', { type: 'text', value: ed.tcp || '', placeholder: _('e.g., 31003, 50011-50016 (optional)') });
			var inpUdp = E('input', { type: 'text', value: ed.udp || '', placeholder: _('e.g., 8000-8100, 17005 (optional)') });
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
							edErr.textContent = (res && res.error) ? _(res.error) : _('Save failed');
							edErr.style.display = 'block';
							return;
						}
						state.dirty = true;
						state.editing = null;
						ui.addNotification(null, E('p', {}, [
							res.applied
								? _('Saved app signature "%s" and synced running hardware QoS rules.').format(res.entry.name)
								: _('Saved app signature "%s" (written to persistent custom catalog).').format(res.entry.name)
						]), 'info');
						return reloadCatalog();
					}).catch(function(err) {
						state.busy = false;
						saveBtn.disabled = false;
						edErr.textContent = _('Save error: %s').format(err && err.message ? err.message : String(err));
						edErr.style.display = 'block';
					});
				}
			}, [ed.orig_id ? _('Save Changes') : _('Save & Add to Catalog')]);

			editorNode = E('div', { class: 'rq-cat-editor' }, [
				E('strong', {}, [ed.orig_id ? _('Edit App Signature: %s (%s)').format(ed.name, ed.orig_id) : _('Add App Signature')]),
				E('div', { class: 'rq-cat-form-grid' }, [
					E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('App Name *')]), inpName]),
					E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Category *')]), selCat]),
					E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('App ID (Optional)')]), inpId])
				]),
				E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Matching Domains (auto-tracked via dnsmasq nftset)')]), inpDoms]),
				E('div', { class: 'rq-cat-form-grid' }, [
					E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Dedicated TCP Ports / Ranges')]), inpTcp]),
					E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Dedicated UDP Ports / Ranges')]), inpUdp])
				]),
				edErr,
				E('div', { class: 'rq-actions-row', style: 'padding-top:2px' }, [
					saveBtn,
					E('button', {
						type: 'button',
						class: 'btn cbi-button',
						click: function() { state.editing = null; renderModal(); }
					}, [_('Cancel')])
				])
			]);
		}

		renderList();

		return [
			E('div', { class: 'rq-cat-toolbar' }, [catSel, searchInput, addBtn]),
			editorNode,
			listMount
		];
	}

	function buildImportPanel(cats, apps) {
		var canWrite = L.hasViewPermission();
		var modeSel = E('select', {}, [
			E('option', { value: 'merge' }, [_('Merge & Update (keep existing signatures, add or update matches)')]),
			E('option', { value: 'replace' }, [_('Replace All (clear current list and replace with imported content)')])
		]);
		var fmtSel = E('select', {}, [
			E('option', { value: 'auto' }, [_('Auto-Detect (Recommended · JSON / Tabular Text / Clash Domain Rules)')]),
			E('option', { value: 'json' }, [_('JSON Signature Catalog (full export file or array of app objects)')]),
			E('option', { value: 'lines' }, [_('Tabular / Text Lines (Category|Name|Domains|TCP|UDP or CSV)')]),
			E('option', { value: 'domains' }, [_('Plain Domain List into Target App (deduplicated & merged)')])
		]);
		var defCatSel = E('select', {}, cats.map(function(c) {
			return E('option', {
				value: c.id,
				title: c.desc ? _(c.desc) : null,
				selected: c.id === 'custom' ? 'selected' : null
			}, [(c.name ? _(c.name) : c.id) + ' (' + c.id + ')']);
		}));
		var targetAppSel = E('select', {}, [
			E('option', { value: '' }, [_('Create New App (enter new app name on the right)')])
		].concat(apps.map(function(a) {
			return E('option', { value: a.id }, [(a.name ? _(a.name) : a.id) + ' (' + a.id + ')']);
		})));
		var targetNameInp = E('input', { type: 'text', placeholder: _('Only for new domain group, e.g., Company Intranet') });
		var textArea = E('textarea', {
			style: 'min-height:170px',
			placeholder: _('Paste JSON, tabular lines (Category|Name|Domains|TCP|UDP), or Clash/plain domain list here, or choose a local file above…')
		});
		var fileInput = E('input', {
			type: 'file',
			accept: '.json,.txt,.csv,.list,application/json,text/plain',
			change: function(ev) {
				var file = ev.target.files && ev.target.files[0];
				if (!file) return;
				if (file.size > 524288) {
					state.importResult = { ok: false, error: _('File exceeds the 512 KB limit; please trim it before importing.') };
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
			E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Default Category (used when category is omitted)')]), defCatSel]),
			E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Append Domain List to Existing App (Optional)')]), targetAppSel]),
			E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Or New App Name (for plain domain list)')]), targetNameInp])
		]);

		var resBox = null;
		if (state.importResult) {
			var r = state.importResult;
			if (r.ok) {
				resBox = E('div', { class: 'rq-cat-result is-good' }, [
					E('strong', {}, [
						_('Import succeeded: %d added · %d updated · %d skipped (total %d apps / %d domains)').format(
							r.added || 0,
							r.updated || 0,
							r.skipped || 0,
							r.total_apps || 0,
							r.total_domains || 0
						)
					]),
					r.applied ? E('div', {}, [_('Automatically hot-synced to nftables and dnsmasq rules.')]) : null,
					(r.warnings && r.warnings.length) ? E('div', { class: 'rq-note', style: 'margin:4px 0 0' }, [
						_('Notes: %s').format(r.warnings.slice(0, 5).map(function(w) { return _(w); }).join('; '))
					]) : null
				]);
			} else {
				resBox = E('div', { class: 'rq-cat-result is-error' }, [
					_('Import failed: %s').format(r.error ? _(r.error) : _('Unknown error'))
				]);
			}
		}

		var runBtn = canWrite ? E('button', {
			type: 'button',
			class: 'btn cbi-button cbi-button-apply',
			click: function() {
				if (state.busy) return;
				if (!textArea.value.trim()) {
					state.importResult = { ok: false, error: _('Please paste import content or select a local file first.') };
					renderModal();
					return;
				}
				if (modeSel.value === 'replace' && !window.confirm(_('Confirm replacing the entire current signature catalog with the imported content? You can restore the factory catalog at any time via "Restore Factory Catalog".')))
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
					state.importResult = res || { ok: false, error: _('Empty response') };
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
		}, [_('Start Batch Import & Save')]) : null;

		return [
			E('div', { class: 'rq-cat-form-grid' }, [
				E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Import Mode')]), modeSel]),
				E('div', { class: 'rq-cat-field' }, [E('label', {}, [_('Data Format')]), fmtSel])
			]),
			targetWrap,
			E('div', { class: 'rq-cat-field' }, [
				E('label', {}, [_('Import from Local File (.json / .csv / .txt) or Fill Sample')]),
				E('div', { class: 'rq-cat-file-row' }, [
					fileInput,
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: function() { fmtSel.value = 'json'; textArea.value = getSampleJsonImport(); } }, [_('JSON Sample')]),
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: function() { fmtSel.value = 'lines'; textArea.value = getSampleLinesImport(); } }, [_('Text Lines Sample')]),
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: function() { fmtSel.value = 'domains'; textArea.value = getSampleDomainsImport(); } }, [_('Domain List Sample')])
				])
			]),
			E('div', { class: 'rq-cat-field' }, [
				E('label', {}, [_('Batch Import Content')]),
				textArea
			]),
			resBox,
			E('div', { class: 'rq-actions-row', style: 'padding-top:2px' }, [
				runBtn,
				E('span', { class: 'rq-note', style: 'margin:0' }, [_('All domains and ports are validated and deduplicated; saved persistently to /etc/rtl9617c-qos/app_signatures.json (survives sysupgrade).')])
			])
		];
	}

	function renderModal() {
		var cat = state.catalog || { categories: [], apps: [], custom: false };
		var cats = cat.categories || [];
		var apps = cat.apps || [];
		var catNameMap = {};
		var domCount = 0;
		cats.forEach(function(c) { catNameMap[c.id] = c.name ? _(c.name) : c.id; });
		apps.forEach(function(a) { domCount += (a.domains || []).length; });

		var resetBtn = (L.hasViewPermission() && cat.custom) ? E('button', {
			type: 'button',
			class: 'btn cbi-button cbi-button-reset rq-btn-sm',
			click: function() {
				if (state.busy) return;
				if (!window.confirm(_('Delete the custom override file and restore the factory signature catalog?')))
					return;
				state.busy = true;
				q.callAppCatalogReset().then(function(res) {
					state.busy = false;
					if (res && res.ok) {
						state.dirty = true;
						state.editing = null;
						state.importResult = null;
						ui.addNotification(null, E('p', {}, [_('Restored factory app signature catalog (%d apps total).').format(res.total_apps || 0)]), 'info');
						return reloadCatalog();
					}
				}).catch(function(err) {
					state.busy = false;
					ui.addNotification(null, E('p', {}, [_('Restore failed: %s').format(err && err.message ? err.message : String(err))]), 'error');
				});
			}
		}, [_('Restore Factory Catalog')]) : null;

		var body = state.tab === 'import'
			? buildImportPanel(cats, apps)
			: buildManagePanel(cats, catNameMap, apps);

		dom.content(modalRoot, [
			E('div', { class: 'rq-cat-topbar' }, [
				E('div', { class: 'rq-cat-meta' }, [
					cat.custom ? q.badge(_('Custom Persistent Catalog'), 'warn') : q.badge(_('Factory Catalog'), 'good'),
					E('span', {}, [_('%d apps total · %d domains').format(apps.length, domCount)]),
					cat.version ? E('span', { class: 'rq-mono' }, ['v' + cat.version]) : null
				]),
				E('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
					E('button', { type: 'button', class: 'btn cbi-button rq-btn-sm', click: downloadJson }, [_('Export JSON')]),
					resetBtn
				])
			]),
			E('div', { class: 'rq-cat-tabs' }, [
				E('button', {
					type: 'button',
					class: 'rq-cat-tab' + (state.tab === 'manage' ? ' is-active' : ''),
					click: function() { state.tab = 'manage'; renderModal(); }
				}, [_('Signature List & Maintenance (%d)').format(apps.length)]),
				E('button', {
					type: 'button',
					class: 'rq-cat-tab' + (state.tab === 'import' ? ' is-active' : ''),
					click: function() { state.tab = 'import'; renderModal(); }
				}, [_('Batch Import (JSON / Text / Domains)')])
			])
		].concat(body).concat([
			E('div', { class: 'rq-cat-footer' }, [
				E('span', { class: 'rq-note', style: 'margin:0' }, [
					state.dirty
						? _('Catalog changed; closing this dialog will refresh the page to update dropdown lists.')
						: _('Tip: supports adding/editing/deleting individual entries, batch merge/replace import, and JSON backup export.')
				]),
				E('div', {}, [
					E('button', { type: 'button', class: 'btn cbi-button cbi-button-action', click: closeModal }, [
						state.dirty ? _('Done & Refresh Page') : _('Close')
					])
				])
			])
		]));
	}

	ui.showModal(_('App Signature Catalog Maintenance & Batch Import'), [modalRoot]);
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
			E('td', {}, [E('strong', {}, [_('⚡ Smart Small-Packet Priority (Built-in Zero-Config Boost)')])]),
			E('td', {}, [
				spEnabled
					? (spStat.instances > 0 ? q.badge(_('Active'), 'good') : q.badge(_('Pending Apply'), 'warn'))
					: q.badge(_('Disabled'), '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[spCos] || _('CoS %s').format(spCos), Number(spCos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [
				_('Packet size <= %s Bytes · %s').format(
					spBytes,
					spMode === 'all' ? _('All protocols (TCP+UDP+ICMP)') : _('Smart mode (UDP gaming/voice + Ping + DNS + SSH)')
				)
			]),
			E('td', {}, [_('Bidirectional (Upload + Download)')]),
			E('td', { class: 'rq-mono' }, [_('%d pkts').format(spStat.packets || 0)]),
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
			E('td', {}, [E('strong', {}, [_('🌐 App Domain Dynamic Tracking (CoS %d)').format(c)])]),
			E('td', {}, [q.badge(_('Active'), 'good')]),
			E('td', {}, [
				q.badge(COS_LABELS[String(c)] || _('CoS %s').format(String(c)), c >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [
				_('dnsmasq nftset auto-captured server IPs: %d IPv4 · %d IPv6 (12h rolling cache)').format(sc.v4 || 0, sc.v6 || 0)
			]),
			E('td', {}, [_('Bidirectional (Upload + Download)')]),
			E('td', { class: 'rq-mono' }, [_('%d pkts').format(ds.packets || 0)]),
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
			title = _('🎮 Catalog App: %s').format(ap ? _(ap.name) : (sec.app_id || id));
			detail = ap
				? _('Domain tracking: %d · Dedicated TCP: %d · UDP: %d').format(ap.d_cnt, ap.t_cnt, ap.u_cnt)
				: _('App ID: %s').format(sec.app_id || _('Not selected'));
		} else {
			var ct = catById[sec.category];
			title = _('📦 Catalog Category: %s').format(ct ? (ct.name ? _(ct.name) : ct.id) : (sec.category || id));
			detail = ct
				? _('Covers %d apps (auto-merges dynamic domain tracking + dedicated narrow ports)').format(ct.count)
				: _('Category: %s').format(sec.category || _('Not selected'));
		}
		if (sec.dscp_set)
			detail += ' · ' + _('Rewrite DSCP -> %s').format(sec.dscp_set);

		var isLive = st.instances > 0 || domLive;
		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, [title])]),
			E('td', {}, [
				enabled
					? (isLive ? q.badge(_('Active'), 'good') : q.badge(_('Pending Apply'), 'warn'))
					: q.badge(_('Disabled'), '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[cos] || _('CoS %s').format(cos), Number(cos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [detail]),
			E('td', {}, [_('Bidirectional (Upload + Download)')]),
			E('td', { class: 'rq-mono' }, [
				st.instances > 0 ? _('%d pkts (ports)').format(st.packets || 0) : _('Counted in domain tracking above')
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
			criteria.push(_('Proto: %s').format(PROTO_LABELS[sec.proto] || sec.proto));
		if (sec.src_ip)
			criteria.push(_('Src IP: %s').format(sec.src_ip));
		if (sec.dst_ip)
			criteria.push(_('Dst IP: %s').format(sec.dst_ip));
		if (sec.src_port)
			criteria.push(_('Src Port: %s').format(sec.src_port));
		if (sec.dst_port)
			criteria.push(_('Dst Port: %s').format(sec.dst_port));
		if (sec.dscp)
			criteria.push(_('Match DSCP: %s').format(sec.dscp));
		if (sec.dscp_set)
			criteria.push(_('Rewrite DSCP -> %s').format(sec.dscp_set));
		if (sec.src_mac)
			criteria.push(_('Device MAC: %s').format(sec.src_mac));

		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, [sec.name ? _(sec.name) : id])]),
			E('td', {}, [
				enabled
					? (st.instances > 0 ? q.badge(_('Active'), 'good') : q.badge(_('Pending Apply'), 'warn'))
					: q.badge(_('Disabled'), '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[cos] || _('CoS %s').format(cos), Number(cos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [criteria.length ? criteria.join(' · ') : _('(No match criteria specified)')]),
			E('td', {}, [DIR_LABELS[sec.direction || 'both'] || _('Bidirectional')]),
			E('td', { class: 'rq-mono' }, [_('%d pkts').format(st.packets || 0)]),
			E('td', { class: 'rq-mono' }, [q.formatBytes(st.bytes || 0)])
		]));
	});

	var defCos = String(uci.get('rtl9617c_qos', 'global', 'default_cos') || '0');
	var defStat = ruleMap['__default'] || { packets: 0, bytes: 0, instances: 0 };
	if (Number(defCos) > 0 || defStat.instances > 0) {
		rows.push(E('tr', {}, [
			E('td', {}, [E('strong', {}, [_('📌 Unmatched Normal Traffic Baseline')])]),
			E('td', {}, [
				Number(defCos) > 0
					? (defStat.instances > 0 ? q.badge(_('Active'), 'good') : q.badge(_('Pending Apply'), 'warn'))
					: q.badge(_('Disabled'), '')
			]),
			E('td', {}, [
				q.badge(COS_LABELS[defCos] || _('CoS %s').format(defCos), Number(defCos) >= 5 ? 'good' : '')
			]),
			E('td', { class: 'rq-mono rq-wrap' }, [_('Remaining direct traffic not matching rules above defaults to this baseline queue')]),
			E('td', {}, [_('Bidirectional (Upload + Download)')]),
			E('td', { class: 'rq-mono' }, [_('%d pkts').format(defStat.packets || 0)]),
			E('td', { class: 'rq-mono' }, [q.formatBytes(defStat.bytes || 0)])
		]));
	}

	if (!rows.length) {
		rows.push(E('tr', {}, [
			E('td', { colspan: 7, class: 'rq-note' }, [
				_('No app or game priority rules added yet. Click "Add" below to set higher priority for your main PC, gaming console, or specific game ports.')
			])
		]));
	}

	var highFlows = fe.cos_high != null ? fe.cos_high : (fe.cos_explicit || 0);
	var totalFlows = fe.total || 0;

	var appSetSummary = [];
	Object.keys(appSets).sort().reverse().forEach(function(k) {
		var v = appSets[k];
		appSetSummary.push(_('CoS %s: %d v4 / %d v6').format(k.slice(1), v.v4 || 0, v.v6 || 0));
	});

	dom.content(container, [
		q.guideCard(_('How to Use (Keep Gaming, Voice & Primary Devices Lag-Free)'), [
			_('1. Easiest setup: click "Esports Gaming & Voice Anti-Lag" or "Work-From-Home & Video Conferencing Priority" under "One-Click Scenario Presets" below to automatically enable small-packet priority, load the app signature catalog, and configure port hardware queueing.'),
			_('2. Smart App Signature Detection: %d app signatures loaded (%s), using dnsmasq nftset to dynamically track domain server IPs + dedicated narrow-port matching with zero ongoing CPU overhead and full ASIC hardware acceleration. Click "Manage Catalog / Batch Import" below to add, edit, or import rules freely (applies to direct or proxy-bypassed traffic).').format(
				(catIndex && catIndex.appCount) || 302,
				(catIndex && catIndex.custom) ? _('custom persistent catalog') : _('curated factory catalog')
			),
			_('3. Advanced customization: you can also add, edit, or delete rules by LAN device IP (e.g. 192.168.2.100), MAC, or specific game ports in the "Custom Priority Forwarding Rules" section at the bottom.')
		]),
		renderPresetCard(),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Priority Classification Engine'),
				nft.active ? q.badge(_('Loaded & Active'), 'good') : q.badge(_('Not enabled'), ''),
				[
					E('div', { class: 'rq-kpi' }, [
						_('%d rules active').format(Object.keys(ruleMap).length)
					]),
					E('p', { class: 'rq-note' }, [
						_('The router identifies app/device priority on the first packet of a connection and programs it into the hardware acceleration table immediately, so all subsequent packets are forwarded at ASIC line rate.')
					])
				]),
			q.card(_('App Signature Detection'),
				activeAppRules > 0
					? q.badge((catIndex && catIndex.custom) ? _('%d signature rules · Custom').format(activeAppRules) : _('%d signature rules').format(activeAppRules), 'good')
					: q.badge((catIndex && catIndex.custom) ? _('Custom Catalog') : _('Not enabled'), (catIndex && catIndex.custom) ? 'warn' : ''),
				[
					E('div', { class: 'rq-kpi' }, [
						_('%d server IPs captured').format(nft.app_ip_total || 0)
					]),
					E('p', { class: 'rq-note' }, [
						appSetSummary.length
							? _('Dynamic domain sets: %s').format(appSetSummary.join(' · '))
							: _('%d app signatures loaded; once enabled, auto-detects via dnsmasq nftset + dedicated ports.').format((catIndex && catIndex.appCount) || 302)
					]),
					E('div', { class: 'rq-actions-row' }, [
						E('button', {
							type: 'button',
							class: 'btn cbi-button cbi-button-action rq-btn-sm',
							click: function() {
								openCatalogManager('manage', function() { window.location.reload(); });
							}
						}, [_('Manage Catalog (%d)').format((catIndex && catIndex.appCount) || 302)]),
						L.hasViewPermission() ? E('button', {
							type: 'button',
							class: 'btn cbi-button cbi-button-apply rq-btn-sm',
							click: function() {
								openCatalogManager('import', function() { window.location.reload(); });
							}
						}, [_('Batch Import')]) : null
					])
				]),
			q.card(_('Accelerated High-Priority Flows'),
				highFlows > 0
					? q.badge(_('High-Priority Active'), 'good')
					: q.badge(_('Hardware Priority Path'), ''),
				q.activeFlowSummary(
					highFlows,
					totalFlows,
					_('Currently %d live hardware-accelerated flows (varying dynamically as connections open/age): High-priority (CoS 5-7): %d · Normal (CoS 2-4): %d · Low-priority (CoS 0-1): %d.').format(
						totalFlows,
						highFlows,
						fe.cos_normal || 0,
						fe.cos_low || 0
					)
				))
		]),
		q.card(_('Active Priority Forwarding Rules & Hit Statistics'), null, [
			E('div', { class: 'rq-table-wrap' }, [
				E('table', { class: 'rq-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, [_('Rule Name')]),
							E('th', {}, [_('Status')]),
							E('th', {}, [_('Priority Level')]),
							E('th', {}, [_('Match Criteria')]),
							E('th', {}, [_('Direction')]),
							E('th', {}, [_('Matched Packets')]),
							E('th', {}, [_('Matched Traffic')])
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
			_('Smart Small-Packet Priority (Zero-Config Boost for Gaming / Voice / Web Responsiveness)'));
		sg.anonymous = true;
		sg.addremove = false;

		var go;
		go = sg.option(form.Flag, 'small_pkt_prio', _('Enable Smart Small-Packet Priority'),
			_('When enabled, the router automatically detects small packets and assigns higher hardware forwarding priority, avoiding manual port lookups.'));
		go.default = '0';
		go.rmempty = false;

		go = sg.option(form.ListValue, 'small_pkt_mode', _('Small-Packet Detection Mode'),
			_('Recommended: "Smart Mode", which boosts UDP gaming/voice small packets, Ping, DNS, and SSH control packets while preventing large TCP download ACKs from boosting an entire bulk download flow.'));
		go.depends('small_pkt_prio', '1');
		go.default = 'udp_icmp';
		go.value('udp_icmp', _('Smart Mode (Recommended · UDP gaming/voice small packets + Ping + DNS + SSH)'));
		go.value('all', _('All-Protocol Mode (prioritize all TCP + UDP + ICMP packets below threshold)'));

		go = sg.option(form.Value, 'small_pkt_bytes', _('Small-Packet Size Threshold (Bytes)'),
			_('Packets whose total length is less than or equal to this value are classified as small packets (range 64 ~ 1024; recommended default 256 bytes).'));
		go.depends('small_pkt_prio', '1');
		go.datatype = 'range(64,1024)';
		go.default = '256';
		go.value('128', _('128 bytes (tiny control / voice frames only)'));
		go.value('256', _('256 bytes (recommended · covers most gaming & voice packets)'));
		go.value('384', _('384 bytes (covers larger game state sync packets)'));
		go.value('512', _('512 bytes (relaxed small-packet threshold)'));

		go = sg.option(form.ListValue, 'small_pkt_cos', _('Priority Level for Small Packets'));
		go.depends('small_pkt_prio', '1');
		go.default = '6';
		for (var sp = 7; sp >= 1; sp--)
			go.value(String(sp), COS_LABELS[String(sp)]);

		go = sg.option(form.ListValue, 'default_cos', _('Baseline Priority Level for Unmatched Normal Traffic'),
			_('Sets a baseline priority for normal traffic that does not match rules above or small-packet detection (recommended: 2, so BT/background downloads set to CoS 0/1 stay strictly below normal browsing).'));
		go.default = '0';
		go.rmempty = false;
		go.value('0', _('0 (No extra marking · keep unmatched traffic in lowest queue 0)'));
		for (var dc = 7; dc >= 1; dc--)
			go.value(String(dc), COS_LABELS[String(dc)]);

		var sa = m.section(form.GridSection, 'app_rule',
			_('App Signature Smart Detection (%d built-in apps · dynamic domain tracking + dedicated ports)').format(catIndex.appCount || 302),
			_('Add rules directly by app category (e.g., mobile games, PC games, video conferencing, download/cloud-drive deprioritize) or by specific app name without looking up port numbers. Per-app rules take precedence over category rules; once enabled, dnsmasq nftset tracks server IPs and syncs with ASIC hardware acceleration.'));
		sa.addremove = true;
		sa.anonymous = true;
		sa.sortable = true;
		sa.nodescriptions = true;

		var ao;
		ao = sa.option(form.Flag, 'enabled', _('Enable'));
		ao.default = '1';
		ao.rmempty = false;
		ao.editable = true;

		ao = sa.option(form.ListValue, 'match_type', _('Match Method'));
		ao.default = 'category';
		ao.rmempty = false;
		ao.value('category', _('Match by App Category'));
		ao.value('app', _('Match Specific App'));

		ao = sa.option(form.ListValue, 'category', _('App Category'));
		ao.depends('match_type', 'category');
		ao.default = 'mobile_game';
		(catalog.categories || []).forEach(function(c) {
			ao.value(c.id, _('%s (%d apps · recommended CoS %d)').format(c.name ? _(c.name) : c.id, c.count, c.default_cos));
		});

		ao = sa.option(form.ListValue, 'app_id', _('Specific App'));
		ao.depends('match_type', 'app');
		(catalog.apps || []).forEach(function(a) {
			var cname = catById[a.cat] ? (catById[a.cat].name ? _(catById[a.cat].name) : a.cat) : a.cat;
			ao.value(a.id, _('[%s] %s (%d domains / %d ports)').format(cname, a.name ? _(a.name) : a.id, a.d_cnt, a.t_cnt + a.u_cnt));
		});

		ao = sa.option(form.ListValue, 'cos', _('Priority Level (0~7)'));
		ao.default = '6';
		ao.rmempty = false;
		for (var ap = 7; ap >= 0; ap--)
			ao.value(String(ap), COS_LABELS[String(ap)]);

		ao = sa.option(form.Value, 'dscp_set', _('Rewrite Outbound Mark (DSCP)'));
		ao.modalonly = true;
		ao.placeholder = _('Leave blank = do not rewrite');
		ao.rmempty = true;
		[
			['ef', _('ef (46 · rewrite as ultra-low-latency voice/gaming mark)')],
			['cs6', _('cs6 (48 · rewrite as highest-priority network control mark)')],
			['cs5', _('cs5 (40 · rewrite as real-time video/live-streaming mark)')],
			['af41', _('af41 (34 · rewrite as video conferencing mark)')],
			['cs1', _('cs1 (8 · rewrite as low-priority background mark)')],
			['cs0', _('cs0 (0 · clear DSCP mark to default 0)')]
		].forEach(function(pair) {
			ao.value(pair[0], pair[1]);
		});

		var s = m.section(form.GridSection, 'classify', _('Custom Priority Forwarding Rules (Evaluated Top-to-Bottom; Freely Editable)'),
			_('Each rule must specify at least one match criterion (such as LAN device IP, MAC, game port, or DSCP mark). When "Bidirectional (Upload + Download)" is selected, return download traffic is automatically matched into the same priority level.'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;

		var o;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;
		o.editable = true;

		o = s.option(form.Value, 'name', _('Rule Name'));
		o.placeholder = _('e.g., Main PC Gaming Priority / Video Conference Priority');
		o.rmempty = false;

		o = s.option(form.ListValue, 'cos', _('Priority Level (0~7)'));
		o.default = '6';
		o.rmempty = false;
		for (var p = 7; p >= 0; p--)
			o.value(String(p), COS_LABELS[String(p)]);

		o = s.option(form.ListValue, 'family', _('IP Family'));
		o.default = 'any';
		o.value('any', _('IPv4 + IPv6 Dual Stack'));
		o.value('ip', _('IPv4 Only'));
		o.value('ip6', _('IPv6 Only'));

		o = s.option(form.ListValue, 'proto', _('Protocol'));
		o.default = 'any';
		o.value('any', _('All Protocols'));
		o.value('tcp', _('TCP (Web / Office / Video)'));
		o.value('udp', _('UDP (Gaming / Voice Calls / Live)'));
		o.value('tcp_udp', _('TCP + UDP'));
		o.value('icmp', _('ICMP / Ping Test'));

		o = s.option(form.Value, 'src_ip', _('Source IP (LAN Device Address)'));
		o.placeholder = _('Leave blank = any, e.g. 192.168.2.100');
		o.rmempty = true;

		o = s.option(form.Value, 'dst_ip', _('Destination IP (Remote Server)'));
		o.placeholder = _('Leave blank = any, or server IP/CIDR');
		o.rmempty = true;

		o = s.option(form.Value, 'src_port', _('Source Port'));
		o.placeholder = _('Leave blank = any');
		o.rmempty = true;

		o = s.option(form.Value, 'dst_port', _('Destination Port (Game / App Port)'));
		o.placeholder = _('e.g. 53, 3074, 27015-27030');
		o.rmempty = true;

		o = s.option(form.Value, 'dscp', _('Match App Mark (DSCP)'));
		o.placeholder = _('Leave blank = any, or select ef / cs5 / af41');
		o.rmempty = true;
		[
			['ef', _('ef (46 · voice calls / ultra-low-latency gaming mark)')],
			['cs6', _('cs6 (48 · network control protocol mark)')],
			['cs5', _('cs5 (40 · real-time video / interactive live mark)')],
			['af41', _('af41 (34 · HD video conferencing mark)')],
			['cs3', _('cs3 (24 · call signaling mark)')],
			['cs1', _('cs1 (8 · low-priority background download mark)')],
			['cs0', _('cs0 (0 · normal default mark)')]
		].forEach(function(pair) {
			o.value(pair[0], pair[1]);
		});

		o = s.option(form.Value, 'dscp_set', _('Rewrite Outbound Mark (DSCP)'));
		o.placeholder = _('Leave blank = do not rewrite');
		o.rmempty = true;
		[
			['ef', _('ef (46 · rewrite as ultra-low-latency voice/gaming mark)')],
			['cs6', _('cs6 (48 · rewrite as highest-priority network control mark)')],
			['cs5', _('cs5 (40 · rewrite as real-time video/live-streaming mark)')],
			['af41', _('af41 (34 · rewrite as video conferencing mark)')],
			['cs3', _('cs3 (24 · rewrite as priority signaling mark)')],
			['cs1', _('cs1 (8 · rewrite as low-priority background mark)')],
			['cs0', _('cs0 (0 · clear DSCP mark to default 0)')]
		].forEach(function(pair) {
			o.value(pair[0], pair[1]);
		});

		o = s.option(form.Value, 'src_mac', _('Target LAN Device MAC'));
		o.placeholder = _('Leave blank = any');
		o.rmempty = true;
		Object.keys(hints).sort().forEach(function(mac) {
			o.value(mac, hints[mac].label);
		});
		o.validate = function(section_id, val) {
			if (val == null || val === '')
				return true;
			return q.validUnicastMac(val);
		};

		o = s.option(form.ListValue, 'direction', _('Direction'));
		o.default = 'both';
		o.value('both', _('Bidirectional (Auto-match Upload + Download)'));
		o.value('src', _('Unidirectional (Match Source -> Destination Only)'));

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				_('App, Game & Device Priority Forwarding'),
				_('Assign higher forwarding priority levels (CoS 0-7) to critical traffic via the built-in app signature catalog (dynamic domain tracking + dedicated ports), smart small-packet priority, or custom IP/MAC/port rules, synced automatically to the RTL9617C hardware forwarding engine upon connection establishment.'),
				liveMount,
				function(next) {
					renderLiveClassify(liveMount, next, catIndex);
				},
				formNode
			);
		});
	}
});
