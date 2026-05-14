"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { VisualizationType } from "./VisualizationPicker";

type Row = { label: string; votes: number };

const PRIMARY = "#d8ad87"; // Sandy Tan
const COLORS = [PRIMARY, "#e8c9a8", "#b8885f", "#9c704a", "#7a563a"];

interface QuestionAnalyticsProps {
  title: string;
  data: Row[];
  type: VisualizationType;
}

export function QuestionAnalytics({ title, data, type }: QuestionAnalyticsProps) {
  const chartData = useMemo(() => data.map((d) => ({ ...d })), [data]);
  const totalVotes = useMemo(() => data.reduce((sum, d) => sum + d.votes, 0), [data]);

  const renderContent = () => {
    switch (type) {
      case "bar-v":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="currentColor" className="text-white/10" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "currentColor", fontSize: 11 }}
                className="text-white/40"
                interval={0}
                height={56}
                tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 16)}…` : v)}
              />
              <YAxis
                width={36}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "currentColor", fontSize: 11 }}
                className="text-white/40"
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "#0d0d0d",
                  color: "#fff",
                  fontSize: "12px",
                }}
              />
              <Bar
                dataKey="votes"
                fill={PRIMARY}
                radius={[6, 6, 0, 0]}
                maxBarSize={48}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        );

      case "bar-h":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 32, left: 32, bottom: 8 }}
            >
              <CartesianGrid horizontal={false} stroke="currentColor" className="text-white/10" />
              <XAxis type="number" hide />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "currentColor", fontSize: 11 }}
                className="text-white/40"
                width={100}
                tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 10)}…` : v)}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "#0d0d0d",
                  color: "#fff",
                  fontSize: "12px",
                }}
              />
              <Bar
                dataKey="votes"
                fill={PRIMARY}
                radius={[0, 6, 6, 0]}
                maxBarSize={32}
                animationDuration={600}
              />
            </BarChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="votes"
                nameKey="label"
                animationDuration={800}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "#0d0d0d",
                  color: "#fff",
                  fontSize: "12px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        );

      case "list":
        return (
          <div className="flex flex-col gap-4 py-2">
            {data.map((item, i) => {
              const pct = totalVotes > 0 ? (item.votes / totalVotes) * 100 : 0;
              return (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white/70">{item.label}</span>
                    <span className="tabular-nums text-white/40">
                      {item.votes} votes ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full bg-primary"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
    }
  };

  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight text-white/90">{title}</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">
              {totalVotes} total
            </span>
          </div>
        </div>
        <div className="h-64 w-full min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={type}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="h-full w-full"
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
