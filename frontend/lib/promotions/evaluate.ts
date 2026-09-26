/**
 * Promotion evaluation — a contract with the server (backend/app/modules/promotions/evaluator.py).
 * Both implementations run `shared/test-vectors/promotions.json`; change them together.
 *
 * 1. Eligible at `now` (branch local time): active, within [starts_at, ends_at), on one of
 *    `days_of_week` (ISO 1=Mon..7=Sun), inside [start_time, end_time) (a window ending before it
 *    starts spans midnight), and `branch_ids` empty or containing the branch.
 * 2. Targets ALL or a VARIANT/PRODUCT/CATEGORY/BRAND id of the line; quantity >= min_quantity.
 * 3. One promotion per line: highest priority, then largest discount, then smallest id.
 * 4. PERCENT_OFF round(gross x v/100) · AMOUNT_OFF round(min(v, price) x qty) ·
 *    FIXED_PRICE max(0, gross - round(v x qty)) · BUY_X_GET_Y round(floor(qty/(buy+get)) x get x price);
 *    never more than gross. HALF_UP to 2 decimals.
 * 5. Lines with a manual discount are skipped.
 */
import { compare, multiply, roundMoney, subtract, toBig, toMoneyString } from "@/lib/money";
import type { PromotionSync } from "@/types/sync";

export type PromoDef = Pick<PromotionSync, "id" | "kind" | "value" | "targets"> &
  Partial<
    Pick<
      PromotionSync,
      | "name"
      | "min_quantity"
      | "buy_quantity"
      | "get_quantity"
      | "starts_at"
      | "ends_at"
      | "days_of_week"
      | "start_time"
      | "end_time"
      | "branch_ids"
      | "priority"
      | "is_active"
    >
  >;

export interface PromoLine {
  lineId: string;
  variantId: string;
  productId: string;
  categoryId: string | null;
  brandId: string | null;
  quantity: string;
  unitPrice: string;
  hasManualDiscount: boolean;
}

export interface AppliedPromotion {
  lineId: string;
  promotionId: string;
  discount: string;
}

interface LocalClock {
  isoWeekday: number;
  /** Seconds since local midnight. */
  seconds: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    isoWeekday: WEEKDAYS[get("weekday")] ?? 1,
    seconds: Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  };
}

function timeSeconds(value: string): number {
  const [h = "0", m = "0", s = "0"] = value.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Math.floor(Number(s));
}

export function isEligible(promo: PromoDef, now: Date, timeZone: string, branchId: string): boolean {
  if (promo.is_active === false) return false;
  if (promo.starts_at && now.getTime() < Date.parse(promo.starts_at)) return false;
  if (promo.ends_at && now.getTime() >= Date.parse(promo.ends_at)) return false;
  const clock = localClock(now, timeZone);
  if (promo.days_of_week?.length && !promo.days_of_week.includes(clock.isoWeekday)) return false;
  if (promo.start_time && promo.end_time) {
    const start = timeSeconds(promo.start_time);
    const end = timeSeconds(promo.end_time);
    const t = clock.seconds;
    const inside = start <= end ? start <= t && t < end : t >= start || t < end;
    if (!inside) return false;
  }
  return !promo.branch_ids?.length || promo.branch_ids.includes(branchId);
}

export function targetsLine(promo: PromoDef, line: PromoLine): boolean {
  const ids: Record<string, string | null> = {
    VARIANT: line.variantId,
    PRODUCT: line.productId,
    CATEGORY: line.categoryId,
    BRAND: line.brandId,
  };
  return promo.targets.some((t) => {
    if (t.type === "ALL") return true;
    const id = ids[t.type];
    return Boolean(id) && id === t.id;
  });
}

export function lineDiscount(promo: PromoDef, line: PromoLine): string {
  const gross = roundMoney(multiply(line.unitPrice, line.quantity));
  let amount;
  switch (promo.kind) {
    case "PERCENT_OFF":
      amount = roundMoney(gross.times(toBig(promo.value)).div("100"));
      break;
    case "AMOUNT_OFF": {
      const perUnit = compare(promo.value, line.unitPrice) < 0 ? promo.value : line.unitPrice;
      amount = roundMoney(multiply(perUnit, line.quantity));
      break;
    }
    case "FIXED_PRICE": {
      const diff = subtract(gross, roundMoney(multiply(promo.value, line.quantity)));
      amount = diff.lt("0") ? toBig("0") : diff;
      break;
    }
    case "BUY_X_GET_Y": {
      const buy = toBig(promo.buy_quantity ?? "0");
      const get = toBig(promo.get_quantity ?? "0");
      if (buy.lte("0") || get.lte("0")) return "0.00";
      const bundles = toBig(line.quantity).div(buy.plus(get)).round(0, 0); // round down = floor (qty > 0)
      amount = roundMoney(bundles.times(get).times(toBig(line.unitPrice)));
      break;
    }
    default:
      return "0.00";
  }
  return toMoneyString(amount.gt(gross) ? gross : amount);
}

export function evaluatePromotions(
  lines: PromoLine[],
  promotions: PromoDef[],
  opts: { now: Date; timeZone: string; branchId: string },
): AppliedPromotion[] {
  const eligible = promotions.filter((p) => isEligible(p, opts.now, opts.timeZone, opts.branchId));
  const applied: AppliedPromotion[] = [];
  for (const line of lines) {
    if (line.hasManualDiscount) continue;
    const candidates = eligible
      .filter((p) => targetsLine(p, line) && compare(line.quantity, p.min_quantity ?? "1") >= 0)
      .map((p) => ({ promo: p, discount: lineDiscount(p, line) }))
      .filter((c) => compare(c.discount, "0") > 0);
    if (candidates.length === 0) continue;
    candidates.sort(
      (a, b) =>
        (b.promo.priority ?? 0) - (a.promo.priority ?? 0) ||
        compare(b.discount, a.discount) ||
        (a.promo.id < b.promo.id ? -1 : a.promo.id > b.promo.id ? 1 : 0),
    );
    applied.push({ lineId: line.lineId, promotionId: candidates[0].promo.id, discount: candidates[0].discount });
  }
  return applied;
}
