import { View, Text, TouchableOpacity, StyleSheet, Image, ViewStyle } from 'react-native';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

export type NetworkOption = {
  /** Identifier from the API (e.g. "mtn", "airtel", "9mobile", or for
   *  data: "mtn_gifting_data", "mtn_data_share"). */
  id: string;
  /** Human-readable network name. */
  name: string;
  /**
   * Optional override for the logo filename. Defaults are derived from
   * `id` via {@link resolveBrand}, which strips suffixes such as
   * "_gifting_data" before mapping to the brand key.
   */
  logo?: any;
};

type NetworkPickerProps = {
  options: ReadonlyArray<NetworkOption>;
  value: string | null;
  onChange: (id: string) => void;
  /** Override default column count. */
  columns?: number;
  /** Disable interaction. */
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * Map of network identifiers → local require()d image asset.
 * The keys are lowercased to handle casing variations returned by the API.
 */
const NETWORK_LOGO_MAP: Record<string, any> = {
  mtn: require('@/assets/images/networks/mtn.jpg'),
  airtel: require('@/assets/images/networks/airtel.png'),
  glo: require('@/assets/images/networks/glo.png'),
  '9mobile': require('@/assets/images/networks/9mobile.png'),
  etisalat: require('@/assets/images/networks/9mobile.png'), // legacy name
};

/**
 * Fallback brand colors when no image is available. Keeps the chip
 * visually meaningful even if a new network appears that we don't
 * have art for yet.
 */
const NETWORK_FALLBACK_COLORS: Record<string, string> = {
  mtn: '#FFCC00',
  airtel: '#E60000',
  glo: '#0C8442',
  '9mobile': '#0066B3',
  etisalat: '#0066B3',
};

function resolveLogo(id: string) {
  return NETWORK_LOGO_MAP[resolveBrand(id)] ?? null;
}

function resolveFallbackColor(id: string) {
  return NETWORK_FALLBACK_COLORS[resolveBrand(id)] ?? '#6B7280';
}

/**
 * Strip variant suffixes from a network identifier so identifiers like
 * `mtn_gifting_data` and `mtn_data_share` both resolve to `mtn`.
 * Identifiers with no underscore (e.g. `mtn`, `airtel`) are returned
 * unchanged.
 */
export function resolveBrand(id: string): string {
  const lower = id.toLowerCase();
  if (NETWORK_LOGO_MAP[lower]) return lower;
  const head = lower.split('_')[0];
  return NETWORK_LOGO_MAP[head] ? head : lower;
}

/**
 * NetworkPicker — round logo + name chip grid for VTU screens. Replaces
 * the text-only SegmentedControl used previously so users see the actual
 * network brand on first glance.
 *
 * Falls back to a colored circle with the first letter when an image
 * isn't available for the given identifier.
 */
export function NetworkPicker({
  options,
  value,
  onChange,
  columns = 4,
  disabled = false,
  style,
}: NetworkPickerProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={[
        styles.grid,
        { columnGap: 10, rowGap: 12 },
        style,
      ]}
    >
      {options.map((opt) => {
        const isActive = opt.id === value;
        const logo = resolveLogo(opt.id);
        const fallbackColor = resolveFallbackColor(opt.id);
        const initial = opt.name.trim().charAt(0).toUpperCase() || '?';

        return (
          <TouchableOpacity
            key={opt.id}
            disabled={disabled}
            onPress={() => onChange(opt.id)}
            activeOpacity={0.7}
            style={[
              styles.chip,
              {
                width: `${Math.floor(100 / columns) - 2}%`,
                backgroundColor: isActive ? tokens.mintSoft : tokens.paper,
                borderColor: isActive ? tokens.mint : tokens.border,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.logoWrap,
                {
                  backgroundColor: logo ? '#fff' : fallbackColor,
                  borderColor: isActive ? tokens.mint : tokens.border,
                },
              ]}
            >
              {logo ? (
                <Image source={logo} style={styles.logo} resizeMode="contain" />
              ) : (
                <Text style={styles.fallbackInitial}>{initial}</Text>
              )}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.name,
                {
                  color: isActive ? tokens.ink : tokens.inkMuted,
                  fontWeight: isActive ? '700' : '600',
                },
              ]}
            >
              {opt.name}
            </Text>
            {isActive && (
              <View
                style={[styles.activeDot, { backgroundColor: tokens.mint }]}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    position: 'relative',
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: '85%',
    height: '85%',
  },
  fallbackInitial: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  name: {
    fontSize: 11,
    textAlign: 'center',
    maxWidth: '100%',
  },
  activeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
