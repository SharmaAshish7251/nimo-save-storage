import React, { useEffect, useState, useMemo } from 'react';
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
  route: '/' | '/explore' | '/upload' | '/logs' | '/settings';
  icon: React.ComponentProps<typeof FontAwesome>['name'];
}

const TABS: NavTab[] = [
  { id: 'home', name: 'Home', route: '/', icon: 'home' },
  { id: 'explore', name: 'Explorer', route: '/explore', icon: 'folder-open' },
  { id: 'upload', name: 'Upload', route: '/upload', icon: 'cloud-upload' },
  { id: 'logs', name: 'Logs', route: '/logs', icon: 'file-text-o' },
  { id: 'settings', name: 'Settings', route: '/settings', icon: 'cog' },
];

const DOCK_HEIGHT = 60;
const TOP_OFFSET = 20; // Room above dock for the elevated mound and floating circle
const MARGIN_H = 14;
const CIRCLE_SIZE = 48;

/**
 * Builds the C1-continuous SVG path for the organic curved mound that slides under the active floating circle.
 */
function buildMoundPaths(w: number) {
  const cx = w / 2;
  const p1 = cx * 0.45;
  const p2 = cx * 0.58;
  const p3 = cx + (cx - p2);
  const p4 = cx + (cx - p1);
  const peakY = 2;
  const baseY = 20;

  const fillD = `M 0 ${baseY} C ${p1} ${baseY}, ${p2} ${peakY}, ${cx} ${peakY} C ${p3} ${peakY}, ${p4} ${baseY}, ${w} ${baseY} L ${w} ${baseY + 12} L 0 ${baseY + 12} Z`;
  const strokeD = `M 0 ${baseY} C ${p1} ${baseY}, ${p2} ${peakY}, ${cx} ${peakY} C ${p3} ${peakY}, ${p4} ${baseY}, ${w} ${baseY}`;

  return { fillD, strokeD };
}

export function BottomNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { isDark } = useAppTheme();

  const [pendingCount, setPendingCount] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(() => Dimensions.get('window').width);

  const isTabScreen = ['/', '/upload', '/explore', '/settings', '/logs'].includes(pathname);

  const activeIndex = useMemo(() => {
    const idx = TABS.findIndex((t) => t.route === pathname);
    return idx >= 0 ? idx : 0;
  }, [pathname]);

  const activeTab = TABS[activeIndex] || TABS[0];

  // Animated sliding value for the floating active circle & curved mound
  const [activeAnim] = useState(() => new Animated.Value(activeIndex));
  const [circleScaleAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(activeAnim, {
        toValue: activeIndex,
        useNativeDriver: true,
        tension: 68,
        friction: 8.5,
      }),
      Animated.sequence([
        Animated.timing(circleScaleAnim, {
          toValue: 0.82,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.spring(circleScaleAnim, {
          toValue: 1.0,
          tension: 80,
          friction: 6,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [activeIndex, activeAnim, circleScaleAnim]);

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
  const tabWidth = dockWidth / TABS.length;
  const moundWidth = Math.min(68, tabWidth * 0.94);
  const moundPaths = buildMoundPaths(moundWidth);

  // Precompute output coordinates for native driver interpolation
  const outputRangeX = TABS.map((_, i) => tabWidth * (i + 0.5) - moundWidth / 2);
  const translateX = activeAnim.interpolate({
    inputRange: TABS.map((_, i) => i),
    outputRange: outputRangeX,
  });

  const dockBg = isDark ? '#141E2E' : '#FFFFFF';
  const dockStroke = isDark ? 'rgba(255, 255, 255, 0.12)' : '#E2E8F0';

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
      <View style={[styles.dockContainer, { width: dockWidth, height: DOCK_HEIGHT + TOP_OFFSET }]}>
        {/* Dock Base Bar */}
        <View
          style={[
            styles.dockBase,
            {
              backgroundColor: dockBg,
              borderColor: dockStroke,
            },
          ]}
        />

        {/* Sliding Dynamic Active Indicator (Organic Curved Mound + Floating Elevated Circle) */}
        <Animated.View
          style={[
            styles.slidingActiveWrapper,
            {
              width: moundWidth,
              transform: [{ translateX }],
            },
          ]}
          pointerEvents="none"
        >
          {/* Organic Curved Mound blending into the dock */}
          <Svg width={moundWidth} height={28} style={styles.moundSvg}>
            <Path d={moundPaths.fillD} fill={dockBg} />
            <Path d={moundPaths.strokeD} fill="none" stroke={dockStroke} strokeWidth={1.2} />
          </Svg>

          {/* Elevated Floating Active Circle */}
          <Animated.View
            style={[
              styles.floatingActiveCircle,
              isDark ? styles.floatingCircleDark : styles.floatingCircleLight,
              {
                left: (moundWidth - CIRCLE_SIZE) / 2,
                transform: [{ scale: circleScaleAnim }],
              },
            ]}
          >
            <FontAwesome
              name={activeTab.icon}
              size={20}
              color="#FFFFFF"
            />
            {activeTab.id === 'upload' && pendingCount > 0 && (
              <View style={styles.fabBadge}>
                <Text style={styles.fabBadgeText}>
                  {pendingCount > 99 ? '99+' : pendingCount}
                </Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>

        {/* Tab Items Row inside the Dock */}
        <View style={styles.tabsRow}>
          {TABS.map((tab, idx) => {
            const isActive = idx === activeIndex;
            return (
              <TouchableOpacity
                key={tab.id}
                style={styles.tabTouch}
                onPress={() => handleTabPress(tab.route)}
                activeOpacity={0.7}
              >
                {isActive ? (
                  <View style={styles.activeTabSlot}>
                    <Text
                      style={[
                        styles.tabLabel,
                        isDark ? styles.tabLabelActiveDark : styles.tabLabelActiveLight,
                      ]}
                      numberOfLines={1}
                    >
                      {tab.name}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.inactiveTabSlot}>
                    <View style={styles.iconWrap}>
                      <FontAwesome
                        name={tab.icon}
                        size={18}
                        color={isDark ? '#94A3B8' : '#64748B'}
                      />
                      {tab.id === 'upload' && pendingCount > 0 && (
                        <View style={styles.inactiveBadge}>
                          <Text style={styles.inactiveBadgeText}>
                            {pendingCount > 99 ? '99+' : pendingCount}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.tabLabel,
                        isDark ? styles.tabLabelDark : styles.tabLabelLight,
                      ]}
                      numberOfLines={1}
                    >
                      {tab.name}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
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
    overflow: 'visible',
  },
  dockBase: {
    position: 'absolute',
    top: TOP_OFFSET,
    left: 0,
    right: 0,
    height: DOCK_HEIGHT,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  slidingActiveWrapper: {
    position: 'absolute',
    top: 0,
    height: 75,
    zIndex: 10,
  },
  moundSvg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  floatingActiveCircle: {
    position: 'absolute',
    top: 1,
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCircleDark: {
    backgroundColor: '#208AEF',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
  },
  floatingCircleLight: {
    backgroundColor: '#208AEF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
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
  tabsRow: {
    position: 'absolute',
    top: TOP_OFFSET,
    left: 0,
    right: 0,
    height: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabTouch: {
    flex: 1,
    height: DOCK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  inactiveTabSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 20,
  },
  inactiveBadge: {
    position: 'absolute',
    top: -5,
    right: -10,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactiveBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
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
