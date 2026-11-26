'use strict';
'require view';
'require dom';
'require form';
'require uci';
'require rtl9617c-qos.common as q';

var MIRROR_PORT_LABELS = {
	'6': _('LAN1 Port (2.5G · Port #6)'),
	'1': _('LAN2 Port (GbE · Port #1)'),
	'2': _('LAN3 Port (GbE · Port #2)'),
	'3': _('LAN4 Port (GbE · Port #3)')
};

function renderLiveMirror(container, data) {
	var mirror = (data && data.mirror) || {};
	var enabled = !!mirror.enabled;
	var portKey = mirror.port != null ? String(mirror.port) : '';
	var portLabel = MIRROR_PORT_LABELS[portKey] || (portKey ? _('Hardware Port #%s').format(portKey) : _('Not specified'));
	var snapLen = mirror.len != null ? Number(mirror.len) : 2048;

	dom.content(container, [
		q.guideCard(_('How to Use (Hardware Traffic Mirroring & Capture)'), [
			_('1. When hardware flowtable offload is enabled, established forwarded packets are switched directly in silicon between ports without reaching the router CPU, so running tcpdump on the router cannot see offloaded traffic.'),
			_('2. To capture packets for troubleshooting, enable "Hardware Flow Traffic Mirroring" here: the ASIC mirrors matching offloaded packets in real time to a chosen physical LAN port (LAN1–LAN4), where a connected PC running Wireshark can capture them.'),
			_('3. To prevent loopback storms, mirroring to router CPU ports is blocked by the driver. Disable mirroring after troubleshooting to avoid consuming extra port bandwidth.')
		]),
		E('div', { class: 'rq-grid' }, [
			q.card(_('Hardware Mirroring Status'),
				enabled ? q.badge(_('Mirroring Active'), 'warn') : q.badge(_('Disabled'), 'good'),
				[
					E('div', { class: 'rq-kpi' }, [
						enabled ? _('Mirror Copy Active') : _('Not enabled (Recommended for Normal Use)')
					]),
					E('p', { class: 'rq-note' }, [
						enabled
							? _('All packets entering the hardware flowtable are currently being mirrored to the target port.')
							: _('Hardware-forwarded traffic is not mirrored; zero extra port or CPU overhead.')
					])
				]),
			q.card(_('Mirror Target & Snapshot Length'),
				enabled ? q.badge(_('Active'), 'good') : q.badge(_('Pending'), ''),
				[
					E('div', { class: 'rq-kpi' }, [
						enabled ? (portLabel + ' · ' + String(snapLen) + ' B') : _('Mirror output inactive')
					]),
					E('p', { class: 'rq-note' }, [
						_('Snapshot length can be adjusted from 64 to 4095 bytes: 128 captures protocol headers only, while 2048 retains full standard Ethernet frames.')
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

		var sg = m.section(form.NamedSection, 'global', 'global', _('Hardware Traffic Mirroring Settings'));
		sg.anonymous = true;
		sg.addremove = false;

		var o;
		o = sg.option(form.Flag, 'mirror_enabled', _('Enable Hardware Flow Traffic Mirroring'),
			_('When enabled, the ASIC copies all hardware-offloaded flow packets to the target capture port selected below. Keep disabled during normal operation.'));
		o.default = '0';
		o.rmempty = false;

		o = sg.option(form.ListValue, 'mirror_port', _('Mirror Output Target Port'));
		o.depends('mirror_enabled', '1');
		o.default = '1';
		o.value('6', _('LAN1 Port (2.5G · Hardware Port 6)'));
		o.value('1', _('LAN2 Port (GbE · Hardware Port 1)'));
		o.value('2', _('LAN3 Port (GbE · Hardware Port 2)'));
		o.value('3', _('LAN4 Port (GbE · Hardware Port 3)'));

		o = sg.option(form.Value, 'mirror_len', _('Max Mirrored Packet Snapshot Length (Bytes)'),
			_('Range 64 ~ 4095 bytes. Use 128 for headers only, or 2048 for full Ethernet frames.'));
		o.depends('mirror_enabled', '1');
		o.datatype = 'range(64,4095)';
		o.default = '2048';

		return m.render().then(function(formNode) {
			return q.setupLivePage(
				_('Hardware Traffic Mirroring'),
				_('Configure RTL9617C ASIC-level hardware flow traffic mirroring to copy offloaded traffic to a physical LAN port for Wireshark packet capture.'),
				liveMount,
				function(next) {
					renderLiveMirror(liveMount, next);
				},
				formNode
			);
		});
	}
});
