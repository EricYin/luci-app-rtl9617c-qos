// SPDX-License-Identifier: GPL-2.0-or-later
'use strict';

import * as qos from 'rtl9617c.qos';

function assert_eq(actual, expected, msg) {
	if (actual !== expected) {
		warn(`FAIL: ${msg}: expected ${sprintf('%J', expected)}, got ${sprintf('%J', actual)}\n`);
		exit(1);
	}
}

function assert_true(cond, msg) {
	if (!cond) {
		warn(`FAIL: ${msg}\n`);
		exit(1);
	}
}

// 1. MAC normalization & multicast/zero rejection
assert_eq(qos.normalize_mac('AA:BB:CC:DD:EE:FF'), 'aa:bb:cc:dd:ee:ff', 'unicast MAC normalized');
assert_eq(qos.normalize_mac('01:00:5e:00:00:01'), null, 'multicast MAC rejected');
assert_eq(qos.normalize_mac('ff:ff:ff:ff:ff:ff'), null, 'broadcast MAC rejected');
assert_eq(qos.normalize_mac('00:00:00:00:00:00'), null, 'zero MAC rejected');
assert_eq(qos.normalize_mac('aa:bb:cc:dd:ee:gg'), null, 'non-hex MAC rejected');

// 2. IPv4 / IPv6 validation
assert_eq(qos.normalize_ip('192.168.1.50').family, 'ip', 'IPv4 host');
assert_eq(qos.normalize_ip('192.168.1.0/24').family, 'ip', 'IPv4 CIDR');
assert_eq(qos.normalize_ip('192.168.1.256'), null, 'IPv4 octet >255 rejected');
assert_eq(qos.normalize_ip('2001:db8::/48').family, 'ip6', 'IPv6 CIDR');
assert_eq(qos.normalize_ip('fe80::1; drop'), null, 'injection string rejected');

// 3. Port & DSCP parsing
assert_eq(qos.format_port_expr('3074'), '3074', 'single port');
assert_eq(qos.format_port_expr('5000-5500'), '5000-5500', 'port range');
assert_eq(qos.format_port_expr('80, 443, 8000-8080'), '{ 80, 443, 8000-8080 }', 'port list');
assert_eq(qos.format_port_expr('5000-4000'), null, 'inverted range rejected');
assert_eq(qos.format_port_expr('70000'), null, 'out-of-range port rejected');
assert_eq(qos.parse_dscp('EF'), 46, 'DSCP EF');
assert_eq(qos.parse_dscp('46'), 46, 'DSCP numeric 46');
assert_eq(qos.parse_dscp('64'), null, 'DSCP 64 rejected');

// 4. hostpol parser & diff planner (matching ni_te_flow.c exact format)
let sample_hostpol = join('\n', [
	'hostpol: 2/32 entries, 3/32 vmeters',
	'  reserved pol1 0xa0..0xff, flow pol1 0..0x9f',
	'[ 0] aa:bb:cc:dd:ee:01 ingress=10000kbps vm=0 pol1=160 (0xa0)',
	'     egress=50000kbps vm=1 pol1=161 (0xa1)',
	'     rx=123456 tx=789012 last_delta=100/200',
	'[ 1] aa:bb:cc:dd:ee:02 ingress=0kbps vm=-1 pol1=193 (0xc1)',
	'     egress=20000kbps vm=2 pol1=162 (0xa2)',
	'     rx=500 tx=9000 last_delta=0/50',
	''
]);
let parsed_hp = qos.parse_hostpol(sample_hostpol);
assert_true(parsed_hp.available, 'hostpol available');
assert_eq(parsed_hp.entries_used, 2, 'entries used');
assert_eq(parsed_hp.vmeters_used, 3, 'vmeters used');
assert_eq(length(parsed_hp.items), 2, '2 parsed host entries');
assert_eq(parsed_hp.items[0].rx_bytes, 123456, 'rx bytes parsed');
assert_eq(parsed_hp.items[1].ingress_vm, -1, 'count-only vm=-1');

let plan = qos.build_host_desired([
	{ '.name': 'h1', enabled: '1', mac: 'AA:BB:CC:DD:EE:01', ingress_kbps: '10000', egress_kbps: '50000' },
	{ '.name': 'h2', enabled: '1', mac: 'aa:bb:cc:dd:ee:02', ingress_kbps: '0', egress_kbps: '30000' },
	{ '.name': 'h3', enabled: '1', mac: 'aa:bb:cc:dd:ee:03', ingress_kbps: '0', egress_kbps: '0' },
	{ '.name': 'hdup', enabled: '1', mac: 'aa:bb:cc:dd:ee:01', ingress_kbps: '500', egress_kbps: '500' }
]);
assert_eq(plan.vmeters_used, 3, 'vmeters count ignores 0kbps entries & duplicate MAC');
assert_eq(length(plan.ordered), 3, '3 valid unique hosts');
let cmds = qos.diff_hostpol_commands(parsed_hp.items, plan.desired, plan.ordered);
// h1 unchanged -> untouched; h2 rate changed -> del then add; h3 new -> add
assert_eq(join(';', cmds),
	'del aa:bb:cc:dd:ee:02;add aa:bb:cc:dd:ee:02 0 30000;add aa:bb:cc:dd:ee:03 0 0',
	'minimal diff deletes changed before adding');

// 5. te_flow & dos parser
let sample_te = join('\n', [
	'te_flow: dev=4f4300000.ethernet',
	'group64_ready=1 group_cfg_depth=1',
	'flow_slots=1/160 group_slots=0/64',
	'pie_wred_port_en= 00000000 00000000 00000000 00000000',
	'l3_glb_ctrl=0x0000005d (wred_en=1 ecn=1)',
	'wred_ctrl=0x00000044 (fast_decay=1 weight=4 sel_worst=0 mark_ecn=1 arb_ecn=1)',
	'te_pm: pkts=12345 pol_drop=10 tail_drop=2 wred_y_drop=3 wred_g_drop=4 ce_mark=9',
	'wred_afgs= 10588/10588 0/0 0/0 0/0 0/0 0/0 0/0 0/0',
	'flow[  0] cir=50000kbps pir=50000kbps cbs=256 pbs=256 words=00000000/00000000/00000000',
	'dos_enabled=0 dos_flood_l3=1018 dos_flood_l2=255 (full dump: ./dos)',
	''
]);
let parsed_te = qos.parse_te_flow(sample_te);
assert_eq(parsed_te.flow_slots_used, 1, 'flow slots used');
assert_eq(length(parsed_te.flow_policers), 1, '1 active flow policer');
assert_eq(parsed_te.flow_policers[0].cir_kbps, 50000, 'flow policer cir');
assert_eq(parsed_te.wred_hw_en, true, 'wred hw enabled');
assert_eq(parsed_te.wred_ecn_hw_en, true, 'wred ecn hw enabled');
assert_eq(parsed_te.wred_mark_ecn_en, true, 'wred mark ecn enabled');
assert_eq(parsed_te.arb_ip_ecn_en, true, 'arb ip ecn enabled');
assert_eq(parsed_te.te_pm.wred_g_drop, 4, 'te_pm wred_g_drop parsed');
assert_eq(parsed_te.te_pm.ce_mark, 9, 'te_pm ce_mark parsed');
assert_eq(parsed_te.wred_afgs[0], '10588/10588', 'wred_afgs[0] parsed');
assert_eq(parsed_te.dos_enabled, false, 'dos disabled');

let sample_dos = join('\n', [
	'dos: dev=4f4300000.ethernet (type_en = 0x3304[31:16] / 0x1228[15:0])',
	'l3_flood=0x000003fa count=1018 (0x3310[10:0])',
	'l2_flood=0x000000ff count=255 (0x1234[9:0])',
	'l3_type_en=0x0005 l2_type_en=0x0000',
	'  [ 0] icmp_flood      l3_en=1 l3_pol=0x010 l3_th=0x03e8 l2_en=0 l2_th=0x0000 l3_act=drop l2_act=drop',
	'  [ 2] syn_flood       l3_en=1 l3_pol=0x020 l3_th=0x07d0 l2_en=0 l2_th=0x0000 l3_act=trap l2_act=drop',
	'  [15] smac_eq_dmac    l3_en=0 l3_pol=0x000 l2_en=0 l3_act=drop l2_act=drop',
	'l3_port_mask=0x00000000000000ff l2_port_mask=0x00000000000000ff',
	''
]);
let parsed_dos = qos.parse_dos(sample_dos);
assert_eq(parsed_dos.l3_flood_count, 1018, 'l3 flood unit');
assert_eq(parsed_dos.l2_flood_count, 255, 'l2 flood unit');
assert_eq(length(parsed_dos.types), 3, 'all 3 DoS types parsed (including s-containing names)');
assert_eq(parsed_dos.types[0].l3_en, true, 'DoS l3_en true');
assert_eq(parsed_dos.types[0].l3_act, 'drop', 'DoS l3_act drop');
assert_eq(parsed_dos.types[1].name, 'syn_flood', 'syn_flood parsed');
assert_eq(parsed_dos.types[1].l3_act, 'trap', 'syn_flood l3_act trap');
assert_eq(parsed_dos.types[2].l3_th, null, 'smac_eq_dmac optional th omitted cleanly');

// 6. nftables classify rule builder
let nft = qos.build_nft_rules(true, [
	{
		'.name': 'game',
		enabled: '1',
		cos: '6',
		family: 'any',
		proto: 'udp',
		src_ip: '192.168.1.50',
		dst_port: '3074',
		direction: 'both'
	},
	{
		'.name': 'bad_icmp',
		enabled: '1',
		cos: '4',
		proto: 'icmp',
		dst_port: '80'
	},
	{
		'.name': 'ef_v6',
		enabled: '1',
		cos: '5',
		family: 'ip6',
		proto: 'any',
		dscp: 'ef',
		direction: 'src'
	}
]);
assert_eq(nft.rule_count, 3, '2 symmetric game rules + 1 IPv6 DSCP rule');
assert_true(index(nft.content, 'ip saddr 192.168.1.50 meta l4proto udp udp dport 3074 counter meta priority set 0:6 return') >= 0,
	'forward rule generated with terminal return');
assert_true(index(nft.content, 'ip daddr 192.168.1.50 meta l4proto udp udp sport 3074 counter meta priority set 0:6 return') >= 0,
	'reverse symmetric rule generated with terminal return');
assert_true(index(nft.content, 'meta nfproto ipv6 ip6 dscp 46 counter meta priority set 0:5 return') >= 0,
	'IPv6 DSCP 46 rule generated with terminal return');
assert_eq(length(nft.warnings), 1, 'icmp+port rejected cleanly with warning');

// 7. tc Port QoS command builder
let p_tbf = qos.build_port_tc_plan({
	device: 'lan1',
	enabled: '1',
	egress_mode: 'tbf',
	shaper_kbps: '200000',
	shaper_burst: '65536',
	ingress_enable: '1',
	ingress_cir_kbps: '100000',
	ingress_pir_kbps: '150000',
	ingress_burst: '32768'
});
assert_eq(join(' ', p_tbf.root_cmd), 'tc qdisc replace dev lan1 root tbf rate 200000kbit burst 65536 latency 50ms', 'TBF cmd');
assert_eq(join(' ', p_tbf.ingress_cmds[1]),
	'tc filter replace dev lan1 ingress protocol all pref 10 flower skip_sw action police rate 100000kbit peakrate 150000kbit mtu 16384 burst 32768 conform-exceed drop/ok',
	'flower police cmd');

let p_ets = qos.build_port_tc_plan({
	device: 'lan2',
	enabled: '1',
	egress_mode: 'ets',
	strict_bands: '6',
	voq1_quantum: '3000',
	voq0_quantum: '6000',
	ingress_enable: '0'
});
assert_eq(join(' ', p_ets.root_cmd),
	'tc qdisc replace dev lan2 root handle 1: ets bands 8 strict 6 quanta 3000 6000 priomap 7 6 5 4 3 2 1 0 7 6 5 4 3 2 1 0',
	'ETS SP+WRR cmd maps strict to top VoQs 7..2 and WRR to VoQ 1..0');

// 8. DSCP remarking, DoS plan, Policer diff, WRED & Mirror builders
let nft_dscp = qos.build_nft_rules(true, [{
	'.name': 'voice',
	enabled: '1',
	cos: '6',
	family: 'ip',
	proto: 'udp',
	dst_port: '5060',
	dscp_set: 'ef'
}]);
assert_true(index(nft_dscp.content, 'ip dscp set 46 counter meta priority set 0:6') >= 0, 'nft dscp_set');

let mir = qos.parse_mirror('enabled=1 arg0=6 arg1=0 arg2=0 len=2048 ctrl=0x000000ff mirror_len=0x00000800\n');
assert_eq(mir.enabled, true, 'mirror enabled');
assert_eq(mir.port, 6, 'mirror port');
assert_eq(mir.len, 2048, 'mirror len');

let dos_p = qos.build_dos_plan(true, {
	dos_enabled: '1',
	dos_icmp_th: '1000',
	dos_syn_th: '2000',
	dos_disabled_types: ['udp_bomb']
});
let dos_joined = join('|', dos_p.dos_cmds);
assert_eq(dos_p.te_flow_cmd, 'dos on', 'dos te_flow cmd');
assert_true(index(dos_joined, 'th icmp_flood 1000') >= 0, 'dos icmp th');
assert_true(index(dos_joined, 'th fin_flood 2000') >= 0, 'dos default fin th');
assert_true(index(dos_joined, 'type udp_bomb off') >= 0, 'dos disabled type');
assert_true(index(dos_joined, 'type land_attacks on') >= 0, 'dos enabled type');
assert_true(index(dos_joined, 'port-mask 0x00000000000000ff') >= 0, 'dos l3 port mask');
assert_true(index(dos_joined, 'l2-port-mask 0x00000000000000ff') >= 0, 'dos l2 port mask');

// Default enabled with empty disabled list must arm the 15 safe types + keep syn1024 off + safe thresholds + masks
let dos_def = qos.build_dos_plan(true, { dos_enabled: '1' });
let dos_def_joined = join('|', dos_def.dos_cmds);
assert_true(index(dos_def_joined, 'th icmp_flood 1000') >= 0, 'dos default icmp th');
assert_true(index(dos_def_joined, 'th syn_flood 2000') >= 0, 'dos default syn th');
assert_true(index(dos_def_joined, 'type icmp_flood on') >= 0 && index(dos_def_joined, 'l2-type smac_eq_dmac on') >= 0,
	'dos default arms safe L3+L2 types');
assert_true(index(dos_def_joined, 'type syn1024 off') >= 0 && index(dos_def_joined, 'l2-type syn1024 off') >= 0,
	'dos default keeps syn1024 off to protect WAN HTTP/HTTPS SYN+ACK');
assert_true(index(dos_def_joined, 'port-mask 0x00000000000000ff') > index(dos_def_joined, 'type icmp_flood on'),
	'dos sets port mask after thresholds and types');
let dos_syn1024 = qos.build_dos_plan(true, { dos_enabled: '1', dos_allow_syn1024: '1' });
assert_true(index(join('|', dos_syn1024.dos_cmds), 'type syn1024 on') >= 0, 'dos_allow_syn1024 opts in syn1024');

let pol_diff = qos.diff_policer_commands(
	[{ slot: 0, cir_kbps: 10000, pir_kbps: 10000, cbs: 1000, pbs: 2000 },
	 { slot: 1, cir_kbps: 20000, pir_kbps: 20000, cbs: 1000, pbs: 2000 }],
	[{ enabled: '1', slot: '1', cir_kbps: '50000', pir_kbps: '50000', cbs: '2048', pbs: '4095' },
	 { enabled: '1', slot: '2', cir_kbps: '100000', pir_kbps: '100000', cbs: '2048', pbs: '4095' }],
	false
);
assert_eq(join('|', pol_diff.cmds), 'policer-free 0|policer 1 50000 50000 2048 4095|policer 2 100000 100000 2048 4095', 'flow policer diff');

let wred_cmds = qos.build_wred_commands(true, { wred_enabled: '1', wred_profile: '2', wred_queues: '2' });
let wred_joined = join('|', wred_cmds);
assert_true(index(wred_cmds[0], 'wred-prof 1 ') == 0, 'wred programs profile 1 LAN DQ curve');
assert_true(index(wred_joined, 'wred-prof 4 ') >= 0 && index(wred_joined, 'wred-prof 7 ') >= 0, 'wred programs CPU and WAN DQ profile banks');
assert_true(index(wred_joined, 'wred-cfg 0 2 1') >= 0, 'wred programs EWMA weight=2 sel_worst=1');
assert_true(index(wred_joined, 'wred 0 3 0') >= 0 && index(wred_joined, 'wred 0 2 2') >= 0 && index(wred_joined, 'wred 0 0 7') >= 0, 'wred binds bulk/mid VoQs while protecting VoQ 7');
assert_true(index(wred_joined, 'pie 0 0xffffffff') >= 0 && index(wred_joined, 'pie 3 0xffffffff') >= 0, 'wred enables pie_wred_port_en words 0..3');
assert_eq(wred_cmds[length(wred_cmds) - 1], 'wred-ctrl 1 0', 'wred enables L3TE global WRED bit');
let wred_off = qos.build_wred_commands(false, { wred_enabled: '1', wred_profile: '2', wred_queues: '2' });
assert_eq(join('|', wred_off), 'wred-ctrl 0 0|wred-cfg 0 0 0|pie 0 0|pie 1 0|pie 2 0|pie 3 0|wred 0 0 all|wred 1 0 all', 'wred disable clears ctrl, cfg, pie_wred_port_en and queues');

let mir_cmds = qos.build_mirror_commands(true, { mirror_enabled: '1', mirror_port: '6', mirror_len: '1500' });
assert_eq(join('|', mir_cmds), 'len 1500|port 6', 'mirror cmds');
let mir_cpu = qos.build_mirror_commands(true, { mirror_enabled: '1', mirror_port: '16', mirror_len: '2048' });
assert_eq(join('|', mir_cpu), 'disable', 'mirror cpu port blocked');

// 9. Small packet priority rules (fallback after classify/app rules)
let nft_sp = qos.build_nft_rules(true, [], {
	small_pkt_prio: '1',
	small_pkt_mode: 'udp_icmp',
	small_pkt_bytes: '256',
	small_pkt_cos: '6'
});
assert_eq(nft_sp.rule_count, 2, 'small_pkt udp_icmp count');
assert_true(index(nft_sp.content, 'meta l4proto { icmp, ipv6-icmp, udp } meta length <= 256 counter meta priority set 0:6 return comment "rtl9617c-qos:__small_pkt"') >= 0, 'small_pkt udp_icmp rule');

let nft_sp_all = qos.build_nft_rules(true, [], {
	small_pkt_prio: '1',
	small_pkt_mode: 'all',
	small_pkt_bytes: '128',
	small_pkt_cos: '5',
	default_cos: '2'
});
assert_eq(nft_sp_all.rule_count, 3, 'small_pkt all non-tcp + tcp psh + default_cos count');
assert_true(index(nft_sp_all.content, 'meta l4proto tcp tcp flags & psh != 0 meta length <= 128 counter meta priority set 0:5 return comment "rtl9617c-qos:__small_pkt"') >= 0, 'small_pkt all tcp psh rule');
assert_true(index(nft_sp_all.content, 'counter meta priority set 0:2 return comment "rtl9617c-qos:__default"') >= 0, 'default_cos fallback rule');

/* App signature catalog & dnsmasq nftset + narrow port planning */
let mock_catalog = {
	version: 'test-v1',
	categories: [
		{ id: 'mobile_game', name: '热门手机游戏', default_cos: 6, count: 2 },
		{ id: 'download_bulk', name: '下载工具', default_cos: 1, count: 1 }
	],
	apps: [
		{ id: '12019', name: '王者荣耀', cat: 'mobile_game', qos_class: 1, domains: ['pvp.qq.com'], tcp: ['31003'], udp: ['17005'] },
		{ id: '12479', name: '三角洲行动手游', cat: 'mobile_game', qos_class: 1, domains: ['df.qq.com'], tcp: ['65010'], udp: ['65000-65100'] },
		{ id: '21001', name: '迅雷', cat: 'download_bulk', qos_class: 4, domains: ['xunlei.com'], tcp: ['11400'], udp: [] }
	],
	by_id: {
		'12019': { id: '12019', name: '王者荣耀', cat: 'mobile_game', qos_class: 1, domains: ['pvp.qq.com'], tcp: ['31003'], udp: ['17005'] },
		'12479': { id: '12479', name: '三角洲行动手游', cat: 'mobile_game', qos_class: 1, domains: ['df.qq.com'], tcp: ['65010'], udp: ['65000-65100'] },
		'21001': { id: '21001', name: '迅雷', cat: 'download_bulk', qos_class: 4, domains: ['xunlei.com'], tcp: ['11400'], udp: [] }
	},
	by_cat: {
		mobile_game: [
			{ id: '12019', name: '王者荣耀', cat: 'mobile_game', qos_class: 1, domains: ['pvp.qq.com'], tcp: ['31003'], udp: ['17005'] },
			{ id: '12479', name: '三角洲行动手游', cat: 'mobile_game', qos_class: 1, domains: ['df.qq.com'], tcp: ['65010'], udp: ['65000-65100'] }
		],
		download_bulk: [
			{ id: '21001', name: '迅雷', cat: 'download_bulk', qos_class: 4, domains: ['xunlei.com'], tcp: ['11400'], udp: [] }
		]
	}
};

let nft_app = qos.build_nft_rules(true, [], {}, [
	{ '.name': 'app_g', enabled: '1', match_type: 'category', category: 'mobile_game', cos: '6' },
	{ '.name': 'app_dl', enabled: '1', match_type: 'category', category: 'download_bulk', cos: '1' },
	{ '.name': 'app_override', enabled: '1', match_type: 'app', app_id: '12019', cos: '7' }
], mock_catalog);

assert_eq(nft_app.app_domain_count, 3, 'app domain count');
assert_true(index(nft_app.content, 'set rtl9617c_qos_app_c7_v4') >= 0, 'explicit app overrides category domain to c7');
assert_true(index(nft_app.content, 'set rtl9617c_qos_app_c6_v4') >= 0, 'remaining mobile_game domain in c6');
assert_true(index(nft_app.content, 'set rtl9617c_qos_app_c1_v4') >= 0, 'download_bulk domain in c1');
assert_true(index(nft_app.dnsmasq_conf, 'nftset=/pvp.qq.com/4#inet#fw4#rtl9617c_qos_app_c7_v4,6#inet#fw4#rtl9617c_qos_app_c7_v6') >= 0, 'dnsmasq override line');
assert_true(index(nft_app.dnsmasq_conf, 'nftset=/df.qq.com/4#inet#fw4#rtl9617c_qos_app_c6_v4,6#inet#fw4#rtl9617c_qos_app_c6_v6') >= 0, 'dnsmasq category line');
assert_true(index(nft_app.content, 'udp dport { 17005, 65000-65100 } counter meta priority set 0:6 return comment "rtl9617c-qos:__app_app_g"') >= 0, 'app udp port rule');
assert_true(index(nft_app.content, 'tcp dport 11400 counter meta priority set 0:1 return comment "rtl9617c-qos:__app_app_dl"') >= 0, 'app tcp port rule');
assert_true(index(nft_app.content, 'rtl9617c-qos:__app_app_override') < index(nft_app.content, 'rtl9617c-qos:__app_app_g'), 'individual app override precedes category rule');

// 10. Precedence: classify -> app -> small_pkt -> default_cos
let nft_order = qos.build_nft_rules(true, [
	{ '.name': 'c1', enabled: '1', cos: '7', proto: 'udp', dst_port: '53', direction: 'dst' }
], { small_pkt_prio: '1', small_pkt_mode: 'udp_icmp', small_pkt_bytes: '256', small_pkt_cos: '6', default_cos: '2' }, [
	{ '.name': 'dl', enabled: '1', match_type: 'category', category: 'download_bulk', cos: '0' }
], mock_catalog);
let idx_c = index(nft_order.content, 'rtl9617c-qos:c1');
let idx_app = index(nft_order.content, 'rtl9617c-qos:__app_dl');
let idx_sp = index(nft_order.content, 'rtl9617c-qos:__small_pkt');
let idx_def = index(nft_order.content, 'rtl9617c-qos:__default');
assert_true(idx_c >= 0 && idx_app > idx_c && idx_sp > idx_app && idx_def > idx_sp, 'chain ordering: classify < app < small_pkt < default');

let nft_app_off = qos.build_nft_rules(false, [], {}, [
	{ '.name': 'app_g', enabled: '1', match_type: 'category', category: 'mobile_game', cos: '6' }
], mock_catalog);
assert_eq(nft_app_off.dnsmasq_conf, '', 'disabled clears dnsmasq_conf');
assert_eq(nft_app_off.rule_count, 0, 'disabled clears rule_count');

// 11. parse_tunnel (L2TP / PPTP Dual-Header & EIF debugfs parsing)
let tun_null = qos.parse_tunnel(null);
assert_eq(tun_null.available, false, 'null tunnel debugfs');

let tun_sample = [
	'ready=1 last: control-set 0 l2tp -> ok',
	'content bitmap: 0000000000000003',
	'control bitmap: 0000000000000003',
	'fmr bitmap: 0000000000000000',
	'content[0]: owner=1 type=9(l2tp) allocated',
	'content[1]: owner=1 type=10(pptp) allocated',
	'content[2]: owner=0 type=0(none) free',
	'control[0]: owner=1 type=9(l2tp) allocated',
	'control[1]: owner=1 type=10(pptp) allocated',
	'control[2]: owner=0 type=0(none) free',
	'fmr[0]: owner=0 type=0(none) free',
	'content 0 owner=1 type=9(l2tp) raw=45000000,00004000',
	'control 0 owner=1 type=9(l2tp) raw=0001ffc1,fcfe5400,050f0c01,028009e3',
	'control 1 owner=1 type=10(pptp) raw=0001fec1,71fe5200,013f8000,024008e3',
	'eif hash slots:',
	'  hash  0: phys= 0 used=0 refs=0 param=00000000',
	'  hash 32: phys=16 used=1 refs=4 param=1234abcd',
	'  hash 33: phys=17 used=1 refs=2 param=deadbeef'
];
let tun_ok = qos.parse_tunnel(join('\n', tun_sample));
assert_eq(tun_ok.available, true, 'tunnel available');
assert_eq(tun_ok.ready, true, 'tunnel ready');
assert_eq(tun_ok.content_used, 2, 'content_used');
assert_eq(tun_ok.control_used, 2, 'control_used');
assert_eq(tun_ok.l2tp_slots, 1, 'l2tp_slots');
assert_eq(tun_ok.pptp_slots, 1, 'pptp_slots');
assert_eq(tun_ok.eif_used, 2, 'eif_used');
assert_eq(tun_ok.eif_refs, 6, 'eif_refs');
assert_eq(tun_ok.control_items[0].raw, 'raw=0001ffc1,fcfe5400,050f0c01,028009e3', 'control 0 raw');
assert_eq(tun_ok.content_items[0].raw, 'raw=45000000,00004000', 'content 0 raw');
assert_eq(tun_ok.eif_items[0].hash, 32, 'eif hash 32');
assert_eq(tun_ok.eif_items[0].phys, 16, 'eif phys 16');

print('ALL QOS UCODE UNIT TESTS PASSED\n');
