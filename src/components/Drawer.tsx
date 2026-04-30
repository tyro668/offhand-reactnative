import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import TouchableOpacity from './TouchableOpacityCompat';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {useI18n} from '../i18n/I18nContext';

const DRAWER_WIDTH = 260;
const {width: SCREEN_WIDTH} = Dimensions.get('window');

interface MenuItem {
  key: string;
  label: string;
  icon: string;
}

interface Props {
  visible: boolean;
  activeScreen: string;
  menuItems: MenuItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

export default function Drawer({
  visible,
  activeScreen,
  menuItems,
  onSelect,
  onClose,
}: Props) {
  const {colors} = useTheme();
  const {t} = useI18n();
  const styles = makeStyles(colors);
  const [translateX] = React.useState(() => new Animated.Value(-DRAWER_WIDTH));
  const [overlayOpacity] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: 250,
          useNativeDriver: false,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: false,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [visible, translateX, overlayOpacity]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.overlay, {opacity: overlayOpacity}]}>
        <TouchableOpacity
          style={styles.overlayTouch}
          activeOpacity={1}
          onPress={onClose}
        />
      </Animated.View>

      <Animated.View
        style={[styles.drawer, {transform: [{translateX}]}]}>
        <View style={styles.header}>
          <Text style={styles.appName}>{t('appName')}</Text>
          <Text style={styles.tagline}>{t('appTagline')}</Text>
        </View>

        <View style={styles.menuList}>
          {menuItems.map(item => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.menuItem,
                activeScreen === item.key && styles.menuItemActive,
              ]}
              onPress={() => onSelect(item.key)}>
              <Text style={styles.menuIcon}>{item.icon}</Text>
              <Text
                style={[
                  styles.menuLabel,
                  activeScreen === item.key && styles.menuLabelActive,
                ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      position: 'absolute',
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      zIndex: 100,
      flexDirection: 'row',
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      backgroundColor: c.overlay,
    },
    overlayTouch: {
      flex: 1,
    },
    drawer: {
      width: DRAWER_WIDTH,
      height: '100%',
      backgroundColor: c.card,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.border,
      paddingTop: 60,
    },
    header: {
      paddingHorizontal: 24,
      paddingBottom: 28,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    appName: {
      fontSize: 24,
      fontWeight: '600',
      color: c.text,
      letterSpacing: 4,
    },
    tagline: {
      fontSize: 11,
      color: c.textMuted,
      marginTop: 8,
      lineHeight: 18,
    },
    menuList: {
      paddingTop: 12,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 14,
      marginHorizontal: 8,
      marginVertical: 2,
      borderRadius: 8,
    },
    menuItemActive: {
      backgroundColor: c.accentLight,
    },
    menuIcon: {
      fontSize: 18,
      marginRight: 14,
    },
    menuLabel: {
      fontSize: 15,
      color: c.textSecondary,
    },
    menuLabelActive: {
      color: c.accent,
      fontWeight: '500',
    },
  });
}
