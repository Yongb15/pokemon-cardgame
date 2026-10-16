import type { SellerBadge } from '../api/account'

/** Buyers, not sales: only sales to different buyers count (docs/auction/seller-badge.md, Security B-2) */
export const BADGE_LABEL: Record<NonNullable<SellerBadge['badge']>, string> = {
  first: '첫 판매',
  sold1: '구매자 1명+',
  sold5: '구매자 5명+',
  sold20: '구매자 20명+',
}
export const BADGE_HELP = '서로 다른 구매자에게 팔린 경매 수 구간이에요. 가입 7일 미만이면 "새 회원"이 함께 보여요.'
