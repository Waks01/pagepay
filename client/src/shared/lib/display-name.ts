/**
 * Derive a friendly display name from a user record.
 *
 * Phase 1 identities are email or phone (no `name` column). We derive the
 * greeting locally — this string is only used for copy, never round-tripped
 * to the server. Sharing one helper between the Home tab and the Profile
 * tab means the rules stay in sync (e.g. "first email local part, title
 * case" applies to both greetings).
 */
export type DisplayNameUser = {
  email?: string | null;
  phone?: string | null;
};

export function displayName(me: DisplayNameUser | null | undefined): string {
  if (!me) return 'there';
  const raw = me.email || me.phone || '';
  if (!raw) return 'there';
  // Email: take the part before '@', capitalize first letter.
  // Phone: show last 4 digits prefixed with a friendly name.
  if (raw.includes('@')) {
    const local = raw.split('@')[0];
    const cleaned = local.split(/[._-]/)[0] || local;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return `reader ${raw.slice(-4)}`;
}

/**
 * Two-letter avatar fallback for the Profile header. Takes the first
 * non-empty letter from the email local-part (or the phone's last two
 * digits) and uppercases both. Falls back to "PP" (PagePay) if there's
 * nothing to derive from.
 */
export function initials(me: DisplayNameUser | null | undefined): string {
  if (!me) return 'PP';
  const source = (me.email || me.phone || '').trim();
  if (!source) return 'PP';
  const head = source.includes('@') ? source.split('@')[0] : source;
  const letters = head.replace(/[^a-zA-Z0-9]/g, '');
  if (letters.length >= 2) {
    return (letters[0] + letters[1]).toUpperCase();
  }
  if (letters.length === 1) {
    return (letters[0] + letters[0]).toUpperCase();
  }
  return 'PP';
}