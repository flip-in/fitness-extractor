// Configuration template - Copy this to config.ts and fill in your values

export const config = {
  // Backend API base URL
  // For development: Use your Mac's local IP address (e.g., "http://192.168.1.100:3000")
  // For production: Use your NAS IP via Tailscale (e.g., "http://100.x.x.x:3000")
  apiBaseURL: "http://YOUR_BACKEND_IP:3000", // TODO: Replace with your backend URL

  // API Key for authentication
  // Get this from your backend .env file (API_KEY value)
  apiKey: "YOUR_API_KEY_HERE", // TODO: Replace with your API key

  // Mapbox access token for map visualization
  // Get this from https://account.mapbox.com/access-tokens/
  mapboxToken: "YOUR_MAPBOX_TOKEN_HERE", // TODO: Replace with your Mapbox token

  // User ID (MVP uses single user)
  userId: "00000000-0000-0000-0000-000000000001",
};
