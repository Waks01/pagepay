import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PagePay } from '@/constants/theme';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <View style={[styles.iconContainer, { backgroundColor: PagePay.light.signalSoft }]}>
              <Ionicons name="warning-outline" size={48} color={PagePay.light.signal} />
            </View>
            <Text style={[styles.title, { color: PagePay.light.ink }]}>
              Something went wrong
            </Text>
            <Text style={[styles.message, { color: PagePay.light.inkMuted }]}>
              We encountered an unexpected error. Please try again.
            </Text>
            {__DEV__ && this.state.error && (
              <View style={[styles.errorDetails, { backgroundColor: PagePay.light.paper, borderColor: PagePay.light.border }]}>
                <Text style={[styles.errorText, { color: PagePay.light.inkMuted }]}>
                  {this.state.error.toString()}
                </Text>
              </View>
            )}
            <Pressable
              onPress={this.handleReset}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: PagePay.light.mint, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="refresh-outline" size={18} color={PagePay.light.mintText} />
              <Text style={[styles.retryText, { color: PagePay.light.mintText }]}>
                Try again
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PagePay.light.paper,
    padding: 20,
  },
  content: {
    alignItems: 'center',
    maxWidth: 400,
    gap: 16,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  errorDetails: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    width: '100%',
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
});
