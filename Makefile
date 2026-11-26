include $(TOPDIR)/rules.mk

LUCI_TITLE:=RTL9617C hardware QoS and Host Policing UI
LUCI_DESCRIPTION:=Native Web UI and UCI control service for RTL9617C Host Policing, L2TE/8-VoQ port shaping, flowtable CoS priority rules, and L3TE/DoS telemetry
LUCI_DEPENDS:=@TARGET_rtl9617c +luci-base +tc +kmod-sched-flower +kmod-sched-act-police +kmod-sched-mqprio +rpcd-mod-ucode +ucode-mod-fs +ucode-mod-uci
LUCI_PKGARCH:=all
PKG_VERSION:=0.1.0
PKG_RELEASE:=11
PKG_LICENSE:=GPL-2.0-or-later
# CSSTidy 1.3 breaks CSS custom properties and responsive grid rules.
CONFIG_LUCI_CSSTIDY:=

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-rtl9617c-qos/conffiles
/etc/config/rtl9617c_qos
/etc/rtl9617c-qos/app_signatures.json
endef

define Package/luci-app-rtl9617c-qos/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	for f in /usr/share/rpcd/ucode/luci.rtl9617c-qos \
		 /usr/libexec/rtl9617c-qos-apply \
		 /etc/init.d/rtl9617c-qos; do
		[ -f "$$f" ] && chmod 0755 "$$f"
	done
	[ -f /usr/share/ucode/rtl9617c/qos.uc ] && chmod 0644 /usr/share/ucode/rtl9617c/qos.uc
	[ -f /usr/share/rtl9617c/app_signatures.json ] && chmod 0644 /usr/share/rtl9617c/app_signatures.json
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null || true
	/etc/init.d/rtl9617c-qos enable 2>/dev/null || true
	/etc/init.d/rtl9617c-qos reload 2>/dev/null || true
fi
exit 0
endef

define Package/luci-app-rtl9617c-qos/prerm
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ] && [ "$${PKG_UPGRADE}" != 1 ]; then
	/etc/init.d/rtl9617c-qos stop 2>/dev/null || true
	rm -f /etc/nftables.d/90-rtl9617c-qos.nft
	/etc/init.d/firewall reload 2>/dev/null || true
fi
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
