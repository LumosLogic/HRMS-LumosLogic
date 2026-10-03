import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

/**
 * Leave balances for MANY employees in one request (GET /leaves/balance/batch) instead of one /leaves/balance request per
 * employee (measured: the Leaves page sent 107 requests per load and the Employees list 24 — and the API allows 300 requests
 * per minute per IP, shared by everyone behind the same office address).
 */
export const BALANCE_BATCH_SIZE = 400;   // ids per request (the server accepts up to 500)

/** { [userId]: { [leave_type]: balance } } for the given employee ids; an employee whose chunk failed gets {} (no chips). */
export async function fetchBalanceMap(ids, year) {
  const map = {};
  for (let i = 0; i < ids.length; i += BALANCE_BATCH_SIZE) {
    const chunk = ids.slice(i, i + BALANCE_BATCH_SIZE);
    try {
      const d = await apiGet('/leaves/balance/batch', { userIds: chunk.join(','), year });
      for (const [uid, balances] of Object.entries(d?.balances || {})) {
        map[uid] = {};
        for (const b of balances) map[uid][b.leave_type] = b;
      }
    } catch { chunk.forEach(uid => { map[uid] = {}; }); }
  }
  return map;
}

/**
 * Employees list: loads the visible page's balances with ONE request and primes the per-employee cache entries
 * (['emp-balance', id, year] — the key the profile drawer / profile page already use). Returns true once the cards may
 * read their entry: until then they do not fire their own request; if the batch fails they fall back to it.
 */
export function usePrimedBalances(ids, enabled = true) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const key = ids.join(',');
  const q = useQuery({
    queryKey: ['emp-balance-batch', key, year],
    queryFn: async () => {
      const original = new Map(ids.map(i => [String(i), i]));          // keep the id type the cards use in their key
      const d = await apiGet('/leaves/balance/batch', { userIds: key, year });
      for (const [uid, balances] of Object.entries(d?.balances || {}))
        qc.setQueryData(['emp-balance', original.get(uid) ?? uid, year], { year: d.year, balances });
      return true;
    },
    enabled: enabled && ids.length > 0 && ids.length <= BALANCE_BATCH_SIZE,
    staleTime: 5 * 60 * 1000,
  });
  return !enabled || ids.length === 0 || ids.length > BALANCE_BATCH_SIZE || q.isSuccess || q.isError;
}
