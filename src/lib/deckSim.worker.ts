// The 20,000-shuffle odds off the main thread, so a click never freezes the tab (Security D-4). The run
// count is fixed here; the page only sends the deck (at most 60 ids), which Basics it has and the target.

import { odds, SIM_DECK, SIM_RUNS } from './deckSim'

interface Request {
  ids: string[]
  basics: string[]
  target: string | null
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { ids, basics, target } = event.data
  if (!Array.isArray(ids) || ids.length !== SIM_DECK || !Array.isArray(basics)) {
    self.postMessage(null)
    return
  }
  const basic = new Set(basics)
  self.postMessage(odds(ids, (id) => basic.has(id), typeof target === 'string' ? target : null, SIM_RUNS))
}
