import React, { useState, useEffect, useMemo } from 'react';
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
  Platform,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/context/ThemeContext';
import { tdLibClient } from '@/lib/tdlib/client';
import { TelegramDestination } from '@/lib/tdlib/types';
import { getConfig, saveConfig, AppConfig } from '@/lib/storage/queue';

interface Props {
  targetCategory?: 'default' | 'photo' | 'video' | 'document';
  label?: string;
  onDestinationChanged?: (dest: TelegramDestination) => void;
}

type DestinationFilter = 'admin' | 'all';

export const DestinationSelector = React.memo(function DestinationSelector({
  targetCategory = 'default',
  label,
  onDestinationChanged,
}: Props) {
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();

  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolvingCustom, setResolvingCustom] = useState(false);
  const [destinations, setDestinations] = useState<TelegramDestination[]>([]);
  const [filterMode, setFilterMode] = useState<DestinationFilter>('admin');
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
    await loadCurrentConfig();
    await fetchDialogs();
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
    const isOwnerOrAdmin =
      dest.isCreator ||
      dest.isAdmin ||
      dest.memberRole === 'owner' ||
      dest.memberRole === 'admin';
    if ((dest.type === 'channel' || dest.type === 'group') && !isOwnerOrAdmin && dest.canPost === false) {
      Alert.alert(
        'Posting Restricted',
        `You are a member in "${dest.title}", but your account does not have admin or posting rights there. Please choose a channel or group where you are an admin or owner, or select Saved Messages.`
      );
      return;
    }

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

  const resetCategoryOverride = async () => {
    if (targetCategory === 'default') return;
    try {
      let patch: Partial<AppConfig> = {};
      if (targetCategory === 'photo') {
        patch = { photoChannelId: undefined, photoChannelTitle: undefined };
      } else if (targetCategory === 'video') {
        patch = { videoChannelId: undefined, videoChannelTitle: undefined };
      } else if (targetCategory === 'document') {
        patch = { documentChannelId: undefined, documentChannelTitle: undefined };
      }
      const updated = await saveConfig(patch);
      setCurrentConfig(updated);
      setModalVisible(false);
      if (onDestinationChanged) {
        onDestinationChanged({
          id: updated.targetChatId || 'me',
          title: updated.targetChatTitle || 'Saved Messages (Private Cloud)',
          type: updated.targetChatType || 'saved',
        });
      }
    } catch {}
  };

  const setManualDestination = async () => {
    const trimmed = customInput.trim();
    if (!trimmed || resolvingCustom) {
      return;
    }
    setResolvingCustom(true);
    try {
      const resolved = await tdLibClient.resolveDestinationInput(trimmed);
      await selectDestination(resolved);
      setCustomInput('');
    } catch (err: any) {
      Alert.alert(
        'Channel Not Found',
        err?.message || `Could not resolve "${trimmed}". Make sure the @username or numeric Chat ID is valid and accessible.`
      );
    } finally {
      setResolvingCustom(false);
    }
  };

  const getDestinationIcon = (type?: string, size = 18) => {
    switch (type) {
      case 'saved':
        return <FontAwesome name="bookmark" size={size} color="#208AEF" />;
      case 'channel':
        return <FontAwesome name="bullhorn" size={size} color="#208AEF" />;
      case 'group':
        return <FontAwesome name="users" size={size} color="#208AEF" />;
      default:
        return <FontAwesome name="envelope-o" size={size} color="#208AEF" />;
    }
  };

  const adminCount = useMemo(
    () =>
      destinations.filter(
        (d) =>
          d.id === 'me' ||
          ((d.type === 'channel' || d.type === 'group') && (d.isAdmin || d.isCreator))
      ).length,
    [destinations]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return destinations.filter((d) => {
      if (filterMode === 'admin') {
        const isEligibleAdminDest =
          d.id === 'me' ||
          ((d.type === 'channel' || d.type === 'group') && (d.isAdmin || d.isCreator));
        if (!isEligibleAdminDest) return false;
      }

      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        (d.username && d.username.toLowerCase().includes(q)) ||
        d.id.toLowerCase().includes(q)
      );
    });
  }, [destinations, filterMode, searchQuery]);

  const activeCategoryChatId = useMemo(() => {
    if (!currentConfig) return 'me';
    if (targetCategory === 'photo') return currentConfig.photoChannelId || '';
    if (targetCategory === 'video') return currentConfig.videoChannelId || '';
    if (targetCategory === 'document') return currentConfig.documentChannelId || '';
    if (currentConfig.uploadToSavedMessages || !currentConfig.targetChatId) return 'me';
    return currentConfig.targetChatId;
  }, [currentConfig, targetCategory]);

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

  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const modalBg = isDark ? '#1E293B' : '#FFFFFF';
  const inputBg = isDark ? '#0F172A' : '#F3F4F6';
  const textPrimary = isDark ? '#F8FAFC' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const borderColor = isDark ? '#334155' : '#E2E8F0';
  const selectedBg = isDark ? 'rgba(32, 138, 239, 0.16)' : '#EBF4FE';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor, borderWidth: isDark ? 1 : 0 }]}>
      <View style={styles.headerRow}>
        <View style={styles.infoCol}>
          <Text style={[styles.caption, { color: textSecondary }]}>{captionText}</Text>
          <View style={styles.currentRow}>
            <View style={styles.iconContainer}>{getDestinationIcon(displayType, 18)}</View>
            <Text style={[styles.title, { color: textPrimary }]} numberOfLines={1}>
              {displayTitle}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.changeButton, { backgroundColor: isDark ? 'rgba(32, 138, 239, 0.18)' : '#EBF4FE' }]}
          onPress={openPicker}
        >
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
          <View
            style={[
              styles.modalContainer,
              {
                backgroundColor: modalBg,
                paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 32 : 16) + 12,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: textPrimary }]}>Select Telegram Destination</Text>
                <Text style={[styles.modalSubTitle, { color: textSecondary }]}>
                  Showing channels & groups where you are owner or admin by default
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeHeaderButton}
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <FontAwesome name="times" size={18} color={textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Filter Pills */}
            <View style={[styles.filterBar, { backgroundColor: inputBg }]}>
              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filterMode === 'admin' && styles.filterPillActive,
                ]}
                onPress={() => setFilterMode('admin')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: filterMode === 'admin' ? '#FFFFFF' : textSecondary },
                  ]}
                >
                  Admin & Created ({adminCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filterMode === 'all' && styles.filterPillActive,
                ]}
                onPress={() => setFilterMode('all')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: filterMode === 'all' ? '#FFFFFF' : textSecondary },
                  ]}
                >
                  All Chats ({destinations.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <TextInput
              style={[styles.searchInput, { backgroundColor: inputBg, color: textPrimary }]}
              placeholder="Search chats, channels, groups..."
              placeholderTextColor={textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            {/* Custom Input */}
            <View style={styles.customInputRow}>
              <TextInput
                style={[styles.customTextInput, { backgroundColor: inputBg, color: textPrimary }]}
                placeholder="Or enter @channel or Chat ID (-100...)"
                placeholderTextColor={textSecondary}
                value={customInput}
                onChangeText={setCustomInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.applyButton, resolvingCustom && { opacity: 0.6 }]}
                onPress={setManualDestination}
                disabled={resolvingCustom}
              >
                {resolvingCustom ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.applyButtonText}>Set</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Category Override Reset Option */}
            {targetCategory !== 'default' && Boolean(activeCategoryChatId) && (
              <TouchableOpacity
                style={[styles.resetDefaultBtn, { borderColor }]}
                onPress={resetCategoryOverride}
              >
                <FontAwesome name="undo" size={12} color="#208AEF" style={{ marginRight: 6 }} />
                <Text style={styles.resetDefaultText}>Use Main Upload Destination (Default)</Text>
              </TouchableOpacity>
            )}

            {/* List of dialogs */}
            {loading && destinations.length <= 1 ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#208AEF" />
                <Text style={[styles.loadingText, { color: textSecondary }]}>
                  Loading Telegram channels & groups...
                </Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                style={styles.list}
                renderItem={({ item }) => {
                  const isSelected = activeCategoryChatId === item.id;
                  const isAdminBadge =
                    item.isCreator ||
                    item.isAdmin ||
                    item.memberRole === 'owner' ||
                    item.memberRole === 'admin';
                  const noPostRights =
                    (item.type === 'channel' || item.type === 'group') && !isAdminBadge && item.canPost === false;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.dialogItem,
                        isSelected && { backgroundColor: selectedBg },
                        noPostRights && { opacity: 0.6 },
                      ]}
                      onPress={() => selectDestination(item)}
                    >
                      <View style={styles.dialogIconContainer}>
                        {getDestinationIcon(item.type, 18)}
                      </View>
                      <View style={styles.dialogTextContainer}>
                        <View style={styles.dialogTitleRow}>
                          <Text style={[styles.dialogTitle, { color: textPrimary }]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          {item.id !== 'me' && isAdminBadge && (
                            <View
                              style={[
                                styles.roleBadge,
                                {
                                  backgroundColor: item.isCreator
                                    ? 'rgba(16, 185, 129, 0.14)'
                                    : 'rgba(32, 138, 239, 0.14)',
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.roleBadgeText,
                                  { color: item.isCreator ? '#10B981' : '#208AEF' },
                                ]}
                              >
                                {item.isCreator ? 'OWNER' : 'ADMIN'}
                              </Text>
                            </View>
                          )}
                          {noPostRights && (
                            <View
                              style={[
                                styles.roleBadge,
                                { backgroundColor: 'rgba(239, 68, 68, 0.14)' },
                              ]}
                            >
                              <Text style={[styles.roleBadgeText, { color: '#EF4444' }]}>
                                NO POST
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.dialogSub, { color: textSecondary }]}>
                          {item.type.toUpperCase()}
                          {item.username ? ` • @${item.username}` : ''}
                        </Text>
                      </View>
                      {isSelected && (
                        <FontAwesome name="check" size={16} color="#208AEF" style={styles.checkmarkIcon} />
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={[styles.emptyText, { color: textSecondary }]}>
                    {filterMode === 'admin'
                      ? 'No admin channels or groups found. Switch to "All Chats" or enter @channel / Chat ID above.'
                      : 'No destinations found'}
                  </Text>
                }
              />
            )}

            <TouchableOpacity
              style={[styles.refreshButton, loading && { opacity: 0.6 }]}
              onPress={fetchDialogs}
              disabled={loading}
            >
              <View style={styles.refreshBtnContent}>
                {loading ? (
                  <ActivityIndicator size="small" color="#208AEF" style={{ marginRight: 8 }} />
                ) : (
                  <FontAwesome name="refresh" size={14} color="#208AEF" style={{ marginRight: 8 }} />
                )}
                <Text style={styles.refreshButtonText}>
                  {loading ? 'Refreshing...' : 'Refresh Chats'}
                </Text>
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
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '84%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#222',
  },
  modalSubTitle: {
    fontSize: 11,
    marginTop: 2,
  },
  closeHeaderButton: {
    padding: 4,
  },
  filterBar: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 4,
    marginBottom: 10,
  },
  filterPill: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: '#208AEF',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
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
    paddingVertical: 9,
    fontSize: 13,
  },
  applyButton: {
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 54,
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  resetDefaultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  resetDefaultText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#208AEF',
  },
  list: {
    maxHeight: 320,
  },
  dialogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
  },
  dialogTextContainer: {
    flex: 1,
  },
  dialogTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dialogTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  dialogSub: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
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
    paddingHorizontal: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  refreshButton: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 10,
  },
  refreshButtonText: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '600',
  },
});

