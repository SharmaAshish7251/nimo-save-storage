import { View, StyleSheet, Text, TouchableOpacity, Switch, TextInput, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { getConfig, saveConfig } from '@/lib/storage/queue';
import { requestMediaPermissions } from '@/lib/scanner/files';
import { registerBackgroundUploadTask, unregisterBackgroundUploadTask } from '@/tasks/backgroundUpload';
import { DestinationSelector } from '@/components/DestinationSelector';
import { disconnect } from '@/lib/telegram/client';
import * as SecureStoreLib from '@/lib/storage/secure';

export default function SettingsScreen() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = async () => {
    try {
      const appConfig = await getConfig();
      setConfig(appConfig);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const updateConfig = async (updates: any) => {
    try {
      const updated = await saveConfig(updates);
      setConfig(updated);
      
      if (updates.autoUploadEnabled !== undefined) {
        if (updates.autoUploadEnabled) {
          await registerBackgroundUploadTask();
        } else {
          await unregisterBackgroundUploadTask();
        }
      }
    } catch {
    }
  };

  const requestPermissions = async () => {
    await requestMediaPermissions();
  };

  if (loading || !config) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.text}>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Image
              source={require('@/assets/images/app-logo.png')}
              style={styles.headerLogo}
            />
            <View>
              <Text style={styles.title}>Settings</Text>
              <Text style={styles.subtitle}>Nimo Save Storage</Text>
            </View>
          </View>
          
          <DestinationSelector />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Permissions</Text>
            <TouchableOpacity style={styles.button} onPress={requestPermissions}>
              <Text style={styles.buttonText}>Grant Media Permissions</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Auto Upload</Text>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Enable Auto Upload</Text>
              <Switch
                value={config.autoUploadEnabled}
                onValueChange={(value) => updateConfig({ autoUploadEnabled: value })}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>WiFi Only</Text>
              <Switch
                value={config.wifiOnly}
                onValueChange={(value) => updateConfig({ wifiOnly: value })}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Upload to Saved Messages</Text>
              <Switch
                value={config.uploadToSavedMessages}
                onValueChange={(value) => updateConfig({ uploadToSavedMessages: value })}
              />
            </View>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Schedule (Nightly Window)</Text>
            <View style={styles.timeRow}>
              <Text style={styles.settingLabel}>Start Time</Text>
              <TextInput
                style={styles.timeInput}
                value={config.timeWindowStart}
                onChangeText={(value) => updateConfig({ timeWindowStart: value })}
                placeholder="00:00"
              />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.settingLabel}>End Time</Text>
              <TextInput
                style={styles.timeInput}
                value={config.timeWindowEnd}
                onChangeText={(value) => updateConfig({ timeWindowEnd: value })}
                placeholder="06:00"
              />
            </View>
            <Text style={styles.helpText}>Format: HH:mm (24-hour)</Text>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upload Settings</Text>
            <View style={styles.timeRow}>
              <Text style={styles.settingLabel}>Concurrency</Text>
              <TextInput
                style={styles.timeInput}
                value={config.concurrency.toString()}
                onChangeText={(value) => updateConfig({ concurrency: parseInt(value) || 3 })}
                keyboardType="numeric"
                placeholder="3"
              />
            </View>
            <Text style={styles.helpText}>Number of parallel uploads (like IDM)</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/logs')}
        >
          <Text style={styles.buttonText}>View Debug Logs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.dangerButton, { marginTop: 6 }]}
          onPress={async () => {
            try {
              await disconnect();
              await SecureStoreLib.clearSession();
              router.replace('/telegram-login');
            } catch {
            }
          }}
        >
          <Text style={styles.dangerButtonText}>Logout from Telegram</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLogo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
  },
  section: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingLabel: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  timeInput: {
    backgroundColor: '#f0f0f0',
    padding: 8,
    borderRadius: 6,
    width: 80,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#208AEF',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#fee',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f87171',
  },
  dangerButtonText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  helpText: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  text: {
    textAlign: 'center',
    marginTop: 50,
  },
});
