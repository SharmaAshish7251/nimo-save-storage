import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getTelegramDialogs, TelegramDestination } from '@/lib/telegram/client';
import { getConfig, saveConfig, AppConfig } from '@/lib/storage/queue';

interface Props {
  onDestinationChanged?: (dest: TelegramDestination) => void;
}

export function DestinationSelector({ onDestinationChanged }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [destinations, setDestinations] = useState<TelegramDestination[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [currentConfig, setCurrentConfig] = useState<AppConfig | null>(null);

  const loadCurrentConfig = async () => {
    const cfg = await getConfig();
    setCurrentConfig(cfg);
  };

  useEffect(() => {
    loadCurrentConfig();
  }, []);

  const openPicker = async () => {
    setModalVisible(true);
    if (destinations.length <= 1) {
      await fetchDialogs();
    }
  };

  const fetchDialogs = async () => {
    setLoading(true);
    try {
      const dialogs = await getTelegramDialogs();
      setDestinations(dialogs);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load Telegram chats');
    } finally {
      setLoading(false);
    }
  };

  const selectDestination = async (dest: TelegramDestination) => {
    try {
      const isSaved = dest.id === 'me';
      const updated = await saveConfig({
        targetChatId: dest.id,
        targetChatTitle: dest.title,
        targetChatType: dest.type,
        uploadToSavedMessages: isSaved,
      });
      setCurrentConfig(updated);
      setModalVisible(false);
      if (onDestinationChanged) {
        onDestinationChanged(dest);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save destination');
    }
  };

  const setManualDestination = async () => {
    const trimmed = customInput.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter a chat ID or @username');
      return;
    }
    const dest: TelegramDestination = {
      id: trimmed,
      title: trimmed.startsWith('@') ? trimmed : `Chat ${trimmed}`,
      type: 'channel',
      username: trimmed.startsWith('@') ? trimmed.substring(1) : undefined,
    };
    await selectDestination(dest);
    setCustomInput('');
  };

  const getDestinationIcon = (type?: string) => {
    switch (type) {
      case 'saved': return '💬';
      case 'channel': return '📢';
      case 'group': return '👥';
      default: return '✉️';
    }
  };

  const filtered = destinations.filter((d) => {
    const q = searchQuery.toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      (d.username && d.username.toLowerCase().includes(q)) ||
      d.id.toLowerCase().includes(q)
    );
  });

  const displayTitle =
    currentConfig?.uploadToSavedMessages || currentConfig?.targetChatId === 'me'
      ? 'Saved Messages (Private Cloud)'
      : currentConfig?.targetChatTitle || currentConfig?.targetChatId || 'Saved Messages';

  const displayType =
    currentConfig?.uploadToSavedMessages || currentConfig?.targetChatId === 'me'
      ? 'saved'
      : currentConfig?.targetChatType || 'channel';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.infoCol}>
          <Text style={styles.caption}>Upload Destination</Text>
          <View style={styles.currentRow}>
            <Text style={styles.icon}>{getDestinationIcon(displayType)}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {displayTitle}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.changeButton} onPress={openPicker}>
          <Text style={styles.changeButtonText}>Change</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Telegram Destination</Text>
              <TouchableOpacity
                style={styles.closeHeaderButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.closeHeaderText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <TextInput
              style={styles.searchInput}
              placeholder="Search chats, channels, groups..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            {/* Custom Input */}
            <View style={styles.customInputRow}>
              <TextInput
                style={styles.customTextInput}
                placeholder="Or enter @channel or Chat ID (-100...)"
                placeholderTextColor="#999"
                value={customInput}
                onChangeText={setCustomInput}
              />
              <TouchableOpacity
                style={styles.applyButton}
                onPress={setManualDestination}
              >
                <Text style={styles.applyButtonText}>Set</Text>
              </TouchableOpacity>
            </View>

            {/* List of dialogs */}
            {loading ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#208AEF" />
                <Text style={styles.loadingText}>Loading Telegram chats...</Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                style={styles.list}
                renderItem={({ item }) => {
                  const isSelected =
                    currentConfig?.targetChatId === item.id ||
                    (item.id === 'me' && currentConfig?.uploadToSavedMessages);
                  return (
                    <TouchableOpacity
                      style={[
                        styles.dialogItem,
                        isSelected && styles.dialogItemSelected,
                      ]}
                      onPress={() => selectDestination(item)}
                    >
                      <Text style={styles.dialogIcon}>
                        {getDestinationIcon(item.type)}
                      </Text>
                      <View style={styles.dialogTextContainer}>
                        <Text style={styles.dialogTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.dialogSub}>
                          {item.type.toUpperCase()}{' '}
                          {item.username ? `• @${item.username}` : ''}
                        </Text>
                      </View>
                      {isSelected && (
                        <Text style={styles.checkmarkText}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No destinations found</Text>
                }
              />
            )}

            <TouchableOpacity
              style={styles.refreshButton}
              onPress={fetchDialogs}
              disabled={loading}
            >
              <Text style={styles.refreshButtonText}>↻ Refresh Chats</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoCol: {
    flex: 1,
    marginRight: 10,
  },
  caption: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 3,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 18,
    marginRight: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#222',
    flex: 1,
  },
  changeButton: {
    backgroundColor: '#EBF4FE',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  changeButtonText: {
    color: '#208AEF',
    fontWeight: '600',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#222',
  },
  closeHeaderButton: {
    padding: 4,
  },
  closeHeaderText: {
    fontSize: 18,
    color: '#888',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  customInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  customTextInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  applyButton: {
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  list: {
    maxHeight: 340,
  },
  dialogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  dialogItemSelected: {
    backgroundColor: '#EBF4FE',
  },
  dialogIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  dialogTextContainer: {
    flex: 1,
  },
  dialogTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  dialogSub: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  checkmarkText: {
    color: '#208AEF',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 6,
  },
  centerContainer: {
    padding: 30,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: '#666',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 20,
    fontSize: 13,
  },
  refreshButton: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 8,
  },
  refreshButtonText: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '500',
  },
});

