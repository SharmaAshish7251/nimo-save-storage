import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  FlatList,
  Share,
  TextInput,
  ScrollView,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useRef, useCallback } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';

// ─── Global log store + console override ────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'LOG' | 'WARN' | 'ERR';
type FilterKey = 'All' | Severity;

interface ParsedLog {
  raw: string;
  severity: Severity;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<Severity, { border: string; bg: string; label: string }> = {
  LOG:  { border: '#22C55E', bg: 'rgba(34,197,94,0.08)',  label: '#22C55E' },
  WARN: { border: '#F59E0B', bg: 'rgba(245,158,11,0.08)', label: '#F59E0B' },
  ERR:  { border: '#EF4444', bg: 'rgba(239,68,68,0.08)',  label: '#EF4444' },
};

function parseSeverity(raw: string): Severity {
  if (raw.startsWith('[ERR]'))  return 'ERR';
  if (raw.startsWith('[WARN]')) return 'WARN';
  return 'LOG';
}

function parseLog(raw: string): ParsedLog {
  return { raw, severity: parseSeverity(raw) };
}

const FILTER_KEYS: FilterKey[] = ['All', 'LOG', 'WARN', 'ERR'];

// ─── Components ──────────────────────────────────────────────────────────────

interface LogRowProps {
  item: ParsedLog;
  isDark: boolean;
}

function LogRow({ item, isDark }: LogRowProps) {
  const colors = SEVERITY_COLORS[item.severity];
  return (
    <View
      style={[
        styles.logRow,
        {
          borderLeftColor: colors.border,
          backgroundColor: colors.bg,
          borderBottomColor: isDark ? '#1A1A1A' : '#F1F5F9',
        },
      ]}
    >
      <Text
        style={[styles.logText, { color: isDark ? '#E2E8F0' : '#1E293B' }]}
        selectable
      >
        {item.raw}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LogsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const [logs, setLogs] = useState<string[]>(globalThis.__nimo_logs || []);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const flatListRef = useRef<FlatList<ParsedLog>>(null);

  // Poll for new logs every 500ms
  useEffect(() => {
    const interval = setInterval(() => {
      setLogs([...(globalThis.__nimo_logs || [])]);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Derive filtered + searched data
  const filteredLogs: ParsedLog[] = logs
    .map(parseLog)
    .filter(entry => {
      if (activeFilter !== 'All' && entry.severity !== activeFilter) return false;
      if (searchQuery.trim()) {
        return entry.raw.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && filteredLogs.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  }, [filteredLogs.length, autoScroll]);

  const handleScrollBeginDrag = useCallback(() => {
    setAutoScroll(false);
  }, []);

  const handleShare = async () => {
    try {
      const text = logs.join('\n');
      await Share.share({ message: text });
    } catch {}
  };

  const handleClear = () => {
    globalThis.__nimo_logs = [];
    setLogs([]);
  };

  const handleScrollToBottom = () => {
    setAutoScroll(true);
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  // Theme colours
  const bg       = isDark ? '#000'     : '#F8FAFC';
  const headerBg = isDark ? '#111'     : '#FFFFFF';
  const borderC  = isDark ? '#222'     : '#E2E8F0';
  const textC    = isDark ? '#E2E8F0'  : '#1E293B';
  const mutedC   = isDark ? '#64748B'  : '#94A3B8';
  const inputBg  = isDark ? '#1A1A1A'  : '#F1F5F9';

  const renderItem = useCallback(
    ({ item }: { item: ParsedLog }) => <LogRow item={item} isDark={isDark} />,
    [isDark],
  );

  const keyExtractor = useCallback((_: ParsedLog, i: number) => String(i), []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>

      {/* ── Toolbar row ── */}
      <View style={[styles.toolbar, { backgroundColor: headerBg, borderBottomColor: borderC }]}>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {FILTER_KEYS.map(key => {
            const isActive = activeFilter === key;
            const chipColor =
              key === 'LOG'  ? '#22C55E' :
              key === 'WARN' ? '#F59E0B' :
              key === 'ERR'  ? '#EF4444' :
              '#208AEF';
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setActiveFilter(key)}
                style={[
                  styles.chip,
                  isActive
                    ? { backgroundColor: chipColor, borderColor: chipColor }
                    : { backgroundColor: 'transparent', borderColor: chipColor },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: isActive ? '#fff' : chipColor },
                  ]}
                >
                  {key}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.iconBtn, { borderColor: borderC }]} onPress={handleShare}>
            <FontAwesome name="share" size={14} color="#208AEF" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { borderColor: borderC }]} onPress={handleClear}>
            <FontAwesome name="trash" size={14} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Search bar ── */}
      <View style={[styles.searchRow, { backgroundColor: headerBg, borderBottomColor: borderC }]}>
        <View style={[styles.searchBox, { backgroundColor: inputBg, borderColor: borderC }]}>
          <FontAwesome name="search" size={13} color={mutedC} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: textC }]}
            placeholder="Search logs…"
            placeholderTextColor={mutedC}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <FontAwesome name="times-circle" size={14} color={mutedC} />
            </TouchableOpacity>
          )}
        </View>

        {/* Count badge */}
        <View style={styles.countBadge}>
          <Text style={[styles.countText, { color: mutedC }]}>
            {filteredLogs.length}
          </Text>
        </View>
      </View>

      {/* ── Log list ── */}
      <FlatList
        ref={flatListRef}
        data={filteredLogs}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={filteredLogs.length === 0 ? styles.emptyContainer : undefined}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollToIndexFailed={() => {}}
        removeClippedSubviews
        maxToRenderPerBatch={30}
        windowSize={10}
        initialNumToRender={40}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="terminal" size={40} color={mutedC} />
            <Text style={[styles.emptyText, { color: mutedC }]}>No logs yet</Text>
          </View>
        }
      />

      {/* ── Scroll-to-bottom FAB (shown when auto-scroll is off) ── */}
      {!autoScroll && filteredLogs.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: headerBg, borderColor: borderC }]}
          onPress={handleScrollToBottom}
        >
          <FontAwesome name="arrow-down" size={14} color="#208AEF" />
        </TouchableOpacity>
      )}

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  /* Toolbar */
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipsScroll: {
    flex: 1,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 8,
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Search row */
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  searchIcon: {
    marginRight: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
    margin: 0,
  },
  countBadge: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
  },

  /* List */
  list: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },

  /* Log row */
  logRow: {
    borderLeftWidth: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },

  /* Empty state */
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 14,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
  },

  /* FAB */
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
