/**
 * Date and time formatting utilities.
 * Converts UTC timestamps from backend to user's local device timezone.
 */

/**
 * Format a UTC datetime string to user's local timezone.
 * 
 * @param dateString - ISO 8601 datetime string from backend (UTC)
 * @param options - Optional formatting options
 * @returns Formatted date string in user's local timezone
 * 
 * @example
 * formatDateTime("2024-08-30T14:30:00") 
 * // => "August 30, 2024 at 03:30 PM" (if user is in WAT timezone)
 */
export function formatDateTime(
  dateString: string | undefined | null,
  options?: {
    includeTime?: boolean;
    includeSeconds?: boolean;
    shortMonth?: boolean;
    shortDate?: boolean;
  }
): string {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  
  // Check if date is valid
  if (isNaN(date.getTime())) return "N/A";

  const {
    includeTime = true,
    includeSeconds = false,
    shortMonth = false,
    shortDate = false,
  } = options || {};

  // If shortDate format requested (e.g., "Dec 30, 2024")
  if (shortDate) {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: shortMonth ? "short" : "long",
      day: "numeric",
    });
  }

  // Full format with time
  if (includeTime) {
    const dateFormatOptions: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: shortMonth ? "short" : "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };

    if (includeSeconds) {
      dateFormatOptions.second = "2-digit";
    }

    return date.toLocaleString(undefined, dateFormatOptions);
  }

  // Date only (no time)
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: shortMonth ? "short" : "long",
    day: "numeric",
  });
}

/**
 * Format a date-only string (YYYY-MM-DD) to readable format.
 * 
 * @param dateString - Date string in YYYY-MM-DD format
 * @param shortMonth - Use short month names (e.g., "Dec" instead of "December")
 * @returns Formatted date string
 * 
 * @example
 * formatDateOnly("2024-08-30")
 * // => "August 30, 2024"
 */
export function formatDateOnly(
  dateString: string | undefined | null,
  shortMonth: boolean = false
): string {
  if (!dateString) return "N/A";

  // Parse YYYY-MM-DD format
  const parts = dateString.split("-");
  if (parts.length !== 3) return dateString;

  const [year, month, day] = parts;
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: shortMonth ? "short" : "long",
    day: "numeric",
  });
}

/**
 * Format time only from a datetime string.
 * 
 * @param dateString - ISO 8601 datetime string
 * @param includeSeconds - Include seconds in output
 * @returns Formatted time string
 * 
 * @example
 * formatTimeOnly("2024-08-30T14:30:00")
 * // => "03:30 PM" (if user is in WAT timezone)
 */
export function formatTimeOnly(
  dateString: string | undefined | null,
  includeSeconds: boolean = false
): string {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) return "N/A";

  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };

  if (includeSeconds) {
    options.second = "2-digit";
  }

  return date.toLocaleTimeString(undefined, options);
}

/**
 * Get relative time string (e.g., "2 hours ago", "3 days ago").
 * 
 * @param dateString - ISO 8601 datetime string
 * @returns Relative time string
 * 
 * @example
 * getRelativeTime("2024-08-30T12:00:00")
 * // => "2 hours ago"
 */
export function getRelativeTime(dateString: string | undefined | null): string {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) return "N/A";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  } else {
    return formatDateTime(dateString, { shortDate: true, includeTime: false });
  }
}
