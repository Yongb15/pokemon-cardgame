import { useEffect, useMemo, useRef, useState } from 'react'
import CardGrid from '../components/CardGrid'
import CardTile from '../components/CardTile'
import { EmptyState, ErrorState, InvalidSearchState, SkeletonGrid, SlowNotice } from '../components/ListStates'
import Pagination from '../components/Pagination'
import SearchBar from '../components/SearchBar'
import Select from '../components/Select'
import TypeFilter from '../components/TypeFilter'
import { ApiError } from '../api/pokemonTcg'
import { useCardSearch } from '../hooks/useCardSearch'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useFilterOptions } from '../hooks/useFilterOptions'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useUrlParams } from '../hooks/useUrlParams'
import {
  activeFilterCount,
  cleanName,
  filtersFromParams,
  filtersToParams,
  nameIssue,
  pageFromParams,
  SORT_OPTIONS,
  type CardFilters,
  type SortKey,
} from '../lib/cardFilters'
import { TYPE_LABEL } from '../lib/pokemonTypes'
import type { CardSet } from '../types/card'
import styles from './CardListPage.module.css'

const SEARCH_DEBOUNCE_MS = 400

/** Keep the API's newest-first order while grouping sets under their series */
function groupBySeries(sets: CardSet[]) {
  const groups = new Map<string, CardSet[]>()
  for (const set of sets) groups.set(set.series, [...(groups.get(set.series) ?? []), set])
  return [...groups]
}

export default function CardListPage() {
  const [params, setParams] = useUrlParams()
  const filters = useMemo(() => filtersFromParams(params), [params])
  const page = pageFromParams(params)
  const isMobile = useMediaQuery('(max-width: 640px)')
  const { sets, rarities } = useFilterOptions()
  const search = useCardSearch(filters, page, isMobile ? 'append' : 'paged')
  const [panelOpen, setPanelOpen] = useState(false)
  const resultsRef = useRef<HTMLElement>(null)

  /** Controls that remove themselves (chip ✕, retry, reset) hand focus to the results */
  function focusResults() {
    resultsRef.current?.focus({ preventScroll: true })
  }

  // The search box updates instantly; the URL (and the request) follows after a pause in typing.
  const [nameInput, setNameInput] = useState(filters.name)
  const [urlName, setUrlName] = useState(filters.name)
  if (filters.name !== urlName) {
    setUrlName(filters.name)
    // URL changed underneath us (back/forward): show its search term. Skip when it only
    // reflects what's already typed, so "mr " doesn't lose its trailing space mid-typing.
    if (cleanName(nameInput) !== filters.name) setNameInput(filters.name)
  }
  const debouncedName = useDebouncedValue(nameInput, SEARCH_DEBOUNCE_MS)
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])
  useEffect(() => {
    const current = filtersRef.current
    if (cleanName(debouncedName) === current.name) return
    setParams(filtersToParams({ ...current, name: debouncedName }), 'replace')
  }, [debouncedName, setParams])

  function updateFilters(patch: Partial<CardFilters>) {
    setParams(filtersToParams({ ...filters, name: nameInput, ...patch }))
  }

  function clearName() {
    setNameInput('')
    updateFilters({ name: '' })
  }

  /** From the invalid-search screen: the button disappears, and the next step is typing again */
  function clearAndFocusSearch() {
    clearName()
    document.getElementById('card-search')?.focus()
  }

  function resetFilters() {
    setNameInput('')
    setParams(filtersToParams({ ...filters, name: '', type: '', set: '', rarity: '' }))
    focusResults()
  }

  // Bring the results into view after a page change: once the skeleton has rendered (scrolling
  // before that is cut short when the document shrinks), and again once the cards arrive, since
  // the grid grows back to full height. `overflow-anchor: none` on the results keeps the browser
  // from re-anchoring to the pager/footer and pushing the view back down.
  const { status, totalPages, totalCount } = search
  const scrollOnPageChange = useRef(false)
  function goToPage(next: number) {
    scrollOnPageChange.current = true
    setParams(filtersToParams(filters, next))
  }
  useEffect(() => {
    if (!scrollOnPageChange.current) return
    resultsRef.current?.scrollIntoView({ behavior: status === 'loading' ? 'smooth' : 'auto', block: 'start' })
    if (status !== 'loading') scrollOnPageChange.current = false
  }, [page, status])

  // Keep the URL canonical: drop invalid values (?type=bogus, ?page=0), clamp ?page= past the
  // last page, and use page 1 on phones, where "load more" replaces page numbers.
  const canonicalPage = isMobile ? 1 : status === 'success' && page > totalPages ? totalPages : page
  useEffect(() => {
    const canonical = filtersToParams(filters, canonicalPage)
    if (canonical.toString() !== params.toString()) setParams(canonical, 'replace')
  }, [filters, canonicalPage, params, setParams])

  const selectedSet = sets.find((set) => set.id === filters.set)
  const filterCount = activeFilterCount({ ...filters, name: '' })

  const setSelect = (
    <Select id="filter-set" label="세트" value={filters.set} onChange={(set) => updateFilters({ set })}>
      <option value="">전체</option>
      {/* Keep a URL-selected set valid while the list is still loading */}
      {filters.set && !selectedSet && <option value={filters.set}>{filters.set}</option>}
      {groupBySeries(sets).map(([series, list]) => (
        <optgroup key={series} label={series}>
          {list.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )

  const raritySelect = (
    <Select id="filter-rarity" label="희귀도" value={filters.rarity} onChange={(rarity) => updateFilters({ rarity })}>
      <option value="">전체</option>
      {filters.rarity && !rarities.includes(filters.rarity) && <option value={filters.rarity}>{filters.rarity}</option>}
      {rarities.map((rarity) => (
        <option key={rarity} value={rarity}>
          {rarity}
        </option>
      ))}
    </Select>
  )

  const sortSelect = (
    <Select
      id="sort"
      label="정렬"
      inlineLabel
      value={filters.sort}
      onChange={(sort) => updateFilters({ sort: sort as SortKey })}
    >
      {Object.entries(SORT_OPTIONS).map(([key, option]) => (
        <option key={key} value={key}>
          {option.label}
        </option>
      ))}
    </Select>
  )

  const activeChips = [
    filters.name && { key: 'name', label: `검색: ${filters.name}`, clear: clearName },
    filters.type && { key: 'type', label: `타입: ${TYPE_LABEL[filters.type]}`, clear: () => updateFilters({ type: '' }) },
    filters.set && { key: 'set', label: `세트: ${selectedSet?.name ?? filters.set}`, clear: () => updateFilters({ set: '' }) },
    filters.rarity && { key: 'rarity', label: `희귀도: ${filters.rarity}`, clear: () => updateFilters({ rarity: '' }) },
  ].filter((chip) => !!chip)

  const nameProblem = nameIssue(filters.name)
  const rejected = status === 'error' && search.error instanceof ApiError && search.error.status === 400

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>카드 도감</h1>
      <p className={styles.subtitle}>포켓몬 TCG의 모든 카드를 검색하고 살펴보세요.</p>

      <div className={styles.searchRow}>
        <SearchBar
          value={nameInput}
          onChange={setNameInput}
          placeholder={isMobile ? '카드 이름 검색 (영문)' : '카드 이름으로 검색 (예: Pikachu, Charizard)'}
        />
      </div>

      <div className={styles.filterRow}>
        {isMobile ? (
          <button
            type="button"
            className={styles.panelButton}
            aria-expanded={panelOpen}
            aria-controls="filter-panel"
            onClick={() => setPanelOpen((open) => !open)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            필터
            {filterCount > 0 && <span className={styles.count}>{filterCount}</span>}
          </button>
        ) : (
          <span className={styles.rowLabel}>타입</span>
        )}
        <TypeFilter value={filters.type} onChange={(type) => updateFilters({ type })} />
      </div>

      {(!isMobile || panelOpen) && (
        <div id="filter-panel" className={`${styles.filterRow} ${styles.panel}`}>
          {setSelect}
          {raritySelect}
          {!isMobile && <div className={styles.sort}>{sortSelect}</div>}
        </div>
      )}

      <section ref={resultsRef} className={styles.results} aria-labelledby="result-count" tabIndex={-1}>
        <div className={styles.resultBar}>
          <p id="result-count" aria-live="polite">
            {status === 'invalid' || rejected ? (
              '검색어 확인 필요'
            ) : status === 'loading' && totalCount === 0 ? (
              '카드를 불러오는 중…'
            ) : status === 'error' ? (
              '불러오기 실패'
            ) : (
              <>
                <b>{totalCount.toLocaleString('ko-KR')}장</b>의 카드
              </>
            )}
          </p>
          {isMobile ? (
            sortSelect
          ) : (
            activeChips.length > 0 && (
              <div className={styles.activeChips}>
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={styles.activeChip}
                    onClick={() => {
                      chip.clear()
                      focusResults()
                    }}
                  >
                    {chip.label} <span aria-label="해제">✕</span>
                  </button>
                ))}
                <button type="button" className={styles.resetLink} onClick={resetFilters}>
                  필터 초기화
                </button>
              </div>
            )
          )}
        </div>

        {search.slow && status === 'loading' && <SlowNotice />}

        {status === 'loading' && <SkeletonGrid count={isMobile ? 6 : 12} />}
        {status === 'invalid' && nameProblem && (
          <InvalidSearchState reason={nameProblem} query={filters.name} onClear={clearAndFocusSearch} />
        )}
        {rejected && <InvalidSearchState reason="rejected" query={filters.name} onClear={clearAndFocusSearch} />}
        {status === 'error' && !rejected && search.error && (
          <ErrorState
            error={search.error}
            onRetry={() => {
              search.retry()
              focusResults()
            }}
          />
        )}
        {status === 'success' && search.cards.length === 0 && (
          <EmptyState query={filters.name} onReset={resetFilters} />
        )}
        {status === 'success' && search.cards.length > 0 && (
          <CardGrid>
            {search.cards.map((card) => (
              <CardTile key={card.id} card={card} />
            ))}
          </CardGrid>
        )}

        {status === 'success' && search.cards.length > 0 && !isMobile && (
          <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
        )}

        {status === 'success' && isMobile && search.hasMore && (
          <div className={styles.more}>
            {search.loadMoreError && <p className={styles.moreError}>더 불러오지 못했어요. 다시 시도해 주세요.</p>}
            <button type="button" className={styles.moreButton} onClick={search.loadMore} disabled={search.loadingMore}>
              {search.loadingMore
                ? '불러오는 중…'
                : `더 보기 (${search.cards.length.toLocaleString('ko-KR')} / ${totalCount.toLocaleString('ko-KR')})`}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
