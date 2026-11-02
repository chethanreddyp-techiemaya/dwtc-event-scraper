import { useCallback, useEffect, useRef, useState } from 'react';
import './DwtcEventScraperPage.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const POLL_MS = 1500;

/** Only render http(s) URLs as links (scraped content is untrusted). */
const safeHref = (u) => {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null;
  } catch {
    return null;
  }
};

async function api(base, path, options) {
  const res = await fetch(`${base}${path}`, { credentials: 'include', ...options });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json())?.error?.message ?? message; } catch { /* non-JSON error */ }
    throw new Error(message);
  }
  return res;
}

/**
 * `apiBase` is a relative API path supplied by the host app (no secrets, no DWTC URL here).
 * Server owns the DWTC URL via DWTC_EVENTS_URL.
 */
export default function DwtcEventScraperPage({ apiBase = '/api/dwtc' }) {
  const now = new Date();
  const [bounds, setBounds] = useState(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [phase, setPhase] = useState('idle'); // idle | running | done | error
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const timer = useRef(null);

  const stopPolling = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stopPolling, []);

  useEffect(() => {
    let live = true;
    api(apiBase, '/meta').then((r) => r.json()).then((m) => {
      if (!live) return;
      setBounds(m);
      setYear((y) => Math.min(Math.max(y, m.yearMin), m.yearMax));
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [apiBase]);

  const poll = useCallback(async (id) => {
    try {
      const j = await (await api(apiBase, `/jobs/${id}`)).json();
      setJob(j);
      if (j.status === 'running') { timer.current = setTimeout(() => poll(id), POLL_MS); return; }
      if (j.status === 'done') setPhase('done');
      else { setError(j.error?.message ?? 'Scrape failed.'); setPhase('error'); }
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  }, [apiBase]);

  const start = async () => {
    stopPolling();
    setError('');
    setJob(null);
    setPhase('running');
    try {
      const j = await (await api(apiBase, '/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, month }),
      })).json();
      setJob(j);
      poll(j.id);
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await api(apiBase, `/jobs/${job.id}/export`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DWTC_Events_${MONTHS[job.month - 1]}_${job.year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const years = bounds ? Array.from({ length: bounds.yearMax - bounds.yearMin + 1 }, (_, i) => bounds.yearMin + i) : [year];
  const running = phase === 'running';
  const events = job?.events ?? [];
  const p = job?.progress;

  return (
    <section className="dwtc" aria-labelledby="dwtc-title">
      <h1 id="dwtc-title">DWTC Event Scraper</h1>

      <div className="dwtc__controls">
        <label>Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={running}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Month
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={running}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <button type="button" className="dwtc__btn dwtc__btn--primary" onClick={start} disabled={running || !bounds}>
          {running ? 'Fetching…' : 'Fetch Events'}
        </button>
        <button type="button" className="dwtc__btn" onClick={exportXlsx} disabled={phase !== 'done' || exporting || !events.length}>
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {running && (
        <div role="status" aria-live="polite" className="dwtc__progress">
          <progress value={p?.total ? p.done : undefined} max={p?.total || undefined} />
          <span>{p?.phase === 'discovering' || !p?.total ? 'Discovering events…' : `Scraping ${p.done} of ${p.total} events…`}</span>
        </div>
      )}

      {phase === 'error' && (
        <div role="alert" className="dwtc__error">
          <p>{error || 'Something went wrong.'}</p>
          <button type="button" className="dwtc__btn" onClick={start}>Retry</button>
        </div>
      )}
      {phase !== 'error' && error && <p role="alert" className="dwtc__error">{error}</p>}

      {phase === 'done' && (
        <>
          <p className="dwtc__count" data-testid="result-count">
            {events.length} {events.length === 1 ? 'event' : 'events'} for {MONTHS[job.month - 1]} {job.year}
            {job.counts?.failed ? ` · ${job.counts.failed} could not be scraped` : ''}
            {job.counts?.truncated ? ' · list truncated by server limit' : ''}
          </p>
          {events.length === 0 ? (
            <p className="dwtc__empty">No events found for this month.</p>
          ) : (
            <div className="dwtc__tablewrap">
              <table className="dwtc__table">
                <thead>
                  <tr>
                    {['Event', 'Date', 'Venue / halls', 'Type', 'Industry', 'Audience', 'Organised by', 'Speakers', 'Exhibitors', 'Sponsors', 'Host', 'Status'].map((h) => <th key={h} scope="col">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const dwtc = safeHref(e.dwtcUrl);
                    const ext = safeHref(e.externalUrl);
                    return (
                      <tr key={e.dwtcUrl}>
                        <td>
                          {dwtc ? <a href={dwtc} target="_blank" rel="noopener noreferrer">{e.name || 'Untitled'}</a> : e.name}
                          {ext && <div><a href={ext} target="_blank" rel="noopener noreferrer">Website</a></div>}
                          {e.description && <details><summary>Description</summary><p>{e.description}</p></details>}
                        </td>
                        <td>{e.dateText}</td><td>{e.venue}</td><td>{e.eventType}</td><td>{e.industry}</td>
                        <td>{e.audience}</td><td>{e.organisedBy}</td>
                        {['speakers', 'exhibitors', 'sponsors', 'host'].map((k) => (
                          <td key={k}>{e[k].length ? <details><summary>{e[k].length}</summary>{e[k].join('; ')}</details> : ''}</td>
                        ))}
                        <td className={e.scrapeStatus === 'OK' ? 'dwtc__ok' : 'dwtc__warn'}>{e.scrapeStatus}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
