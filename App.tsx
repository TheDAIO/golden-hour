import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Switch,
  ScrollView,
  ActivityIndicator,
  Platform,
  SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SunCalc from 'suncalc';

// ─── Storage keys ────────────────────────────────────────────────────────────
const LOCATION_KEY = '@golden_hour:location';
const NOTIFS_KEY = '@golden_hour:notifications';

// ─── Color palette ───────────────────────────────────────────────────────────
const C = {
  bg: '#0A0A0F',
  card: '#14141C',
  border: '#1E1E2A',
  gold: '#FFBC47',
  goldDim: '#7A5A20',
  goldText: '#FFD080',
  blue: '#5B9EEA',
  blueDim: '#1E3A5F',
  blueText: '#8DC4FF',
  white: '#F0EDE8',
  muted: '#7A7890',
  danger: '#FF5E5B',
};

// ─── Types ───────────────────────────────────────────────────────────────────
interface LocationData {
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
}

interface SunTimes {
  morningGoldenStart: Date;
  morningGoldenEnd: Date;
  eveningGoldenStart: Date;
  eveningGoldenEnd: Date;
  morningBlueStart: Date;
  morningBlueEnd: Date;
  eveningBlueStart: Date;
  eveningBlueEnd: Date;
}

interface NextEvent {
  label: string;
  start: Date;
}

// ─── Sun calculations ────────────────────────────────────────────────────────
function calcSunTimes(date: Date, lat: number, lon: number): SunTimes {
  const t = SunCalc.getTimes(date, lat, lon);
  return {
    // Morning golden hour: sunrise → end of golden hour
    morningGoldenStart: t.sunrise,
    morningGoldenEnd: t.goldenHourEnd,
    // Evening golden hour: start of golden hour → sunset
    eveningGoldenStart: t.goldenHour,
    eveningGoldenEnd: t.sunset,
    // Morning blue hour: civil dawn → sunrise
    morningBlueStart: t.dawn,
    morningBlueEnd: t.sunrise,
    // Evening blue hour: sunset → civil dusk
    eveningBlueStart: t.sunset,
    eveningBlueEnd: t.dusk,
  };
}

function getNextGoldenEvent(times: SunTimes): NextEvent | null {
  const now = new Date();
  const candidates: NextEvent[] = [
    { label: 'Morning Golden Hour', start: times.morningGoldenStart },
    { label: 'Evening Golden Hour', start: times.eveningGoldenStart },
  ];
  return candidates.find((e) => e.start > now) ?? null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmtTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtRange(start: Date, end: Date): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'Now!';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

// ─── Notification scheduling ─────────────────────────────────────────────────
async function scheduleGoldenHourNotifications(lat: number, lon: number): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = new Date();

  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    const times = calcSunTimes(date, lat, lon);

    const events: NextEvent[] = [
      { label: 'Morning Golden Hour', start: times.morningGoldenStart },
      { label: 'Evening Golden Hour', start: times.eveningGoldenStart },
    ];

    for (const event of events) {
      const notifyAt = new Date(event.start.getTime() - 15 * 60 * 1000);
      if (notifyAt > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🌅 Golden Hour in 15 minutes',
            body: `${event.label} starts at ${fmtTime(event.start)}. Get your camera ready!`,
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: notifyAt,
          },
        });
      }
    }
  }
}

// ─── Notification handler (must be set before component renders) ──────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Main Component ───────────────────────────────────────────────────────────
export default function App() {
  const [loc, setLoc] = useState<LocationData | null>(null);
  const [sunTimes, setSunTimes] = useState<SunTimes | null>(null);
  const [nextEvent, setNextEvent] = useState<NextEvent | null>(null);
  const [countdown, setCountdown] = useState<string>('--:--');
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Compute sun times from a location ──────────────────────────────────────
  const applyLocation = useCallback((locData: LocationData) => {
    const times = calcSunTimes(new Date(), locData.latitude, locData.longitude);
    setSunTimes(times);
    setNextEvent(getNextGoldenEvent(times));
  }, []);

  // ── Load / refresh location ───────────────────────────────────────────────
  const initLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Show cached data immediately so the UI isn't blank
      const cached = await AsyncStorage.getItem(LOCATION_KEY);
      if (cached) {
        const cachedLoc: LocationData = JSON.parse(cached);
        setLoc(cachedLoc);
        applyLocation(cachedLoc);
      }

      // Request fresh GPS position
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (!cached) {
          setError('Location permission denied. Enable it in Settings to see sun times for your area.');
        }
        setLoading(false);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;

      // Reverse-geocode for a human-readable name (best-effort; skipped offline)
      let city: string | undefined;
      let region: string | undefined;
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        city = place?.city ?? place?.subregion ?? undefined;
        region = place?.region ?? undefined;
      } catch {
        // Offline — names will fall back to coordinates
      }

      const freshLoc: LocationData = { latitude, longitude, city, region };
      await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(freshLoc));
      setLoc(freshLoc);
      applyLocation(freshLoc);
    } catch {
      if (!loc) {
        setError('Could not determine your location. Check your GPS settings.');
      }
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load notification preference ──────────────────────────────────────────
  const initNotifications = useCallback(async () => {
    const stored = await AsyncStorage.getItem(NOTIFS_KEY);
    setNotifEnabled(stored === 'true');
  }, []);

  // ── Toggle notifications ───────────────────────────────────────────────────
  const handleToggleNotifications = useCallback(
    async (value: boolean) => {
      if (value) {
        // Ask for permission before enabling
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          return; // Leave switch off
        }
        setNotifEnabled(true);
        await AsyncStorage.setItem(NOTIFS_KEY, 'true');
        if (loc) {
          await scheduleGoldenHourNotifications(loc.latitude, loc.longitude);
        }
      } else {
        setNotifEnabled(false);
        await AsyncStorage.setItem(NOTIFS_KEY, 'false');
        await Notifications.cancelAllScheduledNotificationsAsync();
      }
    },
    [loc]
  );

  // ── Countdown tick ────────────────────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (!nextEvent) {
      setCountdown('Check back tomorrow');
      return;
    }

    const tick = () => {
      const ms = nextEvent.start.getTime() - Date.now();
      setCountdown(fmtCountdown(ms));
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [nextEvent]);

  // ── One-time setup ────────────────────────────────────────────────────────
  useEffect(() => {
    // Create Android notification channel
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('golden-hour', {
        name: 'Golden Hour',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: C.gold,
      });
    }

    initLocation();
    initNotifications();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render: loading splash ─────────────────────────────────────────────────
  if (loading && !loc) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={C.gold} />
        <Text style={styles.loadingText}>Finding your location…</Text>
      </SafeAreaView>
    );
  }

  // ── Location label ────────────────────────────────────────────────────────
  const locationLabel = loc
    ? loc.city && loc.region
      ? `${loc.city}, ${loc.region}`
      : `${loc.latitude.toFixed(4)}°, ${loc.longitude.toFixed(4)}°`
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>Golden Hour</Text>
          {locationLabel ? (
            <Text style={styles.locationText}>📍 {locationLabel}</Text>
          ) : null}
          <Text style={styles.dateText}>
            {new Date().toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
        </View>

        {/* ── Error banner ── */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── Countdown card ── */}
        {nextEvent ? (
          <View style={styles.countdownCard}>
            <Text style={styles.countdownLabel}>{nextEvent.label}</Text>
            <Text style={styles.countdownValue}>{countdown}</Text>
            <Text style={styles.countdownSub}>
              Starts at {fmtTime(nextEvent.start)}
            </Text>
          </View>
        ) : (
          <View style={styles.countdownCard}>
            <Text style={styles.countdownLabel}>All Done for Today</Text>
            <Text style={styles.countdownValue}>See you tomorrow</Text>
          </View>
        )}

        {/* ── Golden Hour card ── */}
        {sunTimes ? (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>✨</Text>
                <Text style={[styles.cardTitle, { color: C.goldText }]}>
                  GOLDEN HOUR
                </Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Morning</Text>
                <Text style={[styles.rowValue, { color: C.goldText }]}>
                  {fmtRange(sunTimes.morningGoldenStart, sunTimes.morningGoldenEnd)}
                </Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>Evening</Text>
                <Text style={[styles.rowValue, { color: C.goldText }]}>
                  {fmtRange(sunTimes.eveningGoldenStart, sunTimes.eveningGoldenEnd)}
                </Text>
              </View>
            </View>

            {/* ── Blue Hour card ── */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>💙</Text>
                <Text style={[styles.cardTitle, { color: C.blueText }]}>
                  BLUE HOUR
                </Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Morning</Text>
                <Text style={[styles.rowValue, { color: C.blueText }]}>
                  {fmtRange(sunTimes.morningBlueStart, sunTimes.morningBlueEnd)}
                </Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>Evening</Text>
                <Text style={[styles.rowValue, { color: C.blueText }]}>
                  {fmtRange(sunTimes.eveningBlueStart, sunTimes.eveningBlueEnd)}
                </Text>
              </View>
            </View>
          </>
        ) : null}

        {/* ── Notifications card ── */}
        <View style={[styles.card, styles.notifCard]}>
          <View style={styles.notifRow}>
            <View style={styles.notifInfo}>
              <Text style={styles.notifTitle}>🔔 Notifications</Text>
              <Text style={styles.notifSub}>15 min before golden hour</Text>
            </View>
            <Switch
              value={notifEnabled}
              onValueChange={handleToggleNotifications}
              trackColor={{ false: C.border, true: C.goldDim }}
              thumbColor={notifEnabled ? C.gold : C.muted}
            />
          </View>
        </View>

        <Text style={styles.footer}>
          All calculations are local · No account required
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    padding: 20,
    paddingBottom: 48,
  },

  // Loading
  loadingText: {
    color: C.muted,
    marginTop: 14,
    fontSize: 14,
  },

  // Header
  header: {
    marginBottom: 24,
    paddingTop: 4,
  },
  appTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: C.gold,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  locationText: {
    fontSize: 15,
    color: C.white,
    marginBottom: 3,
  },
  dateText: {
    fontSize: 13,
    color: C.muted,
  },

  // Error
  errorBanner: {
    backgroundColor: '#2A1515',
    borderColor: C.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: C.danger,
    fontSize: 13,
  },

  // Countdown
  countdownCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 22,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.goldDim,
    alignItems: 'center',
  },
  countdownLabel: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  countdownValue: {
    color: C.white,
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1,
  },
  countdownSub: {
    color: C.muted,
    fontSize: 13,
    marginTop: 6,
  },

  // Cards
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    color: C.muted,
    fontSize: 14,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Notifications
  notifCard: {
    marginTop: 2,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notifInfo: {
    flex: 1,
  },
  notifTitle: {
    color: C.white,
    fontSize: 16,
    fontWeight: '600',
  },
  notifSub: {
    color: C.muted,
    fontSize: 12,
    marginTop: 3,
  },

  // Footer
  footer: {
    color: C.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
    letterSpacing: 0.3,
  },
});
