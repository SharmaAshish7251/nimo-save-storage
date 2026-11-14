import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { useAppTheme } from '@/context/ThemeContext';
import { getQueue, QueueItem } from '@/lib/storage/queue';

interface NavTab {
  id: string;
  name: string;
  route: '/' | '/explore' | '/logs' | '/settings';
  icon: React.ComponentProps<typeof FontAwesome>['name'];
}

const LEFT_TABS: NavTab[] = [
  { id: 'home', name: 'Home', route: '/', icon: 'home' },
  { id: 'explore', name: 'Explorer', route: '/explore', icon: 'folder-open' },
];

const RIGHT_TABS: NavTab[] = [
  { id: 'logs', name: 'Logs', route: '/logs', icon: 'file-text-o' },
  { id: 'settings', name: 'Settings', route: '/settings', icon: 'cog' },
];

const DOCK_HEIGHT = 64;
const TOP_OFFSET = 24; // Height of the center curved bulge
const CORNER_RADIUS = 26;
const MARGIN_H = 14;

/**
 * Builds the C1-continuous SVG path with a smooth rounded dock and organic upward curved bulge.
 */
function buildCurvedDockPath(w: number, h: number, topOffset: number, r: number): string {
  const cx = w / 2;
  const spread = 46; // Half-width of the curve transition
  const peakY = 2;   // Highest point of the mound
  const baseY = topOffset; // Horizontal top edge

  return `
    M 0 ${baseY + r}
    A ${r} ${r} 0 0 1 ${r} ${baseY}
    L ${cx - spread} ${baseY}
    C ${cx - 28} ${baseY}, ${cx - 24} ${peakY}, ${cx} ${peakY}
    C ${cx + 24} ${peakY}, ${cx + 28} ${baseY}, ${cx + spread} ${baseY}
    L ${w - r} ${baseY}
    A ${r} ${r} 0 0 1 ${w} ${baseY + r}
    L ${w} ${baseY + h - r}
    A ${r} ${r} 0 0 1 ${w - r} ${baseY + h}
    L ${r} ${baseY + h}
    A ${r} ${r} 0 0 1 0 ${baseY + h - r}
    Z
  `;
}

export function BottomNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { isDark } = useAppTheme();

  const [pendingCount, setPendingCount] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(() => Dimensions.get('window').width);

  const isTabScreen = ['/', '/upload', '/explore', '/settings', '/logs'].includes(pathname);
  const isUploadActive = pathname === '/upload';

  // Smooth pulse/scale animation for center FAB
  const [fabScale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    Animated.spring(fabScale, {
      toValue: isUploadActive ? 1.08 : 1.0,
      useNativeDriver: true,
      tension: 60,
      friction: 7,
    }).start();
  }, [isUploadActive, fabScale]);

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

  const handleTabPress = (route: '/' | '/upload' | '/explore' | '/settings' | '/logs') => {
    if (pathname === route) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.replace(route);
  };

  const dockWidth = Math.max(280, containerWidth - MARGIN_H * 2);
  const totalSvgHeight = DOCK_HEIGHT + TOP_OFFSET;
  const pathD = buildCurvedDockPath(dockWidth, DOCK_HEIGHT, TOP_OFFSET, CORNER_RADIUS);

  const dockBg = isDark ? '#141E2E' : '#FFFFFF';
  const dockStroke = isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0';

  return (
    <View
      style={[
        styles.outerWrapper,
        { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 8) },
      ]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - containerWidth) > 1) {
          setContainerWidth(w);
        }
      }}
      pointerEvents="box-none"
    >
      <View style={[styles.dockContainer, { width: dockWidth, height: totalSvgHeight }]}>
        {/* Curved SVG Dock Background */}
        <Svg
          width={dockWidth}
          height={totalSvgHeight}
          viewBox={`0 0 ${dockWidth} ${totalSvgHeight}`}
          style={StyleSheet.absoluteFill}
        >
          <Path
            d={pathD}
            fill={dockBg}
            stroke={dockStroke}
            strokeWidth={1}
          />
        </Svg>

        {/* Center Floating Elevated Action Button (+) */}
        <View style={[styles.fabCenterWrap, { left: dockWidth / 2 - 27 }]}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => handleTabPress('/upload')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Animated.View
              style={[
                styles.fabCircle,
                isUploadActive
                  ? styles.fabCircleActive
                  : isDark
                  ? styles.fabCircleDark
                  : styles.fabCircleLight,
                { transform: [{ scale: fabScale }] },
              ]}
            >
              <FontAwesome
                name="plus"
                size={22}
                color="#FFFFFF"
              />
              {pendingCount > 0 && (
                <View style={styles.fabBadge}>
                  <Text style={styles.fabBadgeText}>
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>

        {/* Tab Items Row: Left 2 Tabs | Center Gap | Right 2 Tabs */}
        <View style={[styles.tabItemsRow, { top: TOP_OFFSET, height: DOCK_HEIGHT }]}>
          {/* Left Wing Tabs */}
          <View style={styles.tabWing}>
            {LEFT_TABS.map((tab) => {
              const isActive = pathname === tab.route;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={styles.tabTouch}
                  onPress={() => handleTabPress(tab.route)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.tabContent, isActive && (isDark ? styles.tabContentActiveDark : styles.tabContentActiveLight)]}>
                    <FontAwesome
                      name={tab.icon}
                      size={18}
                      color={isActive ? (isDark ? '#38BDF8' : '#0F172A') : isDark ? '#94A3B8' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        isDark ? styles.tabLabelDark : styles.tabLabelLight,
                        isActive && (isDark ? styles.tabLabelActiveDark : styles.tabLabelActiveLight),
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

          {/* Center Gap for the FAB */}
          <View style={styles.centerFabGap} pointerEvents="none" />

          {/* Right Wing Tabs */}
          <View style={styles.tabWing}>
            {RIGHT_TABS.map((tab) => {
              const isActive = pathname === tab.route;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={styles.tabTouch}
                  onPress={() => handleTabPress(tab.route)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.tabContent, isActive && (isDark ? styles.tabContentActiveDark : styles.tabContentActiveLight)]}>
                    <FontAwesome
                      name={tab.icon}
                      size={18}
                      color={isActive ? (isDark ? '#38BDF8' : '#0F172A') : isDark ? '#94A3B8' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        isDark ? styles.tabLabelDark : styles.tabLabelLight,
                        isActive && (isDark ? styles.tabLabelActiveDark : styles.tabLabelActiveLight),
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  dockContainer: {
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  fabCenterWrap: {
    position: 'absolute',
    top: 0,
    width: 54,
    height: 54,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  fabCircleDark: {
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  fabCircleLight: {
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  fabCircleActive: {
    backgroundColor: '#208AEF',
    borderWidth: 2,
    borderColor: '#93C5FD',
    shadowColor: '#208AEF',
    shadowOpacity: 0.5,
  },
  fabBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
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
  fabBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  tabItemsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  tabWing: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  centerFabGap: {
    width: 64, // Matches the center curved FAB cutout
  },
  tabTouch: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  tabContentActiveDark: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  tabContentActiveLight: {
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  tabLabelLight: {
    color: '#64748B',
  },
  tabLabelDark: {
    color: '#94A3B8',
  },
  tabLabelActiveDark: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  tabLabelActiveLight: {
    color: '#0F172A',
    fontWeight: '700',
  },
});
