import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";

type NetworkErrorProps = {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
};

export function NetworkError({
  title = "Something went wrong",
  message = "We couldn’t load this screen. Check your connection and try again.",
  retryLabel = "Retry",
  onRetry,
}: NetworkErrorProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={styles.root}>
      <Ionicons name="alert-circle-outline" size={48} color={tokens.error} />
      <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
      <Text style={[styles.message, { color: tokens.inkMuted }]}>
        {message}
      </Text>
      {onRetry ? (
        <TouchableOpacity
          style={[styles.retry, { borderColor: tokens.mint }]}
          onPress={onRetry}
        >
          <Text style={[styles.retryText, { color: tokens.mint }]}>
            {retryLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: "SpaceGrotesk_700Bold",
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "SpaceGrotesk_700Bold",
  },
});
