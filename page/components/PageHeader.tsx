import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PagePay } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  backgroundColor?: string;
  borderBottomColor?: string;
  marginTop?: number;
  tokens: (typeof PagePay)['light'];
};

export function PageHeader({
  title,
  subtitle,
  left,
  right,
  showBack = false,
  onBack,
  backgroundColor,
  borderBottomColor,
  marginTop = 0,
  tokens,
}: Props) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const renderLeft = () => {
    if (left) return left;
    if (showBack) {
      return (
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={8}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={tokens.ink} />
        </TouchableOpacity>
      );
    }
    return <View style={styles.leftSpacer} />;
  };

  const renderCenter = () => {
    if (!title) return <View style={{ flex: 1 }} />;
    return (
      <View style={styles.titleArea}>
        <Text
          style={[
            styles.title,
            { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, { color: tokens.inkMuted }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderRight = () => {
    if (right) return right;
    return <View style={{ width: 24 }} />;
  };

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: backgroundColor || tokens.card,
          borderBottomColor: borderBottomColor || tokens.border,
          marginTop,
        },
      ]}
    >
      <View style={styles.row}>
        {renderLeft()}
        {renderCenter()}
        {renderRight()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  leftSpacer: {
    width: 36,
  },
  titleArea: {
    flex: 1,
    marginHorizontal: 12,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
});
