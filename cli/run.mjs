
import express from "express";
import path from "node:path";
import { setupDwtc } from "../index.mjs";
import { parseMonths } from "./months.mjs";
import { exportMonthlyWorkbook } from "./export.mjs";

const input = process.argv.slice(2).join(" ");

if (!input.trim()) {
  console.error(
    'Usage: node ./cli/run.mjs "oct 2026, nov 2026"'
  );
  process.exitCode = 1;
} else {
  let months;

  try {
    months = parseMonths(input);
  } catch (error) {
    console.error(`Invalid month input: ${error.message}`);
    process.exitCode = 1;
  }

  if (months) {
    const env = {
      ...process.env,
      DWTC_EVENTS_URL:
        process.env.DWTC_EVENTS_URL || "https://www.dwtc.com/en/events/",
    };

    const dwtc = setupDwtc({
      express,
      logger: console,
      env,
    });

    const monthResults = [];

    try {
      for (const month of months) {
        console.log(`\nScraping ${month.label}...`);

        const job = dwtc.service.start({
          year: month.year,
          month: month.month,
        });

        const startedAt = Date.now();
        const timeoutMs = 10 * 60 * 1000;

        let result;
        let lastProgressDetails = "";

        while (true) {
          result = dwtc.service.get(job.id);

          if (!result) {
            throw new Error(`Could not find scrape job: ${job.id}`);
          }

          if (result.status === "done") {
            break;
          }

          if (result.status === "error") {
            throw new Error(
              result.error?.message ||
                `Scraping failed for ${month.label}`
            );
          }

          if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Scraping timed out for ${month.label}`);
          }

          if (result.progress) {
            const progressMessage =
              result.progress.message || "Scraping...";

            const progressDetails = JSON.stringify(result.progress);

            if (progressDetails !== lastProgressDetails) {
              console.log(`${month.label}: ${progressMessage}`);
              console.log(`Progress details: ${progressDetails}`);

              lastProgressDetails = progressDetails;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        const events = result.events ?? [];

        console.log(
          `Completed ${month.label}: ${events.length} events found`
        );

        if (result.failures?.length) {
          console.warn(
            `${result.failures.length} event page(s) could not be scraped for ${month.label}.`
          );
        }

        monthResults.push({
          month,
          events,
        });
      }

      const firstMonth = months[0];
      const lastMonth = months[months.length - 1];

      const outputName =
        months.length === 1
          ? `DWTC_Events_${firstMonth.year}-${String(firstMonth.month).padStart(2, "0")}.xlsx`
          : `DWTC_Events_${firstMonth.year}-${String(firstMonth.month).padStart(2, "0")}_to_${lastMonth.year}-${String(lastMonth.month).padStart(2, "0")}.xlsx`;

      const outputPath = path.resolve(process.cwd(), outputName);

      await exportMonthlyWorkbook(monthResults, outputPath);

      console.log("\nExcel export completed:");
      console.log(outputPath);
    } catch (error) {
      console.error("\nScraping failed:");
      console.error(error.message);
      process.exitCode = 1;
    } finally {
      await dwtc.shutdown();
    }
  }
}
