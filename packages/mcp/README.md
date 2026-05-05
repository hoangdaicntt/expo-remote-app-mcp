# Expo Remote App MCP

MCP server for remotely inspecting and debugging an Expo React Native app.

## Install

Register the MCP server with your MCP client:

```json
{
  "mcpServers": {
    "expo-remote-app-mcp": {
      "command": "npx",
      "args": ["-y", "expo-remote-app-mcp"]
    }
  }
}
```

The WebSocket bridge starts at port `2000` and automatically tries the next port if one is already in use.

Optional environment variables:

```bash
EXPO_REMOTE_WS_PORT=2000
EXPO_REMOTE_COMMAND_TIMEOUT_MS=15000
EXPO_REMOTE_CDP_JSON_URL=http://localhost:8081/json
```

## MCP Tools

`take_screenshot`

Captures the current app screen through the app-side WebSocket bridge and returns MCP image content.

`navigate`

Navigates the connected Expo app to a screen name or Expo Router path.

Arguments:

```json
{
  "screenName": "/settings"
}
```

`get_network_traffic`

Returns recent network requests captured from the React Native runtime through Chrome DevTools Protocol. Logs are capped at 100 items.

Arguments:

```json
{
  "limit": 20
}
```

`get_latest_errors`

Returns recent console errors, warnings, and unhandled exceptions captured from the React Native JS runtime. Logs are capped at 100 items.

Arguments:

```json
{
  "limit": 20,
  "clear": true
}
```

`evaluate_js`

Executes JavaScript directly in the React Native runtime through `Runtime.evaluate`.

Arguments:

```json
{
  "code": "globalThis.location?.href"
}
```

`mock_api_endpoint`

Intercepts matching API requests through the CDP `Fetch` domain and fulfills them with a mock response.

Arguments:

```json
{
  "urlPattern": "*://localhost:3000/users*",
  "mockStatus": 200,
  "mockBody": "{\"users\":[]}"
}
```

## App Bridge

Install the app-side bridge in your Expo app:

```bash
npm install expo-remote-app-bridge react-native-view-shot
```

Then wrap your app with the bridge component from either:

```ts
import { RemoteControlBridge } from "expo-remote-app-bridge/expo-router";
```

or:

```ts
import { RemoteControlBridge } from "expo-remote-app-bridge/react-navigation";
```
