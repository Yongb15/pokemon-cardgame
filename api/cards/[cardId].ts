// See api/cards.ts
import { cardsRoute } from '../../server/cardsRoute.js'

export const GET = (request: Request) => cardsRoute(request, 'cardId')
export const HEAD = GET
