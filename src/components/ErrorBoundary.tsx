import React from 'react';
import {View, Text, ScrollView, StyleSheet, TouchableOpacity} from 'react-native';

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
          <TouchableOpacity
            style={styles.reloadBtn}
            onPress={() => this.setState({hasError: false, error: null, info: ''})}>
            <Text style={styles.reloadText}>Dismiss</Text>
          </TouchableOpacity>
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
  reloadBtn: {
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  reloadText: {fontSize: 15, color: '#888'},
});
