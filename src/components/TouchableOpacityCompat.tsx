import React from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = Omit<PressableProps, 'style'> & {
  activeOpacity?: number;
  style?: StyleProp<ViewStyle>;
};

export default function TouchableOpacityCompat({
  activeOpacity = 0.7,
  disabled,
  style,
  ...props
}: Props) {
  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={({pressed}) => [
        style,
        pressed && !disabled ? {opacity: activeOpacity} : null,
        disabled ? {opacity: 0.5} : null,
      ]}
    />
  );
}
