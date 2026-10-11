// Price alert targets (docs/price/alerts.md): whole hundreds of won, between ₩100 and ₩100,000,000.

const clamp = (n: number) => Math.min(100_000_000, Math.max(100, n))

/** `pct` percent under the current price, rounded down to ₩100 */
export const alertStep = (krw: number, pct: number) => clamp(Math.floor((krw * (100 - pct)) / 100 / 100) * 100)

/** The dialog's starting value: 10% under the current price */
export const alertDefault = (krw: number) => alertStep(krw, 10)

/** What the alert says about itself on the favorites page */
export function alertState(alert: { active: boolean; triggeredAt: string | null }) {
  return alert.active ? '대기' : '울림'
}
