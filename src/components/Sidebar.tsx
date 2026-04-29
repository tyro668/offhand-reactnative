import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {usePermissionStatus} from '../services/OverlayManager';

const SIDEBAR_WIDTH = 220;

interface MenuItem {
  key: string;
  label: string;
  icon: string;
}

interface Props {
  activeKey: string;
  menuItems: MenuItem[];
  onSelect: (key: string) => void;
}

export default function Sidebar({activeKey, menuItems, onSelect}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const {
    status,
    requestAccessibility,
    requestInputMonitoring,
    requestMicrophone,
  } = usePermissionStatus();

  const permissionRows: Array<{
    key: string;
    title: string;
    onGrant: () => void;
  }> = [];
  if (status) {
    if (!status.microphone) {
      permissionRows.push({
        key: 'mic',
        title: t('permissionMicrophoneTitle'),
        onGrant: () => {
          void requestMicrophone();
        },
      });
    }
    if (!status.accessibility) {
      permissionRows.push({
        key: 'a11y',
        title: t('permissionAccessibilityTitle'),
        onGrant: () => {
          void requestAccessibility();
        },
      });
    }
    if (!status.inputMonitoring) {
      permissionRows.push({
        key: 'input',
        title: t('permissionInputMonitoringTitle'),
        onGrant: () => {
          void requestInputMonitoring();
        },
      });
    }
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.appName}>{t('appName')}</Text>
        <Text style={s.tagline}>{t('appTagline')}</Text>
      </View>

      {/* Menu */}
      <View style={s.menu}>
        {menuItems.map(item => {
          const active = activeKey === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[s.menuItem, active && s.menuItemActive]}
              onPress={() => onSelect(item.key)}>
              <Text style={[s.menuIcon, active && s.menuIconActive]}>
                {item.icon}
              </Text>
              <Text style={[s.menuLabel, active && s.menuLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer spacer */}
      <View style={s.footer} />

      {/* Permission status (only shown when something is missing) */}
      {permissionRows.length > 0 && (
        <View style={s.permissions}>
          {permissionRows.map(row => (
            <View key={row.key} style={s.permissionRow}>
              <View style={s.permissionTextWrap}>
                <View style={s.permissionDot} />
                <Text style={s.permissionTitle} numberOfLines={2}>
                  {row.title}
                </Text>
              </View>
              <TouchableOpacity
                style={s.permissionBtn}
                onPress={row.onGrant}>
                <Text style={s.permissionBtnText}>
                  {t('permissionGrantBtn')}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const S = SIDEBAR_WIDTH; // shorthand for style

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      width: SIDEBAR_WIDTH,
      backgroundColor: c.card,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.border,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    appName: {
      fontSize: 20,
      fontWeight: '700',
      color: c.text,
      letterSpacing: 2,
    },
    tagline: {
      fontSize: 10,
      color: c.textMuted,
      marginTop: 6,
      lineHeight: 16,
    },
    menu: {
      paddingTop: 8,
      paddingHorizontal: 10,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 8,
      marginBottom: 2,
    },
    menuItemActive: {
      backgroundColor: c.accentLight,
    },
    menuIcon: {
      fontSize: 16,
      marginRight: 12,
      opacity: 0.5,
    },
    menuIconActive: {
      opacity: 1,
    },
    menuLabel: {
      fontSize: 14,
      color: c.textSecondary,
    },
    menuLabelActive: {
      color: c.accent,
      fontWeight: '600',
    },
    footer: {
      flex: 1,
    },
    permissions: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    permissionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    permissionTextWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 8,
    },
    permissionDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: '#E14B4B',
      marginRight: 8,
    },
    permissionTitle: {
      flex: 1,
      fontSize: 11,
      color: c.textSecondary,
      lineHeight: 14,
    },
    permissionBtn: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: c.accent,
    },
    permissionBtnText: {
      fontSize: 11,
      color: '#FFFFFF',
      fontWeight: '600',
    },
  });
}
