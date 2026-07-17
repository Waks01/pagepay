import { useState } from "react";

export type DateRangePreset = "today" | "7d" | "30d" | "90d" | "custom";

interface DateRangePickerProps {
  value: {
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
  };
  onChange: (value: {
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
  }) => void;
  className?: string;
}

export function DateRangePicker({
  value,
  onChange,
  className = "",
}: DateRangePickerProps) {
  const [showCustom, setShowCustom] = useState(value.preset === "custom");

  const handlePresetChange = (preset: DateRangePreset) => {
    if (preset === "custom") {
      setShowCustom(true);
      onChange({ preset, startDate: "", endDate: "" });
    } else {
      setShowCustom(false);
      onChange({ preset });
    }
  };

  const presets: { value: DateRangePreset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7d", label: "Last 7 Days" },
    { value: "30d", label: "Last 30 Days" },
    { value: "90d", label: "Last 90 Days" },
    { value: "custom", label: "Custom Range" },
  ];

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.value}
            onClick={() => handlePresetChange(preset.value)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              value.preset === preset.value
                ? "bg-primary text-white"
                : "bg-bg-muted text-text-muted hover:bg-bg-hover hover:text-text-main"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {showCustom && (
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-text-muted">
              Start Date
            </label>
            <input
              type="date"
              value={value.startDate || ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  startDate: e.target.value,
                })
              }
              className="rounded-md border border-border bg-bg-main px-3 py-1.5 text-sm text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-text-muted">
              End Date
            </label>
            <input
              type="date"
              value={value.endDate || ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  endDate: e.target.value,
                })
              }
              className="rounded-md border border-border bg-bg-main px-3 py-1.5 text-sm text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to convert preset to actual dates
export function getDateRangeFromPreset(preset: DateRangePreset): {
  startDate: string;
  endDate: string;
} {
  const end = new Date();
  const start = new Date();

  switch (preset) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    default:
      // For custom, return empty strings (will be set by user)
      return { startDate: "", endDate: "" };
  }

  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}
