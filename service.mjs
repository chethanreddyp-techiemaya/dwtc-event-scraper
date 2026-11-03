import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { monthNames } from './dwtc-parser.mjs';

export function createDwtcService({ config, renderer, logger = console }) {
  const jobs = new Map();
  let running = 0;

  const cleanup = () => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.updatedAt < now - config.resultTtlMs && job.status !== 'running') {
        jobs.delete(id);
      }
    }
  };

  function publicJob(job) {
    return {
      id: job.id,
      year: job.year,
      month: job.month,
      status: job.status,
      events: job.events,
      progress: job.progress,
      counts: job.counts,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async function run(job) {
    running++;
    const abortController = new AbortController();
    let timeoutId;

    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error('Scrape job timed out.');
          abortController.abort(error);
          reject(error);
        }, config.jobTimeoutMs);
      });

      const scrapePromise = renderer.scrape({
        year: job.year,
        month: job.month,
        signal: abortController.signal,

        onProgress: (progress) => {
          job.progress = { ...job.progress, ...progress };
          job.updatedAt = Date.now();
        },

        // Save each completed event immediately so a timeout
        // does not discard events already scraped.
        onEvent: (event) => {
          const key = event.dwtcUrl || event.name;
          const existingIndex = job.events.findIndex(
            (item) => (item.dwtcUrl || item.name) === key
          );

          if (existingIndex >= 0) {
            job.events[existingIndex] = event;
          } else {
            job.events.push(event);
          }

          job.counts.total = job.events.length;
          job.updatedAt = Date.now();
        },
      });

      const result = await Promise.race([scrapePromise, timeout]);

      job.events = Array.isArray(result.events) ? result.events : job.events;
      job.failures = result.failures || [];
      job.counts = {
        total: job.events.length,
        failed: job.failures.length,
        truncated: Boolean(result.truncated),
      };
      job.status = 'done';
      job.error = null;
    } catch (error) {
      abortController.abort(error);

      job.status = 'error';
      job.error = {
        message:
          error.message === 'Scrape job timed out.'
            ? error.message
            : 'Scraping failed. Check server logs.',
      };

      job.failures = job.failures || [];
      job.counts = {
        ...job.counts,
        total: job.events.length,
        failed: job.failures.length,
      };

      logger.error?.('Scrape job failed', {
        jobId: job.id,
        error: error.message,
        completedEvents: job.events.length,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      running--;
      job.updatedAt = Date.now();
    }
  }

  return {
    meta() {
      return { yearMin: config.yearMin, yearMax: config.yearMax };
    },

    start({ year, month }) {
      cleanup();

      if (!Number.isInteger(year) || year < config.yearMin || year > config.yearMax) {
        throw new Error(`Year must be between ${config.yearMin} and ${config.yearMax}.`);
      }

      if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new Error('Month must be between 1 and 12.');
      }

      if (running >= config.maxRunningJobs) {
        throw new Error('Too many scrape jobs are running. Try again shortly.');
      }

      const job = {
        id: randomUUID(),
        year,
        month,
        status: 'running',
        events: [],
        failures: [],
        progress: {
          phase: 'opening',
          message: 'Opening DWTC events listing...',
          done: 0,
          total: 0,
        },
        counts: { total: 0, failed: 0, truncated: false },
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      jobs.set(job.id, job);
      void run(job);
      return publicJob(job);
    },

    get(id) {
      cleanup();
      const job = jobs.get(id);
      return job
        ? { ...publicJob(job), failures: job.failures || [] }
        : null;
    },

    async export(id) {
      cleanup();
      const job = jobs.get(id);

      // Permit partial export when the job timed out after scraping events.
      if (!job || !['done', 'error'].includes(job.status)) {
        throw new Error('Scrape job not found or still running.');
      }

      if (!job.events.length) {
        throw new Error('No scraped events available to export.');
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Events', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const headers = [
        'Eventname',
        'Date',
        'Venue / halls',
        'Event type',
        'Industry',
        'Audience',
        'Organised By',
        'Event Description',
        'DWTC Event URL',
        'External Event Website',
        'Speakers',
        'Exhibitors',
        'Sponsors',
        'Host',
        'Scrape Status',
      ];

      sheet.addRow(headers);
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0B1957' },
      };

      const props = [
        'name',
        'dateText',
        'venue',
        'eventType',
        'industry',
        'audience',
        'organisedBy',
        'description',
        'dwtcUrl',
        'externalUrl',
        'speakers',
        'exhibitors',
        'sponsors',
        'host',
        'scrapeStatus',
      ];

      const widths = [30, 25, 25, 20, 25, 20, 25, 60, 45, 45, 40, 40, 40, 25, 22];

      widths.forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
      });

      for (const event of job.events) {
        sheet.addRow(
          props.map((key) => {
            let value = event[key];
            if (Array.isArray(value)) value = value.join('; ');
            value = String(value ?? '');
            return /^[=+\-@]/.test(value) ? `'${value}` : value;
          })
        );
      }

      sheet.eachRow((row, index) => {
        if (index > 1) {
          row.alignment = { vertical: 'top', wrapText: true };
        }
      });

      return {
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
        filename: `DWTC_Events_${monthNames[job.month - 1]}_${job.year}${job.status === 'error' ? '_PARTIAL' : ''}.xlsx`,
      };
    },

    async shutdown() {
      await renderer.close();
    },
  };
}