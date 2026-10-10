// Auction helpers shared by the market and the auction page

/** Server time minus this device's, learned only from no-store answers (qa: cached ones may be old) */
let offsetMs = 0
export function learnServerTime(serverNow: string) {
  const t = Date.parse(serverNow)
  if (Number.isFinite(t)) offsetMs = t - Date.now()
}
export const serverNow = () => Date.now() + offsetMs

/** "2일 4시간", "17분", "03:12" (the last hour counts down by the second) */
export function timeLeft(endsAt: string, now = serverNow()) {
  const ms = Date.parse(endsAt) - now
  if (ms <= 0) return null
  const s = Math.floor(ms / 1000)
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const h = Math.floor(s / 3600)
  if (h < 24) return `${h}시간 ${Math.floor((s % 3600) / 60)}분`
  return `${Math.floor(h / 24)}일 ${h % 24}시간`
}

export const isEndingSoon = (endsAt: string, now = serverNow()) => Date.parse(endsAt) - now < 60 * 60 * 1000

export const DURATION_LABEL: Record<string, string> = { '1h': '1시간', '24h': '24시간', '72h': '3일', '2m': '2분 (테스트)', '5m': '5분 (테스트)' }
