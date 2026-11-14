import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
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

export function BottomNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { isDark } = useAppTheme();
  const [pendingCount, setPendingCount] = useState<number>(0);

  // Check if current route is one of the main tab screens
  const isTabScreen = ['/', '/upload', '/explore', '/settings'].includes(pathname);

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

  return (
    <View
      style={[
        styles.navContainer,
        isDark ? styles.navContainerDark : styles.navContainerLight,
        { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 8) },
      ]}
    >
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = pathname === tab.route;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabButton}
              onPress={() => handleTabPress(tab.route)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <View style={[styles.iconWrap, isActive && (isDark ? styles.iconWrapActiveDark : styles.iconWrapActiveLight)]}>
                <FontAwesome
                  name={tab.icon}
                  size={19}
                  color={isActive ? '#208AEF' : isDark ? '#64748B' : '#94A3B8'}
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
              >
                {tab.name}
              </Text>
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
    paddingTop: 8,
    paddingHorizontal: 8,
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
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconWrap: {
    position: 'relative',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActiveLight: {
    backgroundColor: '#EFF6FF',
  },
  iconWrapActiveDark: {
    backgroundColor: 'rgba(32, 138, 239, 0.15)',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: 2,
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
    fontWeight: '600',
    marginTop: 2,
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
