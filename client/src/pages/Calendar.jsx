import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { todayStr } from '@/lib/utils';
import { OrgCalendarPanel } from '@/components/OrgCalendarPanel';

/**
 * /root/calendar page — thin wrapper around the shared OrgCalendarPanel.
 *
 * Handles URL params so other pages can deep-link to a specific date:
 *   ?date=YYYY-MM-DD  (or ?date=today)
 *   ?status=present   (pre-select a filter tab in the day modal)
 */
export default function Calendar() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Eagerly parse URL params on first render so OrgCalendarPanel starts with the correct state.
  const [initConfig] = useState(() => {
    const dateParam   = searchParams.get('date');
    const statusParam = searchParams.get('status');
    if (!dateParam) return {};
    const resolved = dateParam === 'today' ? todayStr() : dateParam;
    const d = new Date(resolved + 'T12:00:00');
    if (isNaN(d.getTime())) return {};
    return {
      initialDate:      d,
      initialDayModal:  resolved,
      initialDayTab:    statusParam || null,
    };
  });

  // Remove the params from the URL after the first render (they've been consumed).
  useEffect(() => {
    if (searchParams.get('date')) setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OrgCalendarPanel
      {...initConfig}
      onViewAttendance={(empId, month, year) =>
        navigate(`/root/reports?userId=${empId}&month=${month}&year=${year}`)
      }
    />
  );
}
