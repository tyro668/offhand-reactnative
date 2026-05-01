import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

interface TooltipProps {
  visible: boolean;
  /** X position the arrow points to (relative to the positioned parent) */
  anchorX: number;
  /** Width of the anchor element; arrow centers on anchorX + anchorWidth / 2 */
  anchorWidth?: number;
  /** Max width before wrapping; defaults to 260 */
  maxWidth?: number;
  /** Distance from the top of the positioned parent; defaults to 42 */
  top?: number;
  /** Tooltip text content */
  text?: string;
  /** Or provide custom children */
  children?: React.ReactNode;
}

const ARROW_SIZE = 6;
const ARROW_OFFSET = 22;

export default function Tooltip({
  visible,
  anchorX,
  anchorWidth = 0,
  maxWidth = 260,
  top = 42,
  text,
  children,
}: TooltipProps) {
  const {colors} = useTheme();
  const s = makeStyles(colors);

  if (!visible) {
    return null;
  }

  const iconCenterX = anchorX + anchorWidth / 2;
  const tooltipLeft = Math.max(8, iconCenterX - ARROW_OFFSET);

  return (
    <View
      style={[
        s.tooltip,
        {
          left: tooltipLeft,
          maxWidth,
          top,
        },
      ]}>
      <View
        style={[
          s.arrow,
          {
            left: iconCenterX - tooltipLeft - ARROW_SIZE,
          },
        ]}
      />
      {children || (text ? <Text style={s.text}>{text}</Text> : null)}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    tooltip: {
      position: 'absolute',
      zIndex: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.card,
      borderRadius: 8,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    arrow: {
      position: 'absolute',
      top: -ARROW_SIZE,
      width: 0,
      height: 0,
      borderLeftWidth: ARROW_SIZE,
      borderLeftColor: 'transparent',
      borderRightWidth: ARROW_SIZE,
      borderRightColor: 'transparent',
      borderBottomWidth: ARROW_SIZE,
      borderBottomColor: c.card,
    },
    text: {
      fontSize: 12,
      lineHeight: 17,
      color: c.textSecondary,
    },
  });
}
