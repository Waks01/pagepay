/**
 * Export data to CSV file
 * @param data - Array of objects to export
 * @param filename - Name of the CSV file (without extension)
 * @param columns - Optional: specify which columns to export and their order
 */
export function exportToCsv<T extends Record<string, any>>(
  data: T[],
  filename: string,
  columns?: { key: keyof T; label: string }[],
) {
  if (!data || data.length === 0) {
    console.warn("No data to export");
    return;
  }

  // Determine columns
  const cols = columns || Object.keys(data[0]).map((key) => ({ key, label: key }));

  // Create CSV headers
  const headers = cols.map((col) => escap

eCsvValue(col.label)).join(",");

  // Create CSV rows
  const rows = data.map((row) => {
    return cols
      .map((col) => {
        const value = row[col.key];
        return escapeCsvValue(value);
      })
      .join(",");
  });

  // Combine headers and rows
  const csv = [headers, ...rows].join("\n");

  // Create blob and download
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Escape CSV values to handle special characters
 */
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  // Convert to string
  let str = String(value);

  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Export table data with custom formatting
 */
export function exportTableToCsv(
  data: any[],
  filename: string,
  formatters?: Record<string, (value: any) => string>,
) {
  if (!data || data.length === 0) {
    console.warn("No data to export");
    return;
  }

  const formattedData = data.map((row) => {
    const formatted: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      formatted[key] = formatters?.[key] ? formatters[key](value) : value;
    }
    return formatted;
  });

  exportToCsv(formattedData, filename);
}
