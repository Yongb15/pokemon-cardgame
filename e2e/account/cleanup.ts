// Deletes this run's test accounts, run as its own `if: always()` step (Security E-3): their open auctions are
// ended and settled first, since an account that sells or leads an open auction can't leave. Counts only.
//
//   npx tsx e2e/account/cleanup.ts            (same GITHUB_RUN_ID / E2E_RUN_ID as the suite)
import { ROLES, assertTarget, signIn } from './session'

await assertTarget()
const accounts = await Promise.all(ROLES.map((role) => signIn(role)))
let ended = 0
for (const api of accounts) {
  const mine = await (await api.get('/api/v1/me/auctions')).json()
  for (const a of mine.selling as { id: string; status: string }[]) {
    if (a.status !== 'open') continue
    if ((await api.post(`/api/v1/test/auctions/${a.id}/ends-in`, { data: { seconds: 1 } })).ok()) ended++
  }
}
await new Promise((r) => setTimeout(r, 2_000))
await accounts[0]!.post('/api/v1/test/auctions/settle')

let deleted = 0
for (const api of accounts) {
  const { user } = await (await api.get('/api/v1/me')).json()
  if ((await api.delete('/api/v1/me', { data: { confirm: user.nickname } })).status() === 204) deleted++
  await api.dispose()
}
console.log(`e2e cleanup: ended ${ended} auctions, deleted ${deleted}/${ROLES.length} accounts`)
process.exit(deleted === ROLES.length ? 0 : 1)
