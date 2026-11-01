import { memo } from 'react';
import { Image, ImageSourcePropType, StyleSheet, View, Text } from 'react-native';

type NetworkIconProps = {
  name: string;
  size?: number;
};

const iconMap: Record<string, ImageSourcePropType> = {
  mtn: require('@/assets/images/networks/mtn.jpg'),
  airtel: require('@/assets/images/networks/airtel.png'),
  glo: require('@/assets/images/networks/glo.png'),
  '9mobile': require('@/assets/images/networks/9mobile.png'),
};

const NetworkIcon = memo(({ name, size = 40 }: NetworkIconProps) => {
  const key = name.toLowerCase();
  const source = iconMap[key];

  if (!source) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.25 }]}>
        <View style={styles.fallbackInner}>
          <View style={[styles.fallbackLetter, { width: size * 0.5, height: size * 0.5, borderRadius: size * 0.15 }]}>
            <Text style={[styles.fallbackText, { fontSize: size * 0.38 }]}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={{ width: size, height: size, borderRadius: size * 0.2 }}
      resizeMode="contain"
    />
  );
});

NetworkIcon.displayName = 'NetworkIcon';

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#E5E5E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLetter: {
    backgroundColor: '#999999',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
  },
});

export default NetworkIcon;
