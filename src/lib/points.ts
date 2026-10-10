// Point helpers shared by the header, the account menu and the my page

export const won = (n: number) => `${n.toLocaleString('ko-KR')}P`

// One notice at a time (check-in, the first bonus), shown by <PointsNotice /> in the header
export type PointsNoticeValue = { id: number; text: string } | null
let notice: PointsNoticeValue = null
const listeners = new Set<(n: PointsNoticeValue) => void>()

export function announcePoints(text: string) {
  notice = { id: Date.now(), text }
  for (const l of listeners) l(notice)
}

export function currentNotice() {
  return notice
}

export function onNotice(listener: (n: PointsNoticeValue) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
