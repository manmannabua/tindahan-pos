const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(new Date(value));
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
