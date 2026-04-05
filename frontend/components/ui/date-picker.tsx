"use client";

import { format } from "date-fns";
import { it } from "date-fns/locale";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  triggerStyle?: React.CSSProperties;
}

export function DatePicker({ value, onChange, placeholder = "Seleziona data", triggerStyle }: DatePickerProps) {
  const selected = value ? new Date(value + "T00:00:00") : undefined;

  function handleSelect(date: Date | undefined) {
    if (date) onChange(format(date, "yyyy-MM-dd"));
  }

  return (
    <Popover>
      <PopoverTrigger
        style={{
          background: "rgba(16,185,129,.1)",
          border: "1px solid rgba(16,185,129,.3)",
          borderRadius: 6,
          color: "#6ee7b7",
          padding: "5px 8px",
          fontSize: ".85rem",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
          ...triggerStyle,
        }}
      >
        {selected ? format(selected, "dd/MM/yyyy") : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" side="bottom" align="start">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          locale={it}
          style={{ "--rdp-accent-color": "#6366f1", "--rdp-accent-background-color": "rgba(99,102,241,0.2)" } as React.CSSProperties}
        />
      </PopoverContent>
    </Popover>
  );
}
