// SPDX-License-Identifier: GPL-2.0-or-later
'use strict';

import { lsdir, readfile, readlink, stat } from 'fs';

export const HOSTPOL_MAX_ENTRIES = 32;
export const HOSTPOL_MAX_VMETERS = 32;
export const HOSTPOL_RATE_MAX_KBPS = 32767999;

export const TBF_MIN_BURST = 4096;
export const TBF_MAX_BURST = 1048320;
export const TBF_DEFAULT_BURST = 65536;
export const VOQ_COUNT = 8;
export const COS_MAX = 7;
export const L3TE_POL_BURST_MAX = 4095;
export const L3TE_FLOW_SLOTS_MAX = 160;
export const L3TE_GROUP_SLOTS_MAX = 64;

export const DOS_TYPES = [
	'icmp_flood', 'fin_flood', 'syn_flood', 'syn_with_data',
	'udp_bomb', 'ping_of_death', 'icmp_fragment', 'tcp_frag_error',
	'tcp_short_hdr', 'syn1024', 'null_scan', 'xma_scan',
	'syn_fin_scan', 'blat_attacks', 'land_attacks', 'smac_eq_dmac'
];

export const DOS_DEFAULT_ICMP_TH = 1000;
export const DOS_DEFAULT_FIN_TH = 2000;
export const DOS_DEFAULT_SYN_TH = 2000;
/* Physical ingress ports 0..7 (NI LAN ports 0..6 + PON port 7), excluding CPU ports 16..23. */
export const DOS_DEFAULT_PORT_MASK = '0x00000000000000ff';

export const NFT_INCLUDE_PATH = '/etc/nftables.d/90-rtl9617c-qos.nft';
export const APP_CATALOG_PATH = '/usr/share/rtl9617c/app_signatures.json';

export const DSCP_MAP = {
	cs0: 0, df: 0, le: 1,
	cs1: 8, af11: 10, af12: 12, af13: 14,
	cs2: 16, af21: 18, af22: 20, af23: 22,
	cs3: 24, af31: 26, af32: 28, af33: 30,
	cs4: 32, af41: 34, af42: 36, af43: 38,
	cs5: 40, va: 44, nqb: 45, ef: 46,
	cs6: 48, cs7: 56
};

const NETDEV_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,14}$/;
const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
const IPV4_PART_RE = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})(\/([0-9]{1,2}))?$/;
const IPV6_PART_RE = /^([0-9a-fA-F:]+)(\/([0-9]{1,3}))?$/;

export function te_dir() {
	return getenv('RTL9617C_TE_DEBUGFS') || '/sys/kernel/debug/rtl9617c_te';
};

export function te_file(name) {
	return te_dir() + '/' + name;
};

export function sys_net_dir() {
	return getenv('RTL9617C_SYS_NET') || '/sys/class/net';
};

export function is_truthy(v) {
	return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
};

export function parse_uint(v, min_val, max_val) {
	if (v == null)
		return null;
	let s = trim('' + v);
	if (!match(s, /^[0-9]+$/))
		return null;
	let n = +s;
	if (min_val != null && n < min_val)
		return null;
	if (max_val != null && n > max_val)
		return null;
	return n;
};

/**
 * Normalize a unicast MAC address to lowercase xx:xx:xx:xx:xx:xx.
 * Rejects all-zero, broadcast, and multicast addresses.
 */
export function normalize_mac(v) {
	if (v == null)
		return null;
	let s = lc(trim('' + v));
	if (!match(s, MAC_RE))
		return null;
	if (s == '00:00:00:00:00:00' || s == 'ff:ff:ff:ff:ff:ff')
		return null;
	let first_byte = hex(substr(s, 0, 2));
	if (first_byte & 1)
		return null;
	return s;
};

export function valid_netdev_name(name) {
	if (name == null)
		return false;
	let s = '' + name;
	if (s == 'lo' || index(s, '..') >= 0)
		return false;
	return match(s, NETDEV_RE) != null;
};

export function discover_ni_ports() {
	let base = sys_net_dir();
	let entries = lsdir(base);
	if (entries == null)
		return [];
	let out = [];
	for (let name in entries) {
		if (!valid_netdev_name(name))
			continue;
		let drv = readlink(base + '/' + name + '/device/driver');
		if (drv == null)
			continue;
		if (substr(drv, -12) != '/rtl9617c-ni')
			continue;
		let oper = trim(readfile(base + '/' + name + '/operstate') || '');
		let speed = parse_uint(readfile(base + '/' + name + '/speed'), 0, 100000);
		let carrier = parse_uint(readfile(base + '/' + name + '/carrier'), 0, 1);
		push(out, {
			device: name,
			operstate: oper != '' ? oper : 'unknown',
			speed: speed,
			carrier: carrier == 1
		});
	}
	sort(out, (a, b) => a.device < b.device ? -1 : (a.device > b.device ? 1 : 0));
	return out;
};

/**
 * Validate IPv4 or IPv6 address/CIDR literal. Returns { family: 'ip'|'ip6', value: str } or null.
 */
export function normalize_ip(v) {
	if (v == null)
		return null;
	let s = trim('' + v);
	if (s == '')
		return null;
	let m4 = match(s, IPV4_PART_RE);
	if (m4 != null) {
		for (let i = 1; i <= 4; i++) {
			if (+m4[i] > 255)
				return null;
		}
		if (m4[6] != null && +m4[6] > 32)
			return null;
		return { family: 'ip', value: s };
	}
	let m6 = match(s, IPV6_PART_RE);
	if (m6 != null && index(m6[1], ':') >= 0 && index(m6[1], ':::') < 0) {
		let colons = split(m6[1], '::');
		if (length(colons) > 2)
			return null;
		let groups = 0;
		for (let half in colons) {
			if (half == '')
				continue;
			let parts = split(half, ':');
			for (let g in parts) {
				if (!match(g, /^[0-9a-fA-F]{1,4}$/))
					return null;
			}
			groups += length(parts);
		}
		if (length(colons) == 1 && groups != 8)
			return null;
		if (length(colons) == 2 && groups > 7)
			return null;
		if (m6[3] != null && +m6[3] > 128)
			return null;
		return { family: 'ip6', value: lc(s) };
	}
	return null;
};

/**
 * Parse a port, port range ("start-end"), or comma-separated list thereof.
 * Returns normalized nft expression (e.g. "3074", "3074-3080", or "{ 80, 443 }"), else null.
 */
export function format_port_expr(v) {
	if (v == null)
		return null;
	let raw = trim('' + v);
	if (raw == '')
		return null;
	let tokens = [];
	for (let item in split(raw, ',')) {
		let tok = trim(item);
		if (tok == '')
			return null;
		let range_m = match(tok, /^([0-9]+)-([0-9]+)$/);
		if (range_m != null) {
			let a = parse_uint(range_m[1], 1, 65535);
			let b = parse_uint(range_m[2], 1, 65535);
			if (a == null || b == null || a > b)
				return null;
			push(tokens, a == b ? ('' + a) : (a + '-' + b));
		} else {
			let p = parse_uint(tok, 1, 65535);
			if (p == null)
				return null;
			push(tokens, '' + p);
		}
	}
	if (!length(tokens))
		return null;
	return length(tokens) == 1 ? tokens[0] : ('{ ' + join(', ', tokens) + ' }');
};

export function parse_dscp(v) {
	if (v == null)
		return null;
	let s = lc(trim('' + v));
	if (s == '')
		return null;
	if (exists(DSCP_MAP, s))
		return DSCP_MAP[s];
	return parse_uint(s, 0, 63);
};

export function parse_hostpol(text) {
	if (text == null)
		return { available: false, entries_used: 0, entries_max: HOSTPOL_MAX_ENTRIES,
			 vmeters_used: 0, vmeters_max: HOSTPOL_MAX_VMETERS, items: [] };

	let result = {
		available: true,
		entries_used: 0,
		entries_max: HOSTPOL_MAX_ENTRIES,
		vmeters_used: 0,
		vmeters_max: HOSTPOL_MAX_VMETERS,
		items: []
	};

	let current = null;
	for (let line in split(text, '\n')) {
		let trimmed = trim(line);
		if (trimmed == '')
			continue;

		let hdr = match(trimmed, /^hostpol:\s*([0-9]+)\/([0-9]+)\s+entries,\s*([0-9]+)\/([0-9]+)\s+vmeters/);
		if (hdr != null) {
			result.entries_used = +hdr[1];
			result.entries_max = +hdr[2];
			result.vmeters_used = +hdr[3];
			result.vmeters_max = +hdr[4];
			continue;
		}

		let m1 = match(trimmed, /^\[\s*([0-9]+)\]\s+([0-9a-fA-F:]{17})\s+ingress=([0-9]+)kbps\s+vm=(-?[0-9]+)\s+pol1=([0-9]+)/);
		if (m1 != null) {
			if (current != null)
				push(result.items, current);
			current = {
				idx: +m1[1],
				mac: lc(m1[2]),
				ingress_kbps: +m1[3],
				ingress_vm: +m1[4],
				ingress_pol1: +m1[5],
				egress_kbps: 0,
				egress_vm: -1,
				egress_pol1: 0,
				rx_bytes: 0,
				tx_bytes: 0,
				last_delta_in: 0,
				last_delta_out: 0
			};
			continue;
		}

		if (current == null)
			continue;

		let m2 = match(trimmed, /^egress=([0-9]+)kbps\s+vm=(-?[0-9]+)\s+pol1=([0-9]+)/);
		if (m2 != null) {
			current.egress_kbps = +m2[1];
			current.egress_vm = +m2[2];
			current.egress_pol1 = +m2[3];
			continue;
		}

		let m3 = match(trimmed, /^rx=([0-9]+)\s+tx=([0-9]+)\s+last_delta=([0-9]+)\/([0-9]+)/);
		if (m3 != null) {
			current.rx_bytes = +m3[1];
			current.tx_bytes = +m3[2];
			current.last_delta_in = +m3[3];
			current.last_delta_out = +m3[4];
			continue;
		}
	}
	if (current != null)
		push(result.items, current);

	return result;
};

export function parse_te_flow(text) {
	if (text == null)
		return { available: false };

	let out = {
		available: true,
		dev: null,
		group64_ready: false,
		group_cfg_depth: false,
		flow_slots_used: 0,
		flow_slots_total: 160,
		group_slots_used: 0,
		group_slots_total: 64,
		pie_wred_port_en: [],
		wred_port_active: false,
		wred_hw_en: false,
		wred_ecn_hw_en: false,
		wred_mark_ecn_en: false,
		arb_ip_ecn_en: false,
		wred_ctrl: null,
		wred_afgs: [],
		te_pm: null,
		l3_glb_ctrl: null,
		flow_policers: [],
		group_policers: [],
		wred_queues: [],
		dos_enabled: false,
		dos_flood_l3: 0,
		dos_flood_l2: 0
	};

	for (let line in split(text, '\n')) {
		let s = trim(line);
		if (s == '')
			continue;
		let dm = match(s, /^te_flow:\s*dev=(\S+)/);
		if (dm != null) {
			out.dev = dm[1];
			continue;
		}
		let gm = match(s, /^group64_ready=([01])\s+group_cfg_depth=([01])/);
		if (gm != null) {
			out.group64_ready = (gm[1] == '1');
			out.group_cfg_depth = (gm[2] == '1');
			continue;
		}
		let sm = match(s, /^flow_slots=([0-9]+)\/([0-9]+)\s+group_slots=([0-9]+)\/([0-9]+)/);
		if (sm != null) {
			let raw_used = +sm[1];
			let raw_total = +sm[2];
			/* Kernel flow_slots bitmap (256 bits) pre-allocates 96 slots (160..255) for Host Policing. */
			if (raw_total == 256 && raw_used >= 96) {
				out.flow_slots_used = raw_used - 96;
				out.flow_slots_total = 160;
			} else {
				out.flow_slots_used = raw_used;
				out.flow_slots_total = raw_total;
			}
			out.group_slots_used = +sm[3];
			out.group_slots_total = +sm[4];
			continue;
		}
		let pw = match(s, /^pie_wred_port_en=\s*(.+)$/);
		if (pw != null) {
			out.pie_wred_port_en = split(trim(pw[1]), /\s+/);
			out.wred_port_active = false;
			for (let w in out.pie_wred_port_en) {
				if (w != '00000000')
					out.wred_port_active = true;
			}
			continue;
		}
		let gc = match(s, /^l3_glb_ctrl=(0x[0-9a-fA-F]+)\s+\(wred_en=([01])\s+ecn=([01])\)/);
		if (gc != null) {
			out.l3_glb_ctrl = gc[1];
			out.wred_hw_en = (gc[2] == '1');
			out.wred_ecn_hw_en = (gc[3] == '1');
			continue;
		}
		let wc = match(s, /^wred_ctrl=(0x[0-9a-fA-F]+)\s+\(fast_decay=([01])\s+weight=([0-9]+)\s+sel_worst=([01])\s+mark_ecn=([01])\s+arb_ecn=([01])\)/);
		if (wc != null) {
			out.wred_ctrl = wc[1];
			out.wred_fast_decay = (wc[2] == '1');
			out.wred_afgs_weight = +wc[3];
			out.wred_sel_worst = (wc[4] == '1');
			out.wred_mark_ecn_en = (wc[5] == '1');
			out.arb_ip_ecn_en = (wc[6] == '1');
			continue;
		}
		let pm = match(s, /^te_pm:\s*pkts=([0-9]+)\s+pol_drop=([0-9]+)\s+tail_drop=([0-9]+)\s+wred_y_drop=([0-9]+)\s+wred_g_drop=([0-9]+)\s+ce_mark=([0-9]+)/);
		if (pm != null) {
			out.te_pm = {
				pkts: +pm[1],
				pol_drop: +pm[2],
				tail_drop: +pm[3],
				wred_y_drop: +pm[4],
				wred_g_drop: +pm[5],
				ce_mark: +pm[6]
			};
			continue;
		}
		let af = match(s, /^wred_afgs=\s*(.+)$/);
		if (af != null) {
			out.wred_afgs = split(trim(af[1]), /\s+/);
			continue;
		}
		let fm = match(s, /^flow\[\s*([0-9]+)\]\s+cir=([0-9]+)kbps\s+pir=([0-9]+)kbps\s+cbs=([0-9]+)\s+pbs=([0-9]+)/);
		if (fm != null) {
			let slot = +fm[1];
			/* Slots 160..255 (0xA0..0xFF) are reserved by te_hostpol_init() for Host Policing. */
			if (slot < 160) {
				push(out.flow_policers, {
					slot: slot,
					cir_kbps: +fm[2],
					pir_kbps: +fm[3],
					cbs: +fm[4],
					pbs: +fm[5]
				});
			}
			continue;
		}
		let gp = match(s, /^group\[\s*([0-9]+)\]\s+cir=([0-9]+)kbps\s+pir=([0-9]+)kbps\s+cbs=([0-9]+)\s+pbs=([0-9]+)/);
		if (gp != null) {
			push(out.group_policers, {
				slot: +gp[1],
				group: +gp[1],
				cir_kbps: +gp[2],
				pir_kbps: +gp[3],
				cbs: +gp[4],
				pbs: +gp[5]
			});
			continue;
		}
		let wm = match(s, /^wred-sel\[\s*([0-9]+)\]\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+fields=([0-9,]+)/);
		if (wm != null) {
			push(out.wred_queues, {
				queue: +wm[1],
				w0: wm[2],
				w1: wm[3],
				fields: map(split(wm[4], ','), (v) => +v)
			});
			continue;
		}
		let dosm = match(s, /^dos_enabled=([01])\s+dos_flood_l3=([0-9]+)\s+dos_flood_l2=([0-9]+)/);
		if (dosm != null) {
			out.dos_enabled = (dosm[1] == '1');
			out.dos_flood_l3 = +dosm[2];
			out.dos_flood_l2 = +dosm[3];
		}
	}

	return out;
};

export function parse_dos(text) {
	if (text == null)
		return { available: false };

	let out = {
		available: true,
		l3_flood_raw: null,
		l3_flood_count: 0,
		l2_flood_raw: null,
		l2_flood_count: 0,
		l3_type_en: null,
		l2_type_en: null,
		l3_port_mask: null,
		l2_port_mask: null,
		types: []
	};

	for (let line in split(text, '\n')) {
		let s = trim(line);
		if (s == '')
			continue;
		let l3f = match(s, /^l3_flood=([^ \t]+)\s+count=([0-9]+)/);
		if (l3f != null) {
			out.l3_flood_raw = l3f[1];
			out.l3_flood_count = +l3f[2];
			continue;
		}
		let l2f = match(s, /^l2_flood=([^ \t]+)\s+count=([0-9]+)/);
		if (l2f != null) {
			out.l2_flood_raw = l2f[1];
			out.l2_flood_count = +l2f[2];
			continue;
		}
		let te = match(s, /^l3_type_en=([^ \t]+)\s+l2_type_en=([^ \t]+)/);
		if (te != null) {
			out.l3_type_en = te[1];
			out.l2_type_en = te[2];
			continue;
		}
		let pm = match(s, /^l3_port_mask=([^ \t]+)\s+l2_port_mask=([^ \t]+)/);
		if (pm != null) {
			out.l3_port_mask = pm[1];
			out.l2_port_mask = pm[2];
			continue;
		}
		let tm = match(s, /^\[\s*([0-9]+)\]\s+([^ \t]+)\s+l3_en=([01])\s+l3_pol=([^ \t]+)(\s+l3_th=([^ \t]+))?\s+l2_en=([01])(\s+l2_th=([^ \t]+))?(\s+l3_act=([^ \t]+)\s+l2_act=([^ \t]+))?/);
		if (tm != null) {
			push(out.types, {
				idx: +tm[1],
				name: tm[2],
				l3_en: (tm[3] == '1'),
				l3_pol: tm[4],
				l3_th: tm[6] || null,
				l2_en: (tm[7] == '1'),
				l2_th: tm[9] || null,
				l3_act: tm[11] || 'drop',
				l2_act: tm[12] || 'drop'
			});
		}
	}

	return out;
};

/**
 * Validate and normalize enabled UCI 'host' entries.
 * Enforces hardware caps (32 MAC slots, 32 directional vmeters) and unique MACs.
 */
export function build_host_desired(sections) {
	let desired = {};
	let ordered = [];
	let warnings = [];
	let vmeters = 0;

	for (let sec in sections) {
		if (!is_truthy(sec.enabled ?? '1'))
			continue;
		let mac = normalize_mac(sec.mac);
		if (mac == null) {
			push(warnings, `Host rule '${sec['.name'] || '?'}' skipped: invalid unicast MAC '${sec.mac || ''}'`);
			continue;
		}
		if (exists(desired, mac)) {
			push(warnings, `Duplicate Host Policing MAC '${mac}' skipped`);
			continue;
		}
		if (length(ordered) >= HOSTPOL_MAX_ENTRIES) {
			push(warnings, `Host Policing entry limit (${HOSTPOL_MAX_ENTRIES}) exceeded; '${mac}' skipped`);
			continue;
		}
		let ingress_kbps = parse_uint(sec.ingress_kbps ?? '0', 0, HOSTPOL_RATE_MAX_KBPS);
		let egress_kbps = parse_uint(sec.egress_kbps ?? '0', 0, HOSTPOL_RATE_MAX_KBPS);
		if (ingress_kbps == null || egress_kbps == null) {
			push(warnings, `Host '${mac}' skipped: invalid kbps rate`);
			continue;
		}
		let need_vm = (ingress_kbps > 0 ? 1 : 0) + (egress_kbps > 0 ? 1 : 0);
		if (vmeters + need_vm > HOSTPOL_MAX_VMETERS) {
			push(warnings, `Host '${mac}' skipped: hardware vmeter limit (${HOSTPOL_MAX_VMETERS}) exceeded`);
			continue;
		}
		vmeters += need_vm;
		let entry = {
			name: sec['.name'] || mac,
			mac: mac,
			ingress_kbps: ingress_kbps,
			egress_kbps: egress_kbps
		};
		desired[mac] = entry;
		push(ordered, entry);
	}

	return { desired, ordered, warnings, vmeters_used: vmeters };
};

/**
 * Compute minimal hostpol write commands (deletes before adds to avoid stale rates
 * or transient vmeter exhaustion).
 */
export function diff_hostpol_commands(current_items, desired_map, desired_ordered) {
	let cur_map = {};
	let cmds = [];

	for (let item in current_items)
		cur_map[item.mac] = item;

	for (let item in current_items) {
		let want = desired_map[item.mac];
		if (want == null ||
		    want.ingress_kbps != item.ingress_kbps ||
		    want.egress_kbps != item.egress_kbps) {
			push(cmds, `del ${item.mac}`);
			delete cur_map[item.mac];
		}
	}

	for (let want in desired_ordered) {
		if (!exists(cur_map, want.mac))
			push(cmds, `add ${want.mac} ${want.ingress_kbps} ${want.egress_kbps}`);
	}

	return cmds;
};

function sanitize_comment(text) {
	let raw = '' + (text ?? '');
	let clean = replace(raw, /[^a-zA-Z0-9_.:-]/g, '_');
	return substr(clean != '' ? clean : 'rule', 0, 48);
}

function build_single_nft_stmt(fam, l4proto, src_ip, dst_ip, sport, dport, dscp, dscp_set, mac, cos, tag) {
	let parts = [];

	if (fam == 'ip' || fam == 'ip6')
		push(parts, `meta nfproto ${fam == 'ip' ? 'ipv4' : 'ipv6'}`);
	if (mac != null)
		push(parts, `ether saddr ${mac}`);
	if (dscp != null)
		push(parts, `${fam} dscp ${dscp}`);
	if (src_ip != null)
		push(parts, `${fam} saddr ${src_ip}`);
	if (dst_ip != null)
		push(parts, `${fam} daddr ${dst_ip}`);

	if (l4proto == 'icmp') {
		push(parts, `meta l4proto ${fam == 'ip6' ? 'ipv6-icmp' : 'icmp'}`);
	} else if (l4proto == 'tcp' || l4proto == 'udp') {
		push(parts, `meta l4proto ${l4proto}`);
		if (sport != null)
			push(parts, `${l4proto} sport ${sport}`);
		if (dport != null)
			push(parts, `${l4proto} dport ${dport}`);
	}

	if (!length(parts))
		return null;

	if (dscp_set != null)
		push(parts, `${fam} dscp set ${dscp_set}`);
	push(parts, `counter meta priority set 0:${cos} return`);
	push(parts, `comment "${tag}"`);
	return '\t\t' + join(' ', parts);
}

export function load_app_catalog(path) {
	let target = path || getenv('RTL9617C_APP_CATALOG') || APP_CATALOG_PATH;
	let empty = { version: '', categories: [], apps: [], by_id: {}, by_cat: {} };
	let raw = readfile(target);
	if (raw == null || raw == '')
		return empty;
	let parsed;
	try { parsed = json(raw); }
	catch (e) { return empty; }
	if (type(parsed) != 'object' || type(parsed.apps) != 'array')
		return empty;

	let by_id = {};
	let by_cat = {};
	for (let app in parsed.apps) {
		if (type(app) != 'object' || !app.id)
			continue;
		let id = '' + app.id;
		by_id[id] = app;
		let cat = '' + (app.cat || '');
		if (cat != '') {
			if (!exists(by_cat, cat))
				by_cat[cat] = [];
			push(by_cat[cat], app);
		}
	}

	return {
		version: '' + (parsed.version || ''),
		categories: type(parsed.categories) == 'array' ? parsed.categories : [],
		apps: parsed.apps,
		by_id,
		by_cat
	};
};

function chunk_array(arr, size) {
	let out = [];
	for (let i = 0; i < length(arr); i += size)
		push(out, slice(arr, i, i + size));
	return out;
}

export function build_app_plan(enabled, app_sections, catalog) {
	let empty = {
		sets_nft: [],
		rule_stmts: [],
		dnsmasq_conf: '',
		active_cos_sets: [],
		domain_count: 0,
		port_count: 0,
		rule_count: 0,
		warnings: []
	};
	if (!enabled || type(app_sections) != 'array' || !length(app_sections))
		return empty;
	if (catalog == null)
		catalog = load_app_catalog();
	if (!length(catalog.apps))
		return empty;

	let warnings = [];
	let app_rule_stmts = [];
	let cat_rule_stmts = [];
	let seen_stmt = {};
	let domain_winner = {};
	let total_ports = 0;

	for (let sec in app_sections) {
		if (!is_truthy(sec.enabled ?? '1'))
			continue;

		let sec_name = sanitize_comment(sec['.name'] || 'app');
		let cos = parse_uint(sec.cos, 0, COS_MAX);
		if (cos == null) {
			push(warnings, `App rule '${sec_name}' skipped: invalid CoS '${sec.cos || ''}'`);
			continue;
		}
		let dscp_set = null;
		if (trim('' + (sec.dscp_set ?? '')) != '') {
			dscp_set = parse_dscp(sec.dscp_set);
			if (dscp_set == null) {
				push(warnings, `App rule '${sec_name}' skipped: invalid dscp_set`);
				continue;
			}
		}

		let mtype = sec.match_type == 'app' ? 'app' : 'category';
		let matched_apps = [];
		if (mtype == 'app') {
			let aid = trim('' + (sec.app_id ?? ''));
			if (aid != '' && exists(catalog.by_id, aid))
				push(matched_apps, catalog.by_id[aid]);
		} else {
			let cid = trim('' + (sec.category ?? ''));
			if (cid != '' && exists(catalog.by_cat, cid))
				matched_apps = catalog.by_cat[cid];
		}
		if (!length(matched_apps)) {
			push(warnings, `App rule '${sec_name}' skipped: unknown target`);
			continue;
		}

		let tcp_set = {};
		let udp_set = {};
		let is_app = (mtype == 'app');

		for (let app in matched_apps) {
			for (let p in (app.tcp || []))
				tcp_set['' + p] = true;
			for (let p in (app.udp || []))
				udp_set['' + p] = true;
			for (let dom in (app.domains || [])) {
				let d = lc(trim('' + dom));
				if (d == '')
					continue;
				let prev = domain_winner[d];
				if (prev == null ||
				    (is_app && !prev.is_app) ||
				    (is_app == prev.is_app && cos > prev.cos)) {
					domain_winner[d] = { cos, dscp_set, is_app };
				}
			}
		}

		let tag = 'rtl9617c-qos:__app_' + sec_name;
		let tcp_list = sort(keys(tcp_set));
		let udp_list = sort(keys(udp_set));
		total_ports += length(tcp_list) + length(udp_list);

		for (let pair in [['tcp', tcp_list], ['udp', udp_list]]) {
			let l4 = pair[0];
			let plist = pair[1];
			for (let chunk in chunk_array(plist, 48)) {
				let expr = format_port_expr(join(',', chunk));
				if (expr == null)
					continue;
				for (let dir_key in ['dport', 'sport']) {
					let target_stmts = is_app ? app_rule_stmts : cat_rule_stmts;
					if (dscp_set != null) {
						for (let fam in ['ip', 'ip6']) {
							let s = `\t\tmeta nfproto ${fam == 'ip' ? 'ipv4' : 'ipv6'} ${l4} ${dir_key} ${expr} ${fam} dscp set ${dscp_set} counter meta priority set 0:${cos} return comment "${tag}"`;
							if (!exists(seen_stmt, s)) {
								seen_stmt[s] = true;
								push(target_stmts, s);
							}
						}
					} else {
						let s = `\t\t${l4} ${dir_key} ${expr} counter meta priority set 0:${cos} return comment "${tag}"`;
						if (!exists(seen_stmt, s)) {
							seen_stmt[s] = true;
							push(target_stmts, s);
						}
					}
				}
			}
		}
	}

	let doms_by_cos = {};
	let dscp_by_cos = {};
	let all_doms = sort(keys(domain_winner));
	for (let d in all_doms) {
		let info = domain_winner[d];
		let ck = '' + info.cos;
		if (!exists(doms_by_cos, ck))
			doms_by_cos[ck] = [];
		push(doms_by_cos[ck], d);
		if (info.dscp_set != null && !exists(dscp_by_cos, ck))
			dscp_by_cos[ck] = info.dscp_set;
	}

	let sets_nft = [];
	let dom_stmts = [];
	let dns_lines = [];
	let active_cos_sets = [];
	let cos_keys = sort(keys(doms_by_cos), (a, b) => (+b) - (+a));

	for (let ck in cos_keys) {
		let cos = +ck;
		let dlist = doms_by_cos[ck];
		let set4 = `rtl9617c_qos_app_c${cos}_v4`;
		let set6 = `rtl9617c_qos_app_c${cos}_v6`;
		let dscp_set = exists(dscp_by_cos, ck) ? dscp_by_cos[ck] : null;
		let tag = `rtl9617c-qos:__app_dom_c${cos}`;
		push(active_cos_sets, cos);

		push(sets_nft, [
			`set ${set4} {`,
			'\ttype ipv4_addr',
			'\tflags timeout',
			'\ttimeout 12h',
			'}',
			`set ${set6} {`,
			'\ttype ipv6_addr',
			'\tflags timeout',
			'\ttimeout 12h',
			'}'
		]);

		let d4 = dscp_set != null ? ` ip dscp set ${dscp_set}` : '';
		let d6 = dscp_set != null ? ` ip6 dscp set ${dscp_set}` : '';
		push(dom_stmts, `\t\tip daddr @${set4}${d4} counter meta priority set 0:${cos} return comment "${tag}"`);
		push(dom_stmts, `\t\tip saddr @${set4}${d4} counter meta priority set 0:${cos} return comment "${tag}"`);
		push(dom_stmts, `\t\tip6 daddr @${set6}${d6} counter meta priority set 0:${cos} return comment "${tag}"`);
		push(dom_stmts, `\t\tip6 saddr @${set6}${d6} counter meta priority set 0:${cos} return comment "${tag}"`);

		for (let chunk in chunk_array(dlist, 10))
			push(dns_lines, `nftset=/${join('/', chunk)}/4#inet#fw4#${set4},6#inet#fw4#${set6}`);
	}

	let all_stmts = [...dom_stmts, ...app_rule_stmts, ...cat_rule_stmts];
	let flat_sets = [];
	for (let blk in sets_nft)
		push(flat_sets, join('\n', blk));

	let dnsmasq_conf = length(dns_lines)
		? ('# Managed by luci-app-rtl9617c-qos — do not edit manually\n' + join('\n', dns_lines) + '\n')
		: '';

	return {
		sets_nft: flat_sets,
		rule_stmts: all_stmts,
		dnsmasq_conf,
		active_cos_sets,
		domain_count: length(all_doms),
		port_count: total_ports,
		rule_count: length(all_stmts),
		warnings
	};
};

/**
 * Render an fw4-includable nftables chain snippet setting meta priority before flow offload.
 * Returns { content: string, rule_count: int, warnings: array, dnsmasq_conf: string, active_cos_sets: array }.
 */
export function build_nft_rules(enabled, sections, global_sec, app_sections, catalog) {
	let warnings = [];
	let stmts = [];
	let seen = {};
	global_sec = global_sec || {};

	if (!enabled) {
		return {
			content: '# Managed by luci-app-rtl9617c-qos (disabled)\n',
			rule_count: 0,
			warnings,
			dnsmasq_conf: '',
			active_cos_sets: [],
			app_domain_count: 0,
			app_port_count: 0
		};
	}

	let small_stmts = [];
	if (is_truthy(global_sec.small_pkt_prio ?? '0')) {
		let sp_bytes = parse_uint(global_sec.small_pkt_bytes ?? '256', 64, 1024) ?? 256;
		let sp_cos = parse_uint(global_sec.small_pkt_cos ?? '6', 0, COS_MAX) ?? 6;
		let sp_mode = (global_sec.small_pkt_mode == 'all') ? 'all' : 'udp_icmp';
		if (sp_mode == 'all') {
			push(small_stmts, `\t\tmeta l4proto != tcp meta length <= ${sp_bytes} counter meta priority set 0:${sp_cos} return comment "rtl9617c-qos:__small_pkt"`);
			push(small_stmts, `\t\tmeta l4proto tcp tcp flags & psh != 0 meta length <= ${sp_bytes} counter meta priority set 0:${sp_cos} return comment "rtl9617c-qos:__small_pkt"`);
		} else {
			push(small_stmts, `\t\tmeta l4proto { icmp, ipv6-icmp, udp } meta length <= ${sp_bytes} counter meta priority set 0:${sp_cos} return comment "rtl9617c-qos:__small_pkt"`);
			push(small_stmts, `\t\ttcp dport { 22, 53, 853 } meta length <= ${sp_bytes} counter meta priority set 0:${sp_cos} return comment "rtl9617c-qos:__small_pkt"`);
		}
	}

	let app_plan = build_app_plan(enabled, app_sections, catalog);
	for (let w in app_plan.warnings)
		push(warnings, w);

	// Rule precedence (first-match-wins with terminal return):
	// 1. User custom classify rules (top-to-bottom)
	// 2. App signature rules (individual app overrides then category rules)
	// 3. Unclassified interactive small-packet fallback
	// 4. Optional baseline default_cos catch-all (so bulk CoS 0 stays lowest)
	for (let sec in sections) {
		if (!is_truthy(sec.enabled ?? '1'))
			continue;

		let sec_name = sanitize_comment(sec['.name'] || 'cls');
		let cos = parse_uint(sec.cos, 0, COS_MAX);
		if (cos == null) {
			push(warnings, `Classify rule '${sec_name}' skipped: invalid CoS '${sec.cos || ''}'`);
			continue;
		}

		let req_fam = sec.family ?? 'any';
		if (req_fam != 'any' && req_fam != 'ip' && req_fam != 'ip6') {
			push(warnings, `Classify rule '${sec_name}' skipped: invalid family '${req_fam}'`);
			continue;
		}

		let sip = null, dip = null, ip_fam = null;
		if (trim('' + (sec.src_ip ?? '')) != '') {
			let n = normalize_ip(sec.src_ip);
			if (n == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid src_ip`);
				continue;
			}
			sip = n.value;
			ip_fam = n.family;
		}
		if (trim('' + (sec.dst_ip ?? '')) != '') {
			let n = normalize_ip(sec.dst_ip);
			if (n == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid dst_ip`);
				continue;
			}
			if (ip_fam != null && ip_fam != n.family) {
				push(warnings, `Classify rule '${sec_name}' skipped: mixed IPv4/IPv6 src/dst`);
				continue;
			}
			dip = n.value;
			ip_fam = n.family;
		}
		if (ip_fam != null && req_fam != 'any' && req_fam != ip_fam) {
			push(warnings, `Classify rule '${sec_name}' skipped: family '${req_fam}' mismatches IP`);
			continue;
		}

		let sport = null, dport = null;
		if (trim('' + (sec.src_port ?? '')) != '') {
			sport = format_port_expr(sec.src_port);
			if (sport == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid src_port`);
				continue;
			}
		}
		if (trim('' + (sec.dst_port ?? '')) != '') {
			dport = format_port_expr(sec.dst_port);
			if (dport == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid dst_port`);
				continue;
			}
		}

		let dscp = null;
		if (trim('' + (sec.dscp ?? '')) != '') {
			dscp = parse_dscp(sec.dscp);
			if (dscp == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid DSCP`);
				continue;
			}
		}

		let dscp_set = null;
		if (trim('' + (sec.dscp_set ?? '')) != '') {
			dscp_set = parse_dscp(sec.dscp_set);
			if (dscp_set == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid dscp_set`);
				continue;
			}
		}

		let mac = null;
		if (trim('' + (sec.src_mac ?? '')) != '') {
			mac = normalize_mac(sec.src_mac);
			if (mac == null) {
				push(warnings, `Classify rule '${sec_name}' skipped: invalid src_mac`);
				continue;
			}
		}

		let proto = sec.proto ?? 'any';
		if (proto != 'any' && proto != 'tcp' && proto != 'udp' && proto != 'tcp_udp' && proto != 'icmp') {
			push(warnings, `Classify rule '${sec_name}' skipped: invalid proto '${proto}'`);
			continue;
		}
		if ((sport != null || dport != null) && proto == 'icmp') {
			push(warnings, `Classify rule '${sec_name}' skipped: ICMP does not support ports`);
			continue;
		}
		if ((sport != null || dport != null) && proto == 'any')
			proto = 'tcp_udp';

		let direction = sec.direction ?? 'both';
		if (direction != 'both' && direction != 'src' && direction != 'dst')
			direction = 'both';

		let families = ip_fam != null ? [ip_fam] : (req_fam == 'any' ? ['ip', 'ip6'] : [req_fam]);
		let l4_list = proto == 'tcp_udp' ? ['tcp', 'udp'] : [proto];
		let dirs = ['fwd'];
		if (direction == 'both' && (sip != dip || sport != dport))
			push(dirs, 'rev');

		let tag = 'rtl9617c-qos:' + sec_name;
		let before_count = length(stmts);
		for (let fam in families) {
			for (let l4 in l4_list) {
				for (let d in dirs) {
					let use_sip = d == 'fwd' ? sip : dip;
					let use_dip = d == 'fwd' ? dip : sip;
					let use_sp = d == 'fwd' ? sport : dport;
					let use_dp = d == 'fwd' ? dport : sport;
					/* ether saddr matches LAN-side ingress packet; omit on reverse reply */
					let use_mac = d == 'fwd' ? mac : null;
					let stmt = build_single_nft_stmt(fam, l4, use_sip, use_dip, use_sp, use_dp, dscp, dscp_set, use_mac, cos, tag);
					if (stmt != null && !exists(seen, stmt)) {
						seen[stmt] = true;
						push(stmts, stmt);
					}
				}
			}
		}
		if (length(stmts) == before_count)
			push(warnings, `Classify rule '${sec_name}' skipped: no match criteria specified`);
	}

	for (let s in app_plan.rule_stmts) {
		if (!exists(seen, s)) {
			seen[s] = true;
			push(stmts, s);
		}
	}

	for (let s in small_stmts) {
		if (!exists(seen, s)) {
			seen[s] = true;
			push(stmts, s);
		}
	}

	let def_cos = parse_uint(global_sec.default_cos ?? '0', 0, COS_MAX) ?? 0;
	if (def_cos > 0) {
		let def_stmt = `\t\tcounter meta priority set 0:${def_cos} return comment "rtl9617c-qos:__default"`;
		if (!exists(seen, def_stmt)) {
			seen[def_stmt] = true;
			push(stmts, def_stmt);
		}
	}

	if (!length(stmts)) {
		return {
			content: '# Managed by luci-app-rtl9617c-qos (no active rules)\n',
			rule_count: 0,
			warnings,
			dnsmasq_conf: '',
			active_cos_sets: [],
			app_domain_count: 0,
			app_port_count: 0
		};
	}

	let body = [
		'# Managed by luci-app-rtl9617c-qos — do not edit manually'
	];
	for (let sb in app_plan.sets_nft)
		push(body, sb);
	push(body, 'chain rtl9617c_qos_mangle {');
	push(body, '\ttype filter hook forward priority mangle + 5; policy accept;');
	push(body, join('\n', stmts));
	push(body, '}');
	push(body, '');
	return {
		content: join('\n', body),
		rule_count: length(stmts),
		warnings,
		dnsmasq_conf: app_plan.dnsmasq_conf,
		active_cos_sets: app_plan.active_cos_sets,
		app_domain_count: app_plan.domain_count,
		app_port_count: app_plan.port_count
	};
};

/**
 * Build validated tc argv arrays for a single NI port section.
 * Enforces hardware constraints from ni_qos.c and sch_ets.c.
 */
export function build_port_tc_plan(sec) {
	let dev = trim('' + (sec.device ?? ''));
	if (!valid_netdev_name(dev))
		return { error: `Invalid device name '${dev}'` };

	let enabled = is_truthy(sec.enabled ?? '1');
	let egress_mode = enabled ? (sec.egress_mode ?? 'none') : 'none';
	if (egress_mode == 'mqprio')
		egress_mode = 'sp';

	let root_cmd = null;
	if (egress_mode == 'tbf') {
		let rate = parse_uint(sec.shaper_kbps, 1, HOSTPOL_RATE_MAX_KBPS);
		let burst = parse_uint(sec.shaper_burst ?? ('' + TBF_DEFAULT_BURST), TBF_MIN_BURST, TBF_MAX_BURST);
		if (rate == null || burst == null)
			return { error: `Invalid TBF shaper parameters on ${dev}` };
		root_cmd = [
			'tc', 'qdisc', 'replace', 'dev', dev, 'root', 'tbf',
			'rate', rate + 'kbit', 'burst', '' + burst, 'latency', '50ms'
		];
	} else if (egress_mode == 'sp') {
		root_cmd = [
			'tc', 'qdisc', 'replace', 'dev', dev, 'root', 'handle', '1:',
			'ets', 'bands', '8', 'strict', '8',
			'priomap', '7', '6', '5', '4', '3', '2', '1', '0', '7', '6', '5', '4', '3', '2', '1', '0'
		];
	} else if (egress_mode == 'ets') {
		let strict_bands = parse_uint(sec.strict_bands ?? '0', 0, VOQ_COUNT);
		if (strict_bands == null)
			return { error: `Invalid strict_bands on ${dev}` };
		let cmd = [
			'tc', 'qdisc', 'replace', 'dev', dev, 'root', 'handle', '1:',
			'ets', 'bands', '8', 'strict', '' + strict_bands
		];
		if (strict_bands < VOQ_COUNT) {
			push(cmd, 'quanta');
			for (let b = VOQ_COUNT - 1 - strict_bands; b >= 0; b--) {
				let qv = parse_uint(sec['voq' + b + '_quantum'] ?? '1500', 256, 1048576);
				if (qv == null)
					return { error: `Invalid quantum for VoQ ${b} on ${dev}` };
				push(cmd, '' + qv);
			}
		}
		push(cmd, 'priomap', '7', '6', '5', '4', '3', '2', '1', '0', '7', '6', '5', '4', '3', '2', '1', '0');
		root_cmd = cmd;
	} else if (egress_mode != 'none') {
		return { error: `Unsupported egress_mode '${egress_mode}' on ${dev}` };
	}

	let ingress_cmds = [];
	let ingress_enable = enabled && is_truthy(sec.ingress_enable ?? '0');
	if (ingress_enable) {
		let cir = parse_uint(sec.ingress_cir_kbps, 1, HOSTPOL_RATE_MAX_KBPS);
		let pir = parse_uint(sec.ingress_pir_kbps ?? sec.ingress_cir_kbps, 1, HOSTPOL_RATE_MAX_KBPS);
		let burst = parse_uint(sec.ingress_burst ?? ('' + TBF_DEFAULT_BURST), TBF_MIN_BURST, TBF_MAX_BURST);
		if (cir == null || pir == null || burst == null)
			return { error: `Invalid ingress policer parameters on ${dev}` };
		if (pir < cir)
			pir = cir;
		push(ingress_cmds, ['tc', 'qdisc', 'replace', 'dev', dev, 'clsact']);
		let filter_cmd = [
			'tc', 'filter', 'replace', 'dev', dev, 'ingress',
			'protocol', 'all', 'pref', '10', 'flower', 'skip_sw',
			'action', 'police', 'rate', cir + 'kbit'
		];
		if (pir > cir)
			push(filter_cmd, 'peakrate', pir + 'kbit', 'mtu', '16384');
		push(filter_cmd, 'burst', '' + burst, 'conform-exceed', 'drop/ok');
		push(ingress_cmds, filter_cmd);
	}

	return {
		device: dev,
		egress_mode: egress_mode,
		root_cmd: root_cmd,
		ingress_enable: ingress_enable,
		ingress_cmds: ingress_cmds
	};
};

export function parse_mirror(text) {
	if (text == null)
		return { available: false, enabled: false, port: 0, arg1: 0, arg2: 0, len: 0 };
	let m = match(trim(text), /enabled=([01])\s+arg0=([0-9]+)\s+arg1=([0-9]+)\s+arg2=([0-9]+)\s+len=([0-9]+)\s+ctrl=([^ \t\n]+)\s+mirror_len=([^ \t\n]+)/);
	if (m == null)
		return { available: false, enabled: false, port: 0, arg1: 0, arg2: 0, len: 0 };
	return {
		available: true,
		enabled: (m[1] == '1'),
		port: +m[2],
		arg1: +m[3],
		arg2: +m[4],
		len: +m[5],
		ctrl: m[6],
		mirror_len_reg: m[7]
	};
};

export function build_dos_plan(enabled, global_sec) {
	global_sec = global_sec || {};
	let dos_en = enabled && is_truthy(global_sec.dos_enabled ?? '0');
	let dos_cmds = [];

	if (!dos_en) {
		return {
			dos_enabled: false,
			te_flow_cmd: 'dos off',
			dos_cmds: []
		};
	}

	/*
	 * Always program non-zero flood thresholds BEFORE enabling flood types
	 * and port masks; hardware reset values are 0, which would drop normal
	 * ICMP/SYN/FIN packets as soon as the engine is armed.
	 */
	let icmp_th = parse_uint(global_sec.dos_icmp_th, 1, 65535) ?? DOS_DEFAULT_ICMP_TH;
	push(dos_cmds, `th icmp_flood ${icmp_th}`);
	push(dos_cmds, `l2-th icmp_flood ${icmp_th}`);

	let fin_th = parse_uint(global_sec.dos_fin_th, 1, 65535) ?? DOS_DEFAULT_FIN_TH;
	push(dos_cmds, `th fin_flood ${fin_th}`);
	push(dos_cmds, `l2-th fin_flood ${fin_th}`);

	let syn_th = parse_uint(global_sec.dos_syn_th, 1, 65535) ?? DOS_DEFAULT_SYN_TH;
	push(dos_cmds, `th syn_flood ${syn_th}`);
	push(dos_cmds, `l2-th syn_flood ${syn_th}`);

	let disabled_raw = global_sec.dos_disabled_types;
	let disabled_set = {};
	if (type(disabled_raw) == 'array') {
		for (let item in disabled_raw)
			disabled_set[trim('' + item)] = true;
	} else if (type(disabled_raw) == 'string' && trim(disabled_raw) != '') {
		for (let item in split(trim(disabled_raw), /[ ,\t]+/))
			if (item != '')
				disabled_set[item] = true;
	}

	let allow_syn1024 = is_truthy(global_sec.dos_allow_syn1024 ?? '0');

	for (let tname in DOS_TYPES) {
		/*
		 * Hardware syn1024 matches any TCP packet with SYN=1 and sport < 1024,
		 * which includes legitimate SYN+ACK replies from HTTP/80 & HTTPS/443
		 * servers arriving on WAN (port 7). Keep it OFF unless explicitly opted in.
		 */
		let is_off = exists(disabled_set, tname) || (tname == 'syn1024' && !allow_syn1024);
		let state = is_off ? 'off' : 'on';
		push(dos_cmds, `type ${tname} ${state}`);
		push(dos_cmds, `l2-type ${tname} ${state}`);
	}

	let mask = trim('' + (global_sec.dos_port_mask ?? ''));
	if (!match(mask, /^0x[0-9a-fA-F]{1,16}$/))
		mask = DOS_DEFAULT_PORT_MASK;
	push(dos_cmds, `port-mask ${mask}`);
	push(dos_cmds, `l2-port-mask ${mask}`);

	return {
		dos_enabled: true,
		te_flow_cmd: 'dos on',
		dos_cmds: dos_cmds
	};
};

export function diff_policer_commands(current_list, sections, is_group) {
	let max_slots = is_group ? L3TE_GROUP_SLOTS_MAX : L3TE_FLOW_SLOTS_MAX;
	let cmd_name = is_group ? 'grp' : 'policer';
	let free_name = is_group ? 'grp-free' : 'policer-free';
	let desired = {};
	let ordered = [];
	let warnings = [];

	for (let sec in (sections || [])) {
		if (!is_truthy(sec.enabled ?? '1'))
			continue;
		let raw_slot = is_group ? (sec.group ?? sec.slot) : sec.slot;
		let slot = parse_uint(raw_slot, 0, max_slots - 1);
		if (slot == null) {
			push(warnings, `${cmd_name} rule skipped: invalid slot '${raw_slot ?? ''}'`);
			continue;
		}
		if (exists(desired, '' + slot)) {
			push(warnings, `Duplicate ${cmd_name} slot ${slot} skipped`);
			continue;
		}
		let cir = parse_uint(sec.cir_kbps, 1, HOSTPOL_RATE_MAX_KBPS);
		let pir = parse_uint(sec.pir_kbps ?? sec.cir_kbps, 1, HOSTPOL_RATE_MAX_KBPS);
		let cbs = parse_uint(sec.cbs ?? '2048', 1, L3TE_POL_BURST_MAX);
		let pbs = parse_uint(sec.pbs ?? sec.cbs ?? '4095', 1, L3TE_POL_BURST_MAX);
		if (cir == null || pir == null || cbs == null || pbs == null) {
			push(warnings, `${cmd_name} slot ${slot} skipped: invalid rate/burst`);
			continue;
		}
		if (pir < cir)
			pir = cir;
		let item = { slot, cir_kbps: cir, pir_kbps: pir, cbs, pbs };
		desired['' + slot] = item;
		push(ordered, item);
	}

	let cur_map = {};
	let cmds = [];
	for (let cur in (current_list || [])) {
		let s = cur.slot ?? cur.group;
		if (s == null)
			continue;
		cur_map['' + s] = cur;
		let want = desired['' + s];
		if (want == null) {
			push(cmds, `${free_name} ${s}`);
			delete cur_map['' + s];
		}
	}

	sort(ordered, (a, b) => a.slot - b.slot);
	for (let want in ordered) {
		let cur = cur_map['' + want.slot];
		if (cur == null ||
		    cur.cir_kbps != want.cir_kbps ||
		    cur.pir_kbps != want.pir_kbps ||
		    cur.cbs != want.cbs ||
		    cur.pbs != want.pbs) {
			push(cmds, `${cmd_name} ${want.slot} ${want.cir_kbps} ${want.pir_kbps} ${want.cbs} ${want.pbs}`);
		}
	}

	return { cmds, warnings };
};

function pack_wred_profile(unmark_dp, mark_dp, unmark_idx, mark_idx) {
	let w = [0, 0, 0, 0, 0, 0, ((mark_idx & 0xf) << 4) | (unmark_idx & 0xf), 0];
	for (let i = 0; i < 16; i++) {
		let bp = i * 6;
		let wi = int(bp / 32);
		let sh = bp % 32;
		let uv = unmark_dp[i] & 0x3f;
		let mv = mark_dp[i] & 0x3f;
		w[wi] |= (uv << sh) & 0xffffffff;
		w[3 + wi] |= (mv << sh) & 0xffffffff;
		if (sh > 26) {
			w[wi + 1] |= uv >> (32 - sh);
			w[3 + wi + 1] |= mv >> (32 - sh);
		}
	}
	return map(w, x => sprintf('0x%08x', x));
}

export function build_wred_commands(enabled, global_sec) {
	global_sec = global_sec || {};
	let wred_en = enabled && is_truthy(global_sec.wred_enabled ?? '0');
	let prof = wred_en ? (parse_uint(global_sec.wred_profile ?? '1', 1, 31) ?? 1) : 0;
	let ecn_en = wred_en && is_truthy(global_sec.wred_ecn ?? '0') ? 1 : 0;
	let max_q = parse_uint(global_sec.wred_queues ?? '64', 1, 64) ?? 64;
	let cmds = [];

	if (!wred_en) {
		push(cmds, 'wred-ctrl 0 0');
		push(cmds, 'wred-cfg 0 0 0');
		for (let i = 0; i < 4; i++)
			push(cmds, `pie ${i} 0`);
		for (let q = 0; q < max_q; q++)
			push(cmds, `wred ${q} 0 all`);
		return cmds;
	}

	/*
	 * Silicon-calibrated RTL9617C L3TE WRED curves:
	 *   - Hardware indexes dp[0..15] by bucket = AFGS >> idx (free buffers!).
	 *     bucket >= 16 bypasses WRED (0% drop); bucket 0 = near-empty free pool
	 *     (maximum congestion -> highest drop probability 63/63).
	 *   - Curves are therefore DESCENDING from bucket 0 (full) to 15 (idle):
	 *       preset 1 (gentle):     intervenes below ~50% free window
	 *       preset 2 (moderate):   intervenes below ~62% free window
	 *       preset 3 (aggressive): intervenes below ~81% free window
	 *   - Pool-matched shifts (verified against live wred_afgs):
	 *       LAN DeepQ  (10832 bufs, q=0..15):  profiles 1..3, idx=9 (16*512 = 8192)
	 *       CPU RX     (  512 bufs, q=16..23): profiles 4..6, idx=5 (16*32  =  512)
	 *       WAN/PON DQ ( 1024 bufs, q=24..63): profiles 7..9, idx=6 (16*64  = 1024)
	 */
	let curves = [
		[
			[63, 32, 20, 12, 8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
			[63, 63, 63, 56, 48, 36, 26, 18, 12, 8, 4, 2, 0, 0, 0, 0]
		],
		[
			[63, 60, 52, 42, 32, 22, 14, 8, 4, 2, 0, 0, 0, 0, 0, 0],
			[63, 63, 63, 63, 63, 56, 46, 36, 28, 20, 14, 8, 4, 2, 0, 0]
		],
		[
			[63, 63, 63, 58, 48, 36, 26, 18, 12, 8, 4, 2, 1, 0, 0, 0],
			[63, 63, 63, 63, 63, 63, 58, 48, 38, 28, 20, 14, 8, 4, 2, 0]
		]
	];

	// LAN DeepQ profiles 1..3 (idx=9), CPU profiles 4..6 (idx=5), WAN/PON profiles 7..9 (idx=6)
	let banks = [
		{ base: 1, idx: 9 },
		{ base: 4, idx: 5 },
		{ base: 7, idx: 6 }
	];
	for (let b in banks) {
		for (let i = 0; i < 3; i++) {
			let words = pack_wred_profile(curves[i][0], curves[i][1], b.idx, b.idx);
			push(cmds, `wred-prof ${b.base + i} ${join(' ', words)}`);
		}
	}

	// EWMA smoothing weight=2 (1/4), sel_worst=1 so unused EQ1=16383 never masks EQ0 congestion.
	push(cmds, 'wred-cfg 0 2 1');

	// Protect strict interactive VoQs 5..7 (profile 0 = 0% drop),
	// and apply calibrated WRED curve on VoQs 0..4 (earlier drop on bulk VoQs 0..1).
	for (let q = 0; q < max_q; q++) {
		let q_prof = prof;
		let q_bulk = prof;
		if (prof <= 3) {
			let bank_off = (q < 16) ? 0 : ((q < 24) ? 3 : 6);
			let bulk_idx = (prof < 3) ? (prof + 1) : 3;
			q_prof = bank_off + prof;
			q_bulk = bank_off + bulk_idx;
		}
		for (let f = 0; f < 2; f++)
			push(cmds, `wred ${q} ${q_bulk} ${f}`);
		for (let f = 2; f < 5; f++)
			push(cmds, `wred ${q} ${q_prof} ${f}`);
		for (let f = 5; f < 8; f++)
			push(cmds, `wred ${q} 0 ${f}`);
	}

	// Enable per-port WRED evaluation in L3TE_PIE_WRED_PORT_EN (0x9080..0x908c);
	// VoQs 5..7 stay lossless via profile 0.
	for (let i = 0; i < 4; i++)
		push(cmds, `pie ${i} 0xffffffff`);
	push(cmds, `wred-ctrl 1 ${ecn_en}`);
	return cmds;
};

export function build_mirror_commands(enabled, global_sec) {
	global_sec = global_sec || {};
	let mir_en = enabled && is_truthy(global_sec.mirror_enabled ?? '0');
	if (!mir_en)
		return ['disable'];
	let port = parse_uint(global_sec.mirror_port ?? '1', 0, 63) ?? 1;
	if (port >= 16 && port <= 23)
		return ['disable'];
	let len = parse_uint(global_sec.mirror_len ?? '2048', 64, 4095) ?? 2048;
	return [`len ${len}`, `port ${port}`];
};

export function parse_tunnel(text) {
	let out = {
		available: false,
		ready: false,
		last: '',
		content_used: 0,
		content_max: 16,
		control_used: 0,
		control_max: 16,
		fmr_used: 0,
		fmr_max: 3,
		l2tp_slots: 0,
		pptp_slots: 0,
		eif_used: 0,
		eif_refs: 0,
		content_items: [],
		control_items: [],
		fmr_items: [],
		eif_items: []
	};
	if (text == null)
		return out;
	out.available = true;

	let content_by_idx = {};
	let control_by_idx = {};
	let fmr_by_idx = {};

	for (let raw_line in split(text, '\n')) {
		let line = trim(raw_line);
		if (line == '')
			continue;

		let hm = match(line, /^ready=([01])\s+last:\s*(.*)$/);
		if (hm != null) {
			out.ready = hm[1] == '1';
			out.last = trim(hm[2]);
			continue;
		}

		let sm = match(line, /^(content|control|fmr)\[([0-9]+)\]:\s+owner=([0-9]+)\s+type=([0-9]+)\(([^)]*)\)\s+(allocated|free)$/);
		if (sm != null) {
			if (sm[6] != 'allocated')
				continue;
			let rec = {
				table: sm[1],
				idx: +sm[2],
				owner: +sm[3],
				type_id: +sm[4],
				type_name: sm[5],
				raw: ''
			};
			if (sm[1] == 'content') {
				out.content_used++;
				push(out.content_items, rec);
				content_by_idx[rec.idx] = rec;
			} else if (sm[1] == 'control') {
				out.control_used++;
				push(out.control_items, rec);
				control_by_idx[rec.idx] = rec;
				if (rec.type_name == 'l2tp')
					out.l2tp_slots++;
				else if (rec.type_name == 'pptp')
					out.pptp_slots++;
			} else {
				out.fmr_used++;
				push(out.fmr_items, rec);
				fmr_by_idx[rec.idx] = rec;
			}
			continue;
		}

		let dm = match(line, /^(content|control|fmr)\s+([0-9]+)\s+owner=[0-9]+\s+type=[0-9]+\([^)]*\)\s+(.*)$/);
		if (dm != null) {
			let idx = +dm[2];
			let map_tbl = dm[1] == 'content' ? content_by_idx : (dm[1] == 'control' ? control_by_idx : fmr_by_idx);
			if (exists(map_tbl, idx))
				map_tbl[idx].raw = trim(dm[3]);
			continue;
		}

		let em = match(line, /^hash\s+([0-9]+):\s+phys=\s*([0-9]+)\s+used=([01])\s+refs=([0-9]+)\s+param=([0-9a-fA-F]+)$/);
		if (em != null && em[3] == '1') {
			let refs = +em[4];
			out.eif_used++;
			out.eif_refs += refs;
			push(out.eif_items, {
				hash: +em[1],
				phys: +em[2],
				refs,
				param: em[5]
			});
		}
	}
	return out;
};
