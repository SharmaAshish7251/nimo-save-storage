import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/context/ThemeContext';
import { getQueue, QueueItem } from '@/lib/storage/queue';

interface TabItem {
  id: string;
  name: string;
  route: '/' | '/upload' | '/explore' | '/settings';
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  showBadge?: boolean;
}

const TABS: TabItem[] = [
  { id: 'home', name: 'Home', route: '/', icon: 'dashboard' },
  { id: 'upload', name: 'Uploads', route: '/upload', icon: 'cloud-upload', showBadge: true },
  { id: 'explore', name: 'Explorer', route: '/explore', icon: 'folder-open' },
  { id: 'settings', name: 'Settings', route: '/settings', icon: 'cog' },
];

const PADDING_H = 10;

export function BottomNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { isDark } = useAppTheme();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [barWidth, setBarWidth] = useState<number>(() => Dimensions.get('window').width);

  // Check if current route is one of the main tab screens
  const isTabScreen = ['/', '/upload', '/explore', '/settings'].includes(pathname);

  const activeIndex = Math.max(
    0,
    TABS.findIndex((t) => t.route === pathname)
  );

  const [slideAnim] = useState(() => new Animated.Value(activeIndex));

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: activeIndex,
      useNativeDriver: true,
      tension: 65,
      friction: 8.5,
    }).start();
  }, [activeIndex, slideAnim]);

  useEffect(() => {
    let mounted = true;
    const fetchQueue = async () => {
      try {
        const q: QueueItem[] = await getQueue().catch(() => []);
        if (mounted) {
          const pending = q.filter((it) => it.status === 'pending' || it.status === 'uploading').length;
          setPendingCount(pending);
        }
      } catch {}
    };

    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [pathname]);

  if (!isTabScreen) {
    return null;
  }

  const handleTabPress = (route: '/' | '/upload' | '/explore' | '/settings') => {
    if (pathname === route) return;
    Haptics.selectionAsync().catch(() => {});
    router.replace(route);
  };

  const innerWidth = Math.max(1, barWidth - PADDING_H * 2);
  const tabWidth = innerWidth / TABS.length;
  const pillMargin = 4;
  const pillWidth = Math.max(1, tabWidth - pillMargin * 2);

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: [
      pillMargin,
      tabWidth + pillMargin,
      tabWidth * 2 + pillMargin,
      tabWidth * 3 + pillMargin,
    ],
  });

  return (
    <View
      style={[
        styles.navContainer,
        isDark ? styles.navContainerDark : styles.navContainerLight,
        { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 8) },
      ]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - barWidth) > 1) {
          setBarWidth(w);
        }
      }}
    >
      <View style={styles.tabBar}>
        {/* Floating Animated Active Pill Encompassing Icon & Label */}
        {tabWidth > 0 && (
          <Animated.View
            style={[
              styles.activePill,
              isDark ? styles.activePillDark : styles.activePillLight,
              {
                width: pillWidth,
                transform: [{ translateX }],
              },
            ]}
          />
        )}

        {TABS.map((tab, index) => {
          const isActive = activeIndex === index;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabButton}
              onPress={() => handleTabPress(tab.route)}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={styles.tabContent}>
                <View style={styles.iconWrap}>
                  <FontAwesome
                    name={tab.icon}
                    size={18}
                    color={isActive ? '#208AEF' : isDark ? '#94A3B8' : '#64748B'}
                  />
                  {tab.showBadge && pendingCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {pendingCount > 99 ? '99+' : pendingCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.tabLabel,
                    isDark ? styles.tabLabelDark : styles.tabLabelLight,
                    isActive && styles.tabLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  {tab.name}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navContainer: {
    borderTopWidth: 1,
    paddingTop: 6,
    paddingHorizontal: PADDING_H,
  },
  navContainerLight: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 8,
  },
  navContainerDark: {
    backgroundColor: '#0F172A',
    borderTopColor: '#1E293B',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  tabBar: {
    flexDirection: 'row',
    position: 'relative',
    alignItems: 'center',
  },
  activePill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: 18,
    zIndex: 0,
  },
  activePillDark: {
    backgroundColor: 'rgba(32, 138, 239, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(32, 138, 239, 0.38)',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  activePillLight: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    zIndex: 1,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 22,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
  },
  tabLabelLight: {
    color: '#64748B',
  },
  tabLabelDark: {
    color: '#94A3B8',
  },
  tabLabelActive: {
    color: '#208AEF',
    fontWeight: '700',
  },
});