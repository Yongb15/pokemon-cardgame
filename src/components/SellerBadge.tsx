import type { SellerBadge as Badge } from '../api/account'
import { BADGE_HELP, BADGE_LABEL } from '../lib/sellerBadge'
import styles from './SellerBadge.module.css'

/** The seller's record: a bucket and a new-member mark, nothing that names or counts them exactly (A-3) */
export default function SellerBadge({ badge }: { badge: Badge | null }) {
  // Always the same box, so the badge arriving later moves nothing (CLS)
  return (
    <span className={styles.badges} title={BADGE_HELP}>
      {badge?.badge && <span className={styles.badge}>{BADGE_LABEL[badge.badge]}</span>}
      {badge?.newMember && <span className={styles.newMember}>새 회원</span>}
    </span>
  )
}
