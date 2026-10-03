// React Query freshness tiers. The app-wide default (main.jsx) stays at 3 minutes — "normal". Queries whose data
// changes faster or must be exact set a SHORTER tier; data that rarely changes sets a longer one. Pick the tier by what
// the data IS, not by how often it is requested.
//
//   realtime   approvals, notification count, device / sync status          15 s  (and/or refetchInterval)
//   frequent   dashboards, attendance incl. today, leave / regularization /  60 s
//              expense lists — other users change these at any moment
//   normal     (default, do not set) employee lists, ordinary reports        3 min
//   static     branches, departments, designations — reference data          10 min
//   config     org / payroll / statutory settings, work schedule, leave      10 min  — ALWAYS paired with
//              policies, shifts, holidays                                            invalidateQueries on the save mutation
//
// A longer tier is only safe because the mutation that edits the data invalidates its key. Branch-dependent keys carry the
// selected branch; organisation-level keys do not (see lib/queryScopes.js).
export const STALE = {
  realtime: 15 * 1000,
  frequent: 60 * 1000,
  static:   10 * 60 * 1000,
  config:   10 * 60 * 1000,
};
