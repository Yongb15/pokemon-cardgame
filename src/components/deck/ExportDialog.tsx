import { useState } from 'react'
import Dialog from './Dialog'
import styles from './deck.module.css'

/** Shows the deck as a Pokémon TCG Live list, ready to copy */
export default function ExportDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <Dialog title="PTCG Live로 내보내기" description="Pokémon TCG Live의 덱 가져오기에 붙여넣을 수 있는 목록이에요." onClose={onClose}>
      <label htmlFor="deck-export" className="visually-hidden">
        덱 목록
      </label>
      <textarea id="deck-export" className={styles.textarea} value={text} readOnly onFocus={(e) => e.target.select()} />
      <p className={styles.dialogStatus} role="status">
        {copied === 'ok' && '복사했어요.'}
        {copied === 'failed' && '복사하지 못했어요. 목록을 직접 선택해 복사해 주세요.'}
      </p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.button} onClick={onClose}>
          닫기
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={copy}>
          복사하기
        </button>
      </div>
    </Dialog>
  )
}
