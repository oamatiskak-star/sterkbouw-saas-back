export function logEvent(message) {
  const timestamp = new Date().toISOString()
  console.log(`[LOG] ${timestamp} - ${message}`)
}