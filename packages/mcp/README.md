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
