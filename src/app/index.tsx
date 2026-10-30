import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { isLoggedIn } from '@/lib/telegram/client';
import { getConfig } from '@/lib/storage/queue';

export default function HomeScreen() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);

  const checkStatus = async () => {
    try {
      const [loginStatus, appConfig] = await Promise.all([
        isLoggedIn(),
        getConfig(),
      ]);
      setLoggedIn(loginStatus);
      setConfig(appConfig);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.text}>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Nimo Save Storage</Text>
        <Text style={styles.subtitle}>Auto-upload files to Telegram</Text>
        
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>
            Telegram: {loggedIn ? '✅ Connected' : '❌ Not connected'}
          </Text>
          <Text style={styles.statusText}>
            Auto-upload: {config?.autoUploadEnabled ? '✅ Enabled' : '❌ Disabled'}
          </Text>
          <Text style={styles.statusText}>
            Time window: {config?.timeWindowStart} - {config?.timeWindowEnd}
          </Text>
          <Text style={styles.statusText}>
            WiFi only: {config?.wifiOnly ? 'Yes' : 'No'}
          </Text>
        </View>
        
        {!loggedIn && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push('/telegram-login')}
          >
            <Text style={styles.buttonText}>Connect Telegram</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/settings')}
        >
          <Text style={styles.buttonText}>Settings</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/upload')}
        >
          <Text style={styles.buttonText}>Upload Queue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  statusCard: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    width: '100%',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusText: {
    fontSize: 14,
    marginBottom: 8,
    color: '#333',
  },
  button: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
    width: '100%',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  text: {
    textAlign: 'center',
    marginTop: 50,
  },
});
