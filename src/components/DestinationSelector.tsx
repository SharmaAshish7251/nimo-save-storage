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
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { tdLibClient } from '@/lib/tdlib/client';
import { TelegramDestination } from '@/lib/tdlib/types';
import { getConfig, saveConfig, AppConfig } from '@/lib/storage/queue';

interface Props {
  targetCategory?: 'default' | 'photo' | 'video' | 'document';
  label?: string;
  onDestinationChanged?: (dest: TelegramDestination) => void;
}

export const DestinationSelector = React.memo(function DestinationSelector({
  targetCategory = 'default',
  label,
  onDestinationChanged,
}: Props) {
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
      const dialogs = await tdLibClient.getChats();
      setDestinations(dialogs);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const selectDestination = async (dest: TelegramDestination) => {
    try {
      const isSaved = dest.id === 'me';
      let patch: Partial<AppConfig> = {};
      if (targetCategory === 'photo') {
        patch = { photoChannelId: dest.id, photoChannelTitle: dest.title };
      } else if (targetCategory === 'video') {
        patch = { videoChannelId: dest.id, videoChannelTitle: dest.title };
      } else if (targetCategory === 'document') {
        patch = { documentChannelId: dest.id, documentChannelTitle: dest.title };
      } else {
        patch = {
          targetChatId: dest.id,
          targetChatTitle: dest.title,
          targetChatType: dest.type,
          uploadToSavedMessages: isSaved,
        };
      }
      const updated = await saveConfig(patch);
      setCurrentConfig(updated);
      setModalVisible(false);
      if (onDestinationChanged) {
        onDestinationChanged(dest);
      }
    } catch {
    }
  };

  const setManualDestination = async () => {
    const trimmed = customInput.trim();
    if (!trimmed) {
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

  const getDestinationIcon = (type?: string, size = 18) => {
    switch (type) {
      case 'saved':
        return <FontAwesome name="comment" size={size} color="#208AEF" />;
      case 'channel':
        return <FontAwesome name="bullhorn" size={size} color="#208AEF" />;
      case 'group':
        return <FontAwesome name="users" size={size} color="#208AEF" />;
      default:
        return <FontAwesome name="envelope-o" size={size} color="#208AEF" />;
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

  let displayTitle =
    currentConfig?.uploadToSavedMessages || currentConfig?.targetChatId === 'me'
      ? 'Saved Messages (Private Cloud)'
      : currentConfig?.targetChatTitle || currentConfig?.targetChatId || 'Saved Messages';

  let displayType =
    currentConfig?.uploadToSavedMessages || currentConfig?.targetChatId === 'me'
      ? 'saved'
      : currentConfig?.targetChatType || 'channel';

  if (targetCategory === 'photo') {
    displayTitle = currentConfig?.photoChannelTitle || 'Default (Same as Main Destination)';
    displayType = 'channel';
  } else if (targetCategory === 'video') {
    displayTitle = currentConfig?.videoChannelTitle || 'Default (Same as Main Destination)';
    displayType = 'channel';
  } else if (targetCategory === 'document') {
    displayTitle = currentConfig?.documentChannelTitle || 'Default (Same as Main Destination)';
    displayType = 'channel';
  }

  const captionText =
    label ||
    (targetCategory === 'default'
      ? 'Upload Destination'
      : `${targetCategory.charAt(0).toUpperCase() + targetCategory.slice(1)} Channel`);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.infoCol}>
          <Text style={styles.caption}>{captionText}</Text>
          <View style={styles.currentRow}>
            <View style={styles.iconContainer}>{getDestinationIcon(displayType, 18)}</View>
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
                <FontAwesome name="times" size={18} color="#6B7280" />
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
                      <View style={styles.dialogIconContainer}>
                        {getDestinationIcon(item.type, 18)}
                      </View>
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
                        <FontAwesome name="check" size={16} color="#208AEF" style={styles.checkmarkIcon} />
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
              <View style={styles.refreshBtnContent}>
                <FontAwesome name="refresh" size={14} color="#208AEF" style={{ marginRight: 8 }} />
                <Text style={styles.refreshButtonText}>Refresh Chats</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
});

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
  iconContainer: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dialogIconContainer: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkmarkIcon: {
    marginLeft: 6,
  },
  refreshBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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

