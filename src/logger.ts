export function log(message: string) {
  process.stderr.write(`[expo-remote-app-mcp] ${message}\n`);
}
