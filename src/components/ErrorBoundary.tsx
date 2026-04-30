import React from 'react';
import {View, Text, ScrollView, StyleSheet, Share} from 'react-native';
import TouchableOpacity from './TouchableOpacityCompat';

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

export default class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  State
> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false, error: null, info: ''};
  }

  static getDerivedStateFromError(error: Error): State {
    return {hasError: true, error, info: ''};
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({error, info: errorInfo.componentStack || ''});
  }

  handleCopy = () => {
    const errMsg = this.state.error?.message || '';
    const errStack = this.state.error?.stack || '';
    const info = this.state.info || '';
    const fullText = `Error: ${errMsg}\n\nComponent Stack:\n${info}\n\nCall Stack:\n${errStack}`;
    Share.share({message: fullText});
  };

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message || 'Unknown error';
      const errStack = this.state.error?.stack || '';
      return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.title}>ERROR</Text>
          <Text style={styles.message} selectable>{errMsg}</Text>
          <Text style={styles.stackTitle}>Component Stack:</Text>
          <Text style={styles.stack} selectable>{this.state.info}</Text>
          <Text style={styles.stackTitle}>Call Stack:</Text>
          <Text style={styles.stack} selectable>{errStack}</Text>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.copyBtn} onPress={this.handleCopy}>
              <Text style={styles.copyText}>Copy Error</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={() => this.setState({hasError: false, error: null, info: ''})}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff0f0'},
  content: {padding: 20, paddingTop: 60},
  title: {fontSize: 24, fontWeight: 'bold', color: '#d32f2f', marginBottom: 16},
  message: {
    fontSize: 16,
    color: '#c62828',
    lineHeight: 24,
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#fce4ec',
    borderRadius: 8,
  },
  stackTitle: {fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 8, marginTop: 16},
  stack: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    fontFamily: 'monospace',
    padding: 12,
    backgroundColor: '#fafafa',
    borderRadius: 8,
  },
  btnRow: {
    flexDirection: 'row',
    marginTop: 32,
  },
  copyBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#d32f2f',
    alignItems: 'center',
    marginRight: 8,
  },
  copyText: {fontSize: 15, color: '#fff', fontWeight: '600'},
  dismissBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  dismissText: {fontSize: 15, color: '#888'},
});
