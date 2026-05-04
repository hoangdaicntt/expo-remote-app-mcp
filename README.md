# Expo Remote App MCP Server

Phase 1 bridge for an AI agent to inspect a physical Expo/React Native app over LAN without ADB.

The Node.js process exposes an MCP server over stdio and a WebSocket server for the Expo app. MCP tool calls are forwarded to the connected app with a request ID, then resolved when the app responds with the same ID.

## Install

```bash
npm install
npm run build
```

## Run The MCP Bridge

```bash
npm run dev
```

By default the WebSocket bridge listens on `8080`.

Optional environment variables:

```bash
EXPO_REMOTE_WS_PORT=8080
EXPO_REMOTE_COMMAND_TIMEOUT_MS=15000
```

Register this server with your MCP client using the built output:

```json
{
  "mcpServers": {
    "expo-remote-app": {
      "command": "node",
      "args": ["/absolute/path/to/expo-remote-app-server/dist/server.js"]
    }
  }
}
```

For local development you can also point the MCP client at `tsx`:

```json
{
  "mcpServers": {
    "expo-remote-app": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/expo-remote-app-server/src/server.ts"]
    }
  }
}
```

## MCP Tools

`take_screenshot`

Captures the current app screen and returns MCP image content:

```json
{
  "type": "image",
  "data": "<base64 png>",
  "mimeType": "image/png"
}
```

`navigate`

Accepts:

```json
{
  "screenName": "/settings"
}
```

For Expo Router, pass route paths such as `/`, `/settings`, or `/users/123`.

## Expo App Setup

Install the screenshot dependency in your Expo app:

```bash
npx expo install react-native-view-shot
```

Copy `examples/expo/RemoteControlBridge.tsx` into your Expo app, then pass your bridge URL from the root layout:

```ts
<RemoteControlBridge bridgeUrl="ws://192.168.1.10:8080">
```

Use your computer's LAN IP, not `localhost`, because the app runs on a physical phone.

Wrap your root Expo Router layout:

```tsx
import { Stack } from "expo-router";
import { RemoteControlBridge } from "../RemoteControlBridge";

export default function RootLayout() {
  return (
    <RemoteControlBridge bridgeUrl="ws://192.168.1.10:8080">
      <Stack />
    </RemoteControlBridge>
  );
}
```

The client reconnects automatically after WebSocket disconnects and responds to:

`RemoteControlBridge` is enabled only in dev mode by default through `enabled = __DEV__`. In production builds it does not open a WebSocket or capture screenshots. You can override this manually with `enabled={false}` or `enabled={true}`.

```json
{ "id": "request-id", "command": "take_screenshot" }
```

```json
{ "id": "request-id", "command": "navigate", "payload": { "screenName": "/settings" } }
```

Responses are:

```json
{ "id": "request-id", "ok": true, "result": { "base64": "<png>" } }
```

```json
{ "id": "request-id", "ok": false, "error": "Something went wrong" }
```

## Standard React Navigation Variant

If your app is not using Expo Router, use `examples/expo/RemoteControlBridge.react-navigation.tsx`.

```tsx
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createNavigationContainerRef } from "@react-navigation/native";
import { RemoteControlBridge } from "./RemoteControlBridge.react-navigation";

const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef();

function RootNavigator() {
  return <Stack.Navigator>{/* screens */}</Stack.Navigator>;
}

export default function App() {
  return (
    <RemoteControlBridge
      bridgeUrl="ws://192.168.1.10:8080"
      navigationRef={navigationRef}
    >
      <RootNavigator />
    </RemoteControlBridge>
  );
}
```

Because `navigationRef` is created outside the bridge, other UI or service code can import and use the same ref when needed.

`navigationRef` is optional. If omitted, `RemoteControlBridge` uses its own default ref. In production builds, the React Navigation variant still renders `NavigationContainer`; it only disables the remote bridge behavior.
