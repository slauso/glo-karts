export function shouldUseColyseus() {
  return String(import.meta.env.VITE_USE_COLYSEUS || "true").toLowerCase() === "true";
}

export function getColyseusEndpoint() {
  const env = import.meta.env.VITE_COLYSEUS_URL;
  if (env) return env;
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    return `ws://${host}:2567`;
  }
  return "ws://localhost:2567";
}
