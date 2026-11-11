import { View, StyleSheet, Text, TouchableOpacity, FlatList, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';

declare global {
  var __nimo_logs: string[];
}

if (!globalThis.__nimo_logs) {
  globalThis.__nimo_logs = [];
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: any[]) => {
  try {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    globalThis.__nimo_logs.push(`[LOG] ${new Date().toLocaleTimeString()}: ${msg}`);
    if (globalThis.__nimo_logs.length > 2000) {
      globalThis.__nimo_logs.shift();
    }
  } catch {}
  originalLog.apply(console, args);
};

console.warn = (...args: any[]) => {
  try {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    globalThis.__nimo_logs.push(`[WARN] ${new Date().toLocaleTimeString()}: ${msg}`);
    if (globalThis.__nimo_logs.length > 2000) {
      globalThis.__nimo_logs.shift();
    }
  } catch {}
  originalWarn.apply(console, args);
};

console.error = (...args: any[]) => {
  try {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    globalThis.__nimo_logs.push(`[ERR] ${new Date().toLocaleTimeString()}: ${msg}`);
    if (globalThis.__nimo_logs.length > 2000) {
      globalThis.__nimo_logs.shift();
    }
  } catch {}
  originalError.apply(console, args);
};

export default function LogsScreen() {
  const [logs, setLogs] = useState<string[]>(globalThis.__nimo_logs || []);

  useEffect(() => {
    const interval = setInterval(() => {
      setLogs([...(globalThis.__nimo_logs || [])]);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const copyAll = async () => {
    try {
      const text = logs.join('\n');
      await Share.share({ message: text });
    } catch {
    }
  };

  const clearLogs = () => {
    globalThis.__nimo_logs = [];
    setLogs([]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.button} onPress={copyAll}>
          <FontAwesome name="copy" size={13} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.buttonText}>Copy All</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.clearButton]} onPress={clearLogs}>
          <FontAwesome name="trash" size={13} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.buttonText}>Clear</Text>
        </TouchableOpacity>
      </View>
      {/* Fix 3.6: Use FlatList for virtualized rendering — prevents 2000+ unvirtualized Text elements */}
      <FlatList
        data={logs}
        keyExtractor={(_, i) => String(i)}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <Text style={styles.logLine}>{item}</Text>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No logs yet</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: '#111',
  },
  button: {
    backgroundColor: '#208AEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  clearButton: {
    backgroundColor: '#dc2626',
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 12,
  },
  logLine: {
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 2,
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
});
