import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { errorMessage, loadAccountDecks, reloadFromAccount, saveInAccount } from '../../hooks/useAccountDecks'
import { createInLibrary, useDeckLibrary } from '../../hooks/useDeckLibrary'
import { useCardInfo } from '../../hooks/useDecks'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import {
  checkDeck,
  DECK_SIZE,
  deckSize,
  FORMATS,
  isBasicEnergy,
  MAX_COPIES,
  problemCount,
  putDeck,
  ruleName,
  type Deck,
  type DeckCard,
} from '../../lib/deck'
import type { Card, CardListItem } from '../../types/card'
import styles from './AddToDeck.module.css'

const SHOWN = 5

type RowStatus = { kind: 'error' | 'conflict'; text: string }

/** The cover and rule status the deck list shows, when every card's details are in (else unchanged) */
function listExtras(cards: DeckCard[], format: Deck['format'], info: Map<string, CardListItem>, unknown: string[]) {
  if (!cards.every((c) => info.has(c.id) || unknown.includes(c.id))) return {}
  return {
    coverId: cards.find((c) => info.get(c.id)?.supertype === 'Pokémon')?.id ?? cards[0]?.id,
    problems: problemCount(checkDeck(cards, format, info)),
  }
}

function withCount(cards: DeckCard[], id: string, count: number): DeckCard[] {
  if (count <= 0) return cards.filter((c) => c.id !== id)
  return cards.some((c) => c.id === id) ? cards.map((c) => (c.id === id ? { ...c, count } : c)) : [...cards, { id, count }]
}

/**
 * "덱에 담기" on the card detail page (docs/design/deck-add-and-stats.webp ①–④): the user's decks
 * (the account's when signed in, this browser's when not) with this card's count in each. Account
 * saves go one at a time per deck, the last wish winning; a conflict reloads that deck.
 */
export default function AddToDeck({ card }: { card: Card }) {
  const library = useDeckLibrary()
  const sheet = useMediaQuery('(max-width: 640px)')
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const [overrides, setOverrides] = useState<Map<string, DeckCard[]>>(new Map())
  const [rowStatus, setRowStatus] = useState<Map<string, RowStatus>>(new Map())
  const [saving, setSaving] = useState(0)
  const [savedOnce, setSavedOnce] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const cardName = card.nameKo ?? card.name

  const mode = library.mode === 'account' ? 'account' : 'local'
  // Newest first as of opening; saving moves a deck's date, but the rows stay put under the pointer
  const [order, setOrder] = useState<string[]>([])
  const decks = useMemo(() => {
    if (!(library.mode === 'local' || (library.mode === 'account' && library.status === 'ready'))) return []
    const rank = (d: Deck) => {
      const i = order.indexOf(d.id)
      return i === -1 ? -1 : i // decks made since opening go on top
    }
    return [...library.decks].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
  }, [library, order])
  const shown = decks.slice(0, SHOWN)
  const cardsOf = (deck: Deck) => overrides.get(deck.id) ?? deck.cards

  // Names of every card in the shown decks, for the four-copy rule (only while open)
  const ids = useMemo(() => (open ? [card.id, ...shown.flatMap((d) => d.cards.map((c) => c.id))] : []), [open, card.id, shown])
  const { info, loading, unknownIds } = useCardInfo(ids)

  // The latest decks for the save loop (it runs across renders)
  const decksRef = useRef(decks)
  useEffect(() => {
    decksRef.current = decks
  })
  const wanted = useRef(new Map<string, DeckCard[]>())
  const inFlight = useRef(new Set<string>())

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  // Close on a click elsewhere (the popover; the sheet has its own backdrop) or Esc
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!sheet && !root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      // The sheet is modal: Tab cycles inside it
      if (event.key !== 'Tab' || !sheet || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialog.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, sheet])

  // Opening: keep the popover on screen, then move focus into it
  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setAlignRight(rect.left + 360 > window.innerWidth - 16)
    dialog.current?.focus()
  }, [open])

  const setStatus = (deckId: string, status: RowStatus | null) =>
    setRowStatus((m) => {
      const next = new Map(m)
      if (status) next.set(deckId, status)
      else next.delete(deckId)
      return next
    })
  const setOverride = (deckId: string, cards: DeckCard[] | null) =>
    setOverrides((m) => {
      const next = new Map(m)
      if (cards) next.set(deckId, cards)
      else next.delete(deckId)
      return next
    })

  async function flush(deckId: string) {
    if (inFlight.current.has(deckId)) return
    inFlight.current.add(deckId)
    setSaving((n) => n + 1)
    let base = decksRef.current.find((d) => d.id === deckId)
    try {
      for (let cards = wanted.current.get(deckId); cards && base; cards = wanted.current.get(deckId)) {
        wanted.current.delete(deckId)
        const result = await saveInAccount({ ...base, cards, ...listExtras(cards, base.format, info, unknownIds) })
        if (result === 'conflict') {
          wanted.current.delete(deckId)
          setOverride(deckId, null)
          setStatus(deckId, { kind: 'conflict', text: '다른 곳에서 이 덱이 바뀌어 최신 내용으로 다시 불러왔어요. 다시 담아 주세요.' })
          await reloadFromAccount(deckId).catch(() => undefined)
          return
        }
        base = result
      }
      setOverride(deckId, null)
      setSavedOnce(true)
    } catch (error) {
      wanted.current.delete(deckId)
      setOverride(deckId, null)
      setStatus(deckId, { kind: 'error', text: errorMessage(error, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') })
    } finally {
      inFlight.current.delete(deckId)
      setSaving((n) => n - 1)
    }
  }

  function change(deck: Deck, count: number) {
    const cards = withCount(cardsOf(deck), card.id, count)
    setStatus(deck.id, null)
    if (mode === 'local') {
      try {
        putDeck({ ...deck, cards, ...listExtras(cards, deck.format, info, unknownIds) })
        setSavedOnce(true)
      } catch {
        setStatus(deck.id, { kind: 'error', text: '브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.' })
      }
      return
    }
    setOverride(deck.id, cards)
    wanted.current.set(deck.id, cards)
    void flush(deck.id)
  }

  async function createWithCard() {
    setCreateError(null)
    setCreating(true)
    try {
      await createInLibrary(mode, { cards: [{ id: card.id, count: 1 }] })
      setSavedOnce(true)
    } catch (error) {
      setCreateError(mode === 'account' ? errorMessage(error) : '브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.')
    } finally {
      setCreating(false)
    }
  }

  const basicEnergy = isBasicEnergy(card)
  const myName = ruleName(card.name)

  function row(deck: Deck) {
    const cards = cardsOf(deck)
    const here = cards.find((c) => c.id === card.id)?.count ?? 0
    const total = deckSize(cards)
    const sameName = cards.reduce((n, c) => n + (c.id === card.id || ruleName(info.get(c.id)?.name ?? '') === myName ? c.count : 0), 0)
    const full = total >= DECK_SIZE
    const fourOf = !basicEnergy && sameName >= MAX_COPIES
    const canAdd = !loading && !full && !fourOf
    const status = rowStatus.get(deck.id)
    const deckName = deck.name || '이름 없는 덱'
    return (
      <li key={deck.id} className={styles.row}>
        <div className={styles.rowMain}>
          <Link to={`/decks/${deck.id}`} className={styles.deckName}>
            {deckName}
          </Link>
          <small>
            {FORMATS[deck.format]} · {total}/{DECK_SIZE}
            {here > 0 && ` · 이 카드 ${here}장`}
            {full && ' · 가득 참'}
          </small>
        </div>
        {here > 0 ? (
          <div className={styles.step} role="group" aria-label={`${deckName}에 든 ${cardName}`}>
            <button type="button" aria-label={`${deckName}에서 한 장 빼기`} onClick={() => change(deck, here - 1)}>
              −
            </button>
            <span aria-live="polite">{here}</span>
            <button type="button" aria-label={`${deckName}에 한 장 더 담기`} disabled={!canAdd} onClick={() => change(deck, here + 1)}>
              +
            </button>
          </div>
        ) : (
          <button type="button" className={styles.add} aria-label={`${deckName}에 담기`} disabled={!canAdd} onClick={() => change(deck, 1)}>
            + 담기
          </button>
        )}
        {fourOf && !full && (
          <p className={styles.limit}>
            {sameName > here ? `다른 판본의 "${cardName}"까지 ${MAX_COPIES}장이 찼어요.` : `같은 이름은 ${MAX_COPIES}장까지예요.`}
          </p>
        )}
        {status && (
          <p className={styles.alert} role="alert">
            {status.text}
          </p>
        )}
      </li>
    )
  }

  let body
  if (library.mode === 'checking' || (library.mode === 'account' && library.status === 'loading')) {
    body = <p className={styles.muted}>덱을 불러오는 중…</p>
  } else if (library.mode === 'account' && library.status === 'error') {
    body = (
      <p className={styles.alert} role="alert">
        {library.message}{' '}
        <button type="button" className={styles.linkButton} onClick={() => void loadAccountDecks()}>
          다시 시도
        </button>
      </p>
    )
  } else if (!decks.length) {
    body = (
      <>
        <p className={styles.muted}>아직 만든 덱이 없어요.</p>
        <button type="button" className={styles.primary} disabled={creating} onClick={() => void createWithCard()}>
          이 카드로 새 덱 만들기
        </button>
      </>
    )
  } else {
    body = (
      <>
        <ul className={styles.rows}>{shown.map(row)}</ul>
        {decks.length > SHOWN && (
          <Link to="/decks" className={styles.more}>
            모든 덱 보기 ({decks.length}개)
          </Link>
        )}
        <div className={styles.foot}>
          <button type="button" className={styles.linkButton} disabled={creating} onClick={() => void createWithCard()}>
            + 새 덱에 담기
          </button>
          {saving > 0 ? (
            <span className={styles.muted}>저장 중…</span>
          ) : savedOnce ? (
            <span className={styles.saved}>✓ 저장됨</span>
          ) : mode === 'local' ? (
            <span className={styles.muted}>로그인하면 계정에 저장돼요</span>
          ) : null}
        </div>
      </>
    )
  }

  const panel = (
    <div
      ref={dialog}
      className={sheet ? styles.sheet : `${styles.popover} ${alignRight ? styles.right : ''}`}
      role="dialog"
      aria-modal={sheet || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      {sheet && <span className={styles.grab} aria-hidden="true" />}
      <div className={styles.head}>
        <h2 id={titleId}>{sheet ? `${cardName} 덱에 담기` : '덱에 담기'}</h2>
        <span className={styles.muted}>{mode === 'account' ? '계정에 저장' : '이 브라우저에 저장'}</span>
      </div>
      {body}
      {createError && (
        <p className={styles.alert} role="alert">
          {createError}
        </p>
      )}
      {sheet && (
        <button type="button" className={styles.close} onClick={() => close()}>
          닫기
        </button>
      )}
    </div>
  )

  return (
    <div className={styles.wrap} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setCreateError(null)
          if (!open) setOrder([...decks].sort((a, b) => b.updatedAt - a.updatedAt).map((d) => d.id))
          setOpen(!open)
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <rect x="4" y="3" width="12" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 21h10a2 2 0 0 0 2-2V7" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        덱에 담기
        <span aria-hidden="true">▾</span>
      </button>
      {open &&
        (sheet ? (
          <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && close()}>
            {panel}
          </div>
        ) : (
          panel
        ))}
    </div>
  )
}
