import { Badge } from "@/components/ui/badge";

export function ActiveBadge({ active, activeLabel = "Active", inactiveLabel = "Inactive" }: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return active ? (
    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      {activeLabel}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {inactiveLabel}
    </Badge>
  );
}
