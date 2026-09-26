"""Report periods in the company's local time.

A report for "2026-09-26" in Asia/Manila means [2026-09-26 00:00 +08:00, 2026-09-27 00:00 +08:00),
not a UTC day. Boundaries are computed here once and passed to SQL as UTC timestamps, so indexes
on `occurred_at` are used. Grouping by local day/hour uses `occurred_at AT TIME ZONE :tz`.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.shared.exceptions import BusinessRuleError

MAX_DAYS = 400


@dataclass(frozen=True, slots=True)
class Period:
    date_from: date
    date_to: date  # inclusive
    timezone: str

    @property
    def start(self) -> datetime:
        return datetime.combine(self.date_from, time.min, ZoneInfo(self.timezone)).astimezone(UTC)

    @property
    def end(self) -> datetime:
        """Exclusive end: midnight after `date_to`, local time."""
        next_day = self.date_to + timedelta(days=1)
        return datetime.combine(next_day, time.min, ZoneInfo(self.timezone)).astimezone(UTC)


def make_period(date_from: date | None, date_to: date | None, timezone: str) -> Period:
    today = datetime.now(ZoneInfo(timezone)).date()
    date_to = date_to or today
    date_from = date_from or date_to
    if date_from > date_to:
        raise BusinessRuleError("date_from must not be after date_to", code="report.invalid_period")
    if (date_to - date_from).days > MAX_DAYS:
        raise BusinessRuleError(
            f"Report periods are limited to {MAX_DAYS} days", code="report.period_too_long"
        )
    return Period(date_from, date_to, timezone)
