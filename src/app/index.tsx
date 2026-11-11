import 'react-native-get-random-values';
import { formatFileSize, getConfig, getQueue, QueueItem } from '@/lib/storage/queue';
import { tdLibClient } from '@/lib/tdlib/client';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { FreeUpSpaceModal } from '@/components/FreeUpSpaceModal';

export default function HomeScreen() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);
  const [queueInfo, setQueueInfo] = useState<{ count: number; totalBytes: number }>({ count: 0, totalBytes: 0 });
  const [showFreeUpModal, setShowFreeUpModal] = useState(false);

  const checkStatus = async () => {
    try {
      const [loginStatus, appConfig, queueItems] = await Promise.all([
        tdLibClient.isLoggedIn().catch(() => false),
        getConfig(),
        getQueue().catch(() => []),
      ]);
      setLoggedIn(loginStatus);
      setConfig(appConfig);
      const totalBytes = (queueItems || []).reduce((acc: number, item: QueueItem) => acc + (item.size || 0), 0);
      setQueueInfo({ count: (queueItems || []).length, totalBytes });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Fix 3.2: Use useFocusEffect to refresh data whenever screen comes into focus
  useFocusEffect(useCallback(() => {
    checkStatus();
    const timer = setTimeout(checkStatus, 1200);
    const unsub = tdLibClient.onAuthStateChange((state) => {
      setLoggedIn(state === 'authorizationStateReady');
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []));

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Image
          style={styles.loadingLogo}
          source={require('@/assets/images/app-logo.png')}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color="#208AEF" style={{ marginTop: 24 }} />
        <Text style={styles.loadingTitle}>Nimo Save Storage</Text>
        <Text style={styles.loadingSubtitle}>Connecting to Telegram...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          style={styles.appBranding}
          source={require('@/assets/images/app-logo.png')}
          resizeMode="contain"
        />
        <Text style={styles.title}>Nimo Save Storage</Text>
        <Text style={styles.subtitle}>Auto-upload files to Telegram</Text>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <FontAwesome
              name={loggedIn ? 'check-circle' : 'times-circle'}
              size={15}
              color={loggedIn ? '#10B981' : '#EF4444'}
              style={styles.statusIcon}
            />
            <Text style={styles.statusText}>
              Telegram: <Text style={styles.statusBold}>{loggedIn ? 'Connected' : 'Not connected'}</Text>
            </Text>
          </View>

          <View style={styles.statusRow}>
            <FontAwesome
              name={config?.uploadToSavedMessages || config?.targetChatId === 'me' ? 'comment' : 'bullhorn'}
              size={15}
              color="#208AEF"
              style={styles.statusIcon}
            />
            <Text style={styles.statusText} numberOfLines={1}>
              Destination: <Text style={styles.statusBold}>
                {config?.uploadToSavedMessages || config?.targetChatId === 'me'
                  ? 'Saved Messages'
                  : config?.targetChatTitle || config?.targetChatId || 'Channel'}
              </Text>
            </Text>
          </View>

          <View style={styles.statusRow}>
            <FontAwesome
              name={config?.autoUploadEnabled ? 'check-circle' : 'minus-circle'}
              size={15}
              color={config?.autoUploadEnabled ? '#10B981' : '#9CA3AF'}
              style={styles.statusIcon}
            />
            <Text style={styles.statusText}>
              Auto-upload: <Text style={styles.statusBold}>{config?.autoUploadEnabled ? 'Enabled' : 'Disabled'}</Text>
            </Text>
          </View>

          <View style={styles.statusRow}>
            <FontAwesome name="clock-o" size={15} color="#F59E0B" style={styles.statusIcon} />
            <Text style={styles.statusText}>
              {config?.scheduleMode === 'window'
                ? `Time window: ${config?.timeWindowStart || '00:00'} - ${config?.timeWindowEnd || '06:00'}`
                : config?.scheduleMode === 'continuous'
                ? 'Schedule: Continuous (Active sync)'
                : `Schedule: Interval (${config?.intervalMinutes ?? 1}m)`}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <FontAwesome name="wifi" size={14} color="#6366F1" style={styles.statusIcon} />
            <Text style={styles.statusText}>
              WiFi only: <Text style={styles.statusBold}>{config?.wifiOnly ? 'Yes' : 'No'}</Text>
            </Text>
          </View>

          <View style={styles.statusRow}>
            <FontAwesome name="list-alt" size={14} color="#3B82F6" style={styles.statusIcon} />
            <Text style={styles.statusText}>
              Queue: <Text style={styles.statusBold}>{queueInfo.count} {queueInfo.count === 1 ? 'file' : 'files'} ({formatFileSize(queueInfo.totalBytes)})</Text>
            </Text>
          </View>
        </View>

        {!loggedIn && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push('/telegram-login')}
          >
            <FontAwesome name="paper-plane" size={16} color="#FFF" style={styles.buttonIcon} />
            <Text style={styles.buttonText}>Connect Telegram</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/settings')}
        >
          <FontAwesome name="cog" size={16} color="#FFF" style={styles.buttonIcon} />
          <Text style={styles.buttonText}>Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/upload')}
        >
          <FontAwesome name="cloud-upload" size={16} color="#FFF" style={styles.buttonIcon} />
          <Text style={styles.buttonText}>Upload Queue</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#10B981' }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setShowFreeUpModal(true);
          }}
        >
          <FontAwesome name="recycle" size={16} color="#FFF" style={styles.buttonIcon} />
          <Text style={styles.buttonText}>Free Up Device Space</Text>
        </TouchableOpacity>
      </View>

      <FreeUpSpaceModal
        visible={showFreeUpModal}
        onClose={() => setShowFreeUpModal(false)}
        onCleanComplete={() => {
          checkStatus();
        }}
      />
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
  appBranding: {
    width: "100%",
    height: 300,
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusIcon: {
    width: 22,
    textAlign: 'center',
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  statusBold: {
    fontWeight: '600',
    color: '#111827',
  },
  button: {
    backgroundColor: '#208AEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
    width: '100%',
  },
  buttonIcon: {
    marginRight: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingLogo: {
    width: 220,
    height: 220,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 16,
  },
  loadingSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 8,
  },
  text: {
    textAlign: 'center',
    marginTop: 50,
  },
});
