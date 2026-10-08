// Vercel Cron: the daily price run (schedule in vercel.json). Needs Authorization: Bearer $CRON_SECRET.
import { handleCron } from '../../server/prices/cron.js'

export function GET(request: Request) {
  return handleCron(request)
}
