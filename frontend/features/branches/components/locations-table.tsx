"use client";

import { MoreHorizontalIcon, StarIcon } from "lucide-react";
import { toast } from "sonner";

import { ActiveBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api/errors";
import type { StockLocation, StockLocationUpdate } from "@/types/api";

import { useUpdateLocation } from "../api";
import { LOCATION_TYPES } from "./location-form-dialog";

const typeLabel = (type: string) => LOCATION_TYPES.find((t) => t.value === type)?.label ?? type;

export function LocationsTable({
  branchId,
  locations,
  canManage,
}: {
  branchId: string;
  locations: StockLocation[];
  canManage: boolean;
}) {
  const update = useUpdateLocation(branchId);

  const change = (location: StockLocation, data: StockLocationUpdate, message: string) =>
    update.mutate(
      { id: location.id, data },
      { onSuccess: () => toast.success(message), onError: (error) => toast.error(errorMessage(error)) },
    );

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Type</TableHead>
            <TableHead className="w-28">Status</TableHead>
            {canManage && <TableHead className="w-12" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.map((location) => (
            <TableRow key={location.id} className="h-12">
              <TableCell className="font-mono font-medium">{location.code}</TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  {location.name}
                  {location.is_default && (
                    <Badge variant="secondary">
                      <StarIcon className="size-3" /> Default
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{typeLabel(location.location_type)}</TableCell>
              <TableCell>
                <ActiveBadge active={location.is_active} />
              </TableCell>
              {canManage && (
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${location.code}`} />}>
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={location.is_default || !location.is_active}
                        onClick={() => change(location, { is_default: true }, `${location.code} is now the default location`)}
                      >
                        Set as default
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={location.is_default}
                        onClick={() =>
                          change(
                            location,
                            { is_active: !location.is_active },
                            `${location.code} ${location.is_active ? "deactivated" : "activated"}`,
                          )
                        }
                      >
                        {location.is_active ? "Deactivate" : "Activate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
