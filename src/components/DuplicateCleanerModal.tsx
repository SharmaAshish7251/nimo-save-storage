import {
  View,
  StyleSheet,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { formatFileSize } from '@/lib/storage/queue';
import { useAppTheme } from '@/context/ThemeContext';
import type { DuplicateGroup, ScanDuplicatesProgress } from '@/lib/storage/duplicates';

interface DuplicateCleanerModalProps {
  visible: boolean;
  groups: DuplicateGroup[];
  isScanning: boolean;
  scanProgress: ScanDuplicatesProgress | null;
  isCleaning: boolean;
  onClose: () => void;
  onClean: (strategy: 'oldest' | 'newest') => Promise<void>;
}

export function DuplicateCleanerModal({
  visible,
  groups,
  isScanning,
  scanProgress,
  isCleaning,
  onClose,
  onClean,
}: DuplicateCleanerModalProps) {
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();

  const totalDuplicates = groups.reduce((acc, g) => acc + (g.files.length - 1), 0);
  const totalWastedBytes = groups.reduce((acc, g) => acc + g.size * (g.files.length - 1), 0);

  const bg = isDark ? '#0F172A' : '#F8FAFC';
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const subtextColor = isDark ? '#94A3B8' : '#64748B';
  const border = isDark ? '#334155' : '#E2E8F0';

  const handleClean = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await onClean('oldest');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={styles.headerTitleRow}>
            <View style={styles.headerIconWrap}>
              <FontAwesome name="clone" size={16} color="#208AEF" />
            </View>
            <View>
              <Text style={[styles.title, { color: textColor }]}>Duplicate Cleaner</Text>
              <Text style={[styles.subtitle, { color: subtextColor }]}>
                Find & remove exact local copies safely
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
            onPress={onClose}
            disabled={isCleaning}
          >
            <FontAwesome name="times" size={14} color={textColor} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        {isScanning ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#208AEF" />
            <Text style={[styles.loadingTitle, { color: textColor }]}>Scanning for Duplicates...</Text>
            {scanProgress && (
              <Text style={[styles.loadingSub, { color: subtextColor }]}>
                Scanned {scanProgress.scanned} / {scanProgress.total} files • Found {scanProgress.duplicatesFound}
              </Text>
            )}
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={[styles.emptyIconWrap, { backgroundColor: '#ECFDF5' }]}>
              <FontAwesome name="check-circle" size={42} color="#10B981" />
            </View>
            <Text style={[styles.emptyTitle, { color: textColor }]}>No Duplicates Found</Text>
            <Text style={[styles.emptySub, { color: subtextColor }]}>
              Your storage is clean and optimized. Every file has a unique checksum.
            </Text>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mainContent}>
            {/* Summary Banner */}
            <View style={[styles.summaryBanner, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
              <FontAwesome name="info-circle" size={16} color="#D97706" style={{ marginTop: 2 }} />
              <View style={styles.summaryTextCol}>
                <Text style={styles.summaryTitle}>
                  {totalDuplicates} duplicate {totalDuplicates === 1 ? 'file' : 'files'} detected
                </Text>
                <Text style={styles.summarySub}>
                  You can free up ~{formatFileSize(totalWastedBytes)} by removing duplicate copies. The original file will always be preserved.
                </Text>
              </View>
            </View>

            {/* List of Duplicate Groups */}
            <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent}>
              {groups.map((group) => {
                const primaryFile = group.files[0];
                return (
                  <View
                    key={group.id}
                    style={[styles.groupCard, { backgroundColor: cardBg, borderColor: border }]}
                  >
                    <View style={styles.groupCardHeader}>
                      <View style={styles.fileIconBox}>
                        <FontAwesome name="file" size={16} color="#208AEF" />
                      </View>
                      <View style={styles.groupCardInfo}>
                        <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
                          {primaryFile.name}
                        </Text>
                        <Text style={[styles.fileMeta, { color: subtextColor }]}>
                          {formatFileSize(group.size)} each • {group.files.length} identical copies
                        </Text>
                      </View>
                    </View>

                    <View style={styles.actionTagsRow}>
                      <View style={styles.preserveTag}>
                        <FontAwesome name="shield" size={10} color="#059669" />
                        <Text style={styles.preserveTagText}>
                          Keep: {primaryFile.name}
                        </Text>
                      </View>
                      <View style={styles.deleteTag}>
                        <FontAwesome name="trash-o" size={10} color="#DC2626" />
                        <Text style={styles.deleteTagText}>
                          Remove {group.files.length - 1} {group.files.length - 1 === 1 ? 'copy' : 'copies'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* Footer Action Bar */}
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: cardBg,
                  borderTopColor: border,
                  paddingBottom: Math.max(insets.bottom, 16) + 8,
                },
              ]}
            >
              <TouchableOpacity
                style={[styles.cleanBtn, isCleaning && styles.cleanBtnDisabled]}
                onPress={handleClean}
                disabled={isCleaning}
              >
                {isCleaning ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <FontAwesome name="trash" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.cleanBtnText} numberOfLines={1}>
                      Clean Duplicates (Free {formatFileSize(totalWastedBytes)})
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 12 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: { fontSize: 16, fontWeight: '600', marginTop: 14 },
  loadingSub: { fontSize: 13, marginTop: 4 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  doneBtn: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  doneBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
  mainContent: { flex: 1 },
  summaryBanner: {
    flexDirection: 'row',
    margin: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  summaryTextCol: { flex: 1 },
  summaryTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  summarySub: { fontSize: 12, color: '#B45309', marginTop: 2, lineHeight: 16 },
  scrollList: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },
  groupCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  groupCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCardInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 12, marginTop: 2 },
  actionTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
  },
  preserveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  preserveTagText: { fontSize: 11, color: '#059669', fontWeight: '600' },
  deleteTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  deleteTagText: { fontSize: 11, color: '#DC2626', fontWeight: '600' },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cleanBtn: {
    backgroundColor: '#EF4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
  },
  cleanBtnDisabled: { opacity: 0.6 },
  cleanBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});

