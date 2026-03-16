# Golden Hour

Minimal React Native app showing exact golden hour, blue hour, and magic hour times for your GPS location — with local push notifications 15 minutes before golden hour.

**Built for:** Phone photographers, Instagram/TikTok creators, and hobbyist outdoor photographers.

---

## Features

- **Golden Hour times** — morning and evening, calculated from your GPS coordinates
- **Blue Hour times** — civil twilight windows for soft blue-sky shots
- **Countdown** — live countdown to the next golden hour
- **Push notifications** — local notification 15 min before each golden hour (7-day lookahead, no server needed)
- **Offline** — all calculations run locally via `suncalc`; no network required after first location fix
- **No account, no backend, no analytics**

---

## Requirements

- Node.js 18+
- Expo CLI (`npm install -g expo-cli` or use `npx expo`)
- iOS Simulator / Android Emulator, or Expo Go on a real device

---

## Setup

```bash
# Install dependencies
npm install

# Start the dev server
npx expo start
```

Then press:
- `i` to open in iOS Simulator
- `a` to open in Android Emulator
- Scan the QR code with **Expo Go** on your phone

---

## Tech Stack

| Concern | Package |
|---|---|
| Framework | React Native + Expo (managed, SDK 52) |
| Language | TypeScript |
| Sun calculations | `suncalc` |
| GPS | `expo-location` |
| Push notifications | `expo-notifications` |
| Local storage / cache | `@react-native-async-storage/async-storage` |

---

## How It Works

1. On first launch, the app requests location permission and fetches your GPS coordinates.
2. It reverse-geocodes to get a city name (best-effort; works offline after first fetch).
3. `SunCalc.getTimes()` computes golden hour and blue hour windows for your coordinates.
4. A live countdown ticks down to the next golden hour.
5. If you enable notifications, the app schedules local push notifications (no server) for the next 7 days — 15 minutes before each morning and evening golden hour.
6. Your location is cached in AsyncStorage so the app works fully offline after the initial GPS fix.

---

## Building for Production

```bash
# Install EAS CLI
npm install -g eas-cli

# Configure EAS
eas build:configure

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

---

## Pricing

$1.99 one-time purchase — no subscription, no upsell.
