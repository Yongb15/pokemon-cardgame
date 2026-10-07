import { useEffect, useRef } from 'react'
import { MAX_NAME_LENGTH } from '../lib/cardFilters'
import styles from './SearchBar.module.css'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export default function SearchBar({ value, onChange, placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // "/" focuses the search box, like GitHub and MDN
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className={styles.search} role="search">
      <svg className={styles.icon} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <label htmlFor="card-search" className="visually-hidden">
        카드 이름 검색
      </label>
      <input
        ref={inputRef}
        id="card-search"
        maxLength={MAX_NAME_LENGTH}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          onClick={() => {
            onChange('')
            inputRef.current?.focus() // the button disappears; keep keyboard users in the search box
          }}
          aria-label="검색어 지우기"
        >
          ✕
        </button>
      ) : (
        <kbd className={styles.kbd} aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  )
}
