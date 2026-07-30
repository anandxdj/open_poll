"use client";

import { CardFillSelectAnswerChart } from "./CardFillSelectAnswerChart";

interface OptionCount {
  text: string;
  isCorrect: boolean;
}

interface SelectAnswerChartProps {
  options: OptionCount[];
  counts: number[];
  isReveal: boolean;
  totalParticipants?: number;
}

export function SelectAnswerChart(props: SelectAnswerChartProps) {
  return <CardFillSelectAnswerChart {...props} />;
}
