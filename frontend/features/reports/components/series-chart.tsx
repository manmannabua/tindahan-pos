"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatMoney } from "@/lib/money";

/** Bar chart of a money series. Values are display-only numbers (no arithmetic on them). */
export function SeriesChart({ points, height = 240 }: { points: { x: string; y: number }[]; height?: number }) {
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Sales chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.2} />
          <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(v: number) => v.toLocaleString("en-PH")} />
          <Tooltip
            cursor={{ fillOpacity: 0.08 }}
            formatter={(value) => formatMoney(Number(value).toFixed(2))}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey="y" name="Sales" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
