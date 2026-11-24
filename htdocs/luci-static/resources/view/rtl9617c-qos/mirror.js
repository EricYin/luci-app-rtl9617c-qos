'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';

var MIRROR_PORT_LABELS = {
	'6': 'LAN1 网口（2.5G 口 · 端口 #6）',
	'1': 'LAN2 网口（千兆口 · 端口 #1）',
	'2': 'LAN3 网口（千兆口 · 端口 #2）',
	'3': 'LAN4 网口（千兆口 · 端口 #3）'
};

function renderLiveMirror(container, data) {
	var mirror = (data && data.mirror) || {};
	var enabled = !!mirror.enabled;
	var portKey = mirror.port != null ? String(mirror.port) : '';
	var portLabel = MIRROR_PORT_LABELS[portKey] || (portKey ? ('硬件端口 #' + portKey) : '未指定');
	var snapLen = mirror.len != null ? Number(mirror.len) : 2048;

	dom.content(container, [
		q.guideCard('怎么用？（硬件级流量镜像抓包）', [
			'1. 开启硬件加速（flowtable）后，大部分已建连的转发数据包会直接由芯片在网口间转发，不再经过路由器 CPU，因此直接在路由器上跑 tcpdump 看不到已加速的流量。',
			'2. 排障需要抓包时，可在此开启“硬件加速连接流量镜像抓包”：芯片会把命中的硬件转发流量实时复制一份发往指定物理 LAN 口（LAN1~LAN4），在该网口接一台电脑运行 Wireshark 即可抓包。',
			'3. 为避免回环风暴，驱动已禁止镜像到路由器本机 CPU 端口；排障结束后建议及时关闭镜像，以免占用多余网口带宽。'
		]),
		E('div', { class: 'rq-grid' }, [
			q.card('硬件流量镜像状态',
				enabled ? q.badge('正在镜像抓包', 'warn') : q.badge('已关闭', 'good'),
				[
					E('div', { class: 'rq-kpi' }, [
						enabled ? '镜像复制运行中' : '未启用（推荐日常状态）'
					]),
					E('p', { class: 'rq-note' }, [
						enabled
							? '当前所有进入硬件加速表的连接报文都在向目标端口复制输出。'
							: '当前不复制硬件转发流量，网口与 CPU 零额外镜像开销。'
					])
				]),
			q.card('镜像目标与截断长度',
				enabled ? q.badge('已生效', 'good') : q.badge('待启用', ''),
				[
					E('div', { class: 'rq-kpi' }, [
						enabled ? (portLabel + ' · ' + String(snapLen) + ' B') : '未激活镜像输出'
					]),
					E('p', { class: 'rq-note' }, [
						'截断长度可在 64 ~ 4095 字节间调整：填 128 仅保留协议包头，填 2048 可完整保留标准以太网帧。'
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

		var sg = m.section(form.NamedSection, 'global', 'global', '硬件级流量镜像抓包设置');
		sg.anonymous = true;
		sg.addremove = false;

		var o;
		o = sg.option(form.Flag, 'mirror_enabled', '启用硬件加速连接流量镜像抓包',
			'开启后，芯片会将所有处于硬件加速状态的连接数据包自动复制一份发送到下方指定的抓包网口。日常正常使用时请保持关闭。');
		o.default = '0';
		o.rmempty = false;

		o = sg.option(form.ListValue, 'mirror_port', '镜像抓包输出目标网口');
		o.depends('mirror_enabled', '1');
		o.default = '1';
		o.value('6', 'LAN1 网口（2.5G 口 · 硬件端口 6）');
		o.value('1', 'LAN2 网口（千兆口 · 硬件端口 1）');
		o.value('2', 'LAN3 网口（千兆口 · 硬件端口 2）');
		o.value('3', 'LAN4 网口（千兆口 · 硬件端口 3）');

		o = sg.option(form.Value, 'mirror_len', '每个镜像包最大截取长度 (Bytes)',
			'范围 64 ~ 4095 字节。填 128 仅抓取包头，填 2048 抓取完整以太网帧。');
		o.depends('mirror_enabled', '1');
		o.datatype = 'range(64,4095)';
		o.default = '2048';

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				'硬件流量镜像抓包',
				'配置 RTL9617C 芯片级硬件转发流量镜像复制，将加速流量复制到指定物理 LAN 口供 Wireshark 抓包排障。',
				liveMount,
				function(next) {
					renderLiveMirror(liveMount, next);
				},
				formNode
			);
		});
	}
});
