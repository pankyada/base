export interface Project {
  id: string          // 8-char id, or the fixed string "inbox"
  user: string        // sanitized owner id
  name: string        // "Inbox", "Q3 Launch", ...
  created_at: string  // ISO timestamp
  description?: string
}
