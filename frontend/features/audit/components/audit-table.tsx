"use client";

import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditLog } from "@/types/api";

function hasDetails(entry: AuditLog): boolean {
  return Boolean(
    (entry.changes && Object.keys(entry.changes).length) || (entry.extra && Object.keys(entry.extra).length),
  );
}

export function AuditTable({ entries, branchLabels }: { entries: AuditLog[]; branchLabels: Record<string, string> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead className="w-44">When</TableHead>
            <TableHead>Action</TableHead>
            <TableHead className="hidden md:table-cell">Entity</TableHead>
            <TableHead className="hidden lg:table-cell">Branch</TableHead>
            <TableHead className="hidden lg:table-cell">User · Device · IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const open = expanded.has(entry.id);
            const details = hasDetails(entry);
            return (
              <Fragment key={entry.id}>
                <TableRow className="h-12">
                  <TableCell>
                    {details && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-expanded={open}
                        aria-label={open ? "Hide details" : "Show details"}
                        onClick={() => toggle(entry.id)}
                      >
                        <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{formatDateTime(entry.occurred_at)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.action.includes("failed") || entry.action.includes("reuse") ? "destructive" : "secondary"}
                      className="font-mono"
                    >
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {entry.entity_type ? `${entry.entity_type}:${shortId(entry.entity_id)}` : "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {entry.branch_id ? (branchLabels[entry.branch_id] ?? shortId(entry.branch_id)) : "—"}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                    {shortId(entry.user_id)} · {shortId(entry.device_id)} · {entry.ip_address ?? "—"}
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell />
                    <TableCell colSpan={5}>
                      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                        {JSON.stringify({ changes: entry.changes, metadata: entry.extra }, null, 2)}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
