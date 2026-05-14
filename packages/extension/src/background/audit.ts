export type AuditEntry = {
  at: string;
  tool: string;
  url?: string;
  ok: boolean;
  errorCode?: string;
};

const AUDIT_KEY = "auditLog";
const MAX_AUDIT_ENTRIES = 100;

export async function appendAuditLog(entry: Omit<AuditEntry, "at">): Promise<void> {
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] as AuditEntry[] : [];
  const next = [
    {
      at: new Date().toISOString(),
      ...entry
    },
    ...current
  ].slice(0, MAX_AUDIT_ENTRIES);

  await chrome.storage.local.set({ [AUDIT_KEY]: next });
}

export async function getAuditLog(limit = 20): Promise<{ entries: AuditEntry[] }> {
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const entries = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] as AuditEntry[] : [];
  return { entries: entries.slice(0, limit) };
}

