# Expo Remote App Bridge

Expo React Native bridge components for `expo-remote-app-mcp`.

## Install

```bash
npm install expo-remote-app-bridge react-native-view-shot
```

## Expo Router

```tsx
import { Stack } from "expo-router";
import { RemoteControlBridge } from "expo-remote-app-bridge/expo-router";

export default function RootLayout() {
  return (
    <RemoteControlBridge bridgeIp="192.168.1.10">
      <Stack />
    </RemoteControlBridge>
  );
}
```

## React Navigation

```tsx
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createNavigationContainerRef } from "@react-navigation/native";
import { RemoteControlBridge } from "expo-remote-app-bridge/react-navigation";

const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef();

function RootNavigator() {
  return <Stack.Navigator>{/* screens */}</Stack.Navigator>;
}

export default function App() {
  return (
    <RemoteControlBridge bridgeIp="192.168.1.10" navigationRef={navigationRef}>
      <RootNavigator />
    </RemoteControlBridge>
  );
}
```

Use your computer LAN IP, not `localhost`. The bridge scans WebSocket ports from `2000` through `2020` automatically.
