/** "방금", "12분 전", "3시간 전", "어제", then the date (notification times) */
export function ago(at: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`
  if (minutes < 48 * 60) return '어제'
  return new Date(at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}
