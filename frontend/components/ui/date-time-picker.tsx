"use client"

import * as React from "react"
import { format, parse, startOfDay } from "date-fns"
import { Calendar as CalendarIcon, Clock } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  TimePicker,
  TimePickerContent,
  TimePickerHour,
  TimePickerInput,
  TimePickerInputGroup,
  TimePickerMinute,
  TimePickerPeriod,
  TimePickerSeparator,
  TimePickerTrigger,
} from "@/components/ui/time-picker"

interface DateTimePickerProps {
  value?: string // YYYY-MM-DDTHH:mm
  onChange: (value: string) => void
  disabled?: boolean
}

export function DateTimePicker({ value, onChange, disabled }: DateTimePickerProps) {
  // Parse internal states from the value prop
  const dateValue = React.useMemo(() => {
    if (!value) return undefined
    try {
      return parse(value, "yyyy-MM-dd'T'HH:mm", new Date())
    } catch (e) {
      return undefined
    }
  }, [value])

  const timeValue = React.useMemo(() => {
    if (!value) return "12:00"
    try {
      const d = parse(value, "yyyy-MM-dd'T'HH:mm", new Date())
      return format(d, "HH:mm")
    } catch (e) {
      return "12:00"
    }
  }, [value])

  const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return
    const currentT = timeValue
    const [h, m] = currentT.split(":")
    const updated = new Date(newDate)
    updated.setHours(parseInt(h), parseInt(m))
    onChange(format(updated, "yyyy-MM-dd'T'HH:mm"))
  }

  const handleTimeChange = (newTime: string) => {
    const targetDate = dateValue || new Date()
    // Dice UI might return "--:--" if cleared
    if (newTime.includes("--")) return
    
    const [h, m] = newTime.split(":")
    const updated = new Date(targetDate)
    updated.setHours(parseInt(h), parseInt(m))
    onChange(format(updated, "yyyy-MM-dd'T'HH:mm"))
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {/* Date Picker */}
      <div className="flex-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              disabled={disabled}
              className={cn(
                "w-full justify-start text-left font-medium rounded-2xl h-12 border-border bg-secondary/10 px-4 transition-all hover:bg-secondary/20 focus:ring-primary/20",
                !dateValue && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4 text-primary/70" />
              {dateValue ? format(dateValue, "PPP") : "Set date..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 rounded-3xl border-border bg-card shadow-2xl" align="start">
            <Calendar
              mode="single"
              selected={dateValue}
              onSelect={handleDateSelect}
              disabled={(d) => d < startOfDay(new Date())}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Time Picker */}
      <div className="flex-1">
        <TimePicker 
          value={timeValue} 
          onValueChange={handleTimeChange} 
          disabled={disabled}
          openOnFocus
        >
          <TimePickerInputGroup className="h-12 w-full rounded-2xl bg-secondary/10 border-border px-4 transition-all hover:bg-secondary/20 focus-within:ring-primary/20">
            <Clock className="size-4 mr-2 text-primary/70" />
            <TimePickerInput segment="hour" className="text-sm font-semibold" />
            <TimePickerSeparator className="text-muted-foreground/30 font-bold" />
            <TimePickerInput segment="minute" className="text-sm font-semibold" />
            <TimePickerInput segment="period" className="text-[10px] font-black uppercase tracking-tighter" />
            <TimePickerTrigger className="ml-auto" />
          </TimePickerInputGroup>
          <TimePickerContent className="rounded-2xl border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex p-3 gap-1">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">Hrs</span>
                <TimePickerHour className="scrollbar-none h-[180px] w-12" />
              </div>
              <div className="w-px bg-border/40 mx-1 my-6" />
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">Min</span>
                <TimePickerMinute className="scrollbar-none h-[180px] w-12" />
              </div>
              <div className="w-px bg-border/40 mx-1 my-6" />
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">AM/PM</span>
                <TimePickerPeriod className="scrollbar-none h-[180px] w-14" />
              </div>
            </div>
          </TimePickerContent>
        </TimePicker>
      </div>
    </div>
  )
}
