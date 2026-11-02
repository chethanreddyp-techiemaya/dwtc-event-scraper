
import express from "express";
import { setupDwtc } from "./index.mjs";

const dwtc = setupDwtc({
  express,
  logger: console,
  env: {
    ...process.env,
    DWTC_EVENTS_URL: "https://www.dwtc.com/en/events/",
  },
});

try {
  const year = Number(process.env.SCRAPE_YEAR || 2026);
  const month = Number(process.env.SCRAPE_MONTH || 10);

  console.log(`Starting DWTC scrape: ${year}-${month}`);

  const job = dwtc.service.start({ year, month });
  console.log("Job ID:", job.id);
  console.log("Initial status:", job.status);

  let result;

  for (let attempt = 0; attempt < 600; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    result = dwtc.service.get(job.id);

    if (!result) {
      throw new Error("Scrape job expired or could not be found.");
    }

    if (attempt % 5 === 0) {
      console.log("Status:", result.status, "Progress:", result.progress);
    }

    if (result.status === "done" || result.status === "error") {
      break;
    }
  }

  if (!result || result.status === "running") {
    throw new Error("Scrape job did not finish within 10 minutes.");
  }

  if (result.status === "error") {
    throw new Error(result.error?.message || "Scraping failed.");
  }

  console.log("\nEvents extracted:", result.counts.total);
  console.log("Failures:", result.counts.failed);
  console.log("Truncated:", result.counts.truncated);

  console.log("\nEvent details:");
  console.log(JSON.stringify(result.events, null, 2));

  if (result.failures?.length) {
    console.log("\nFailures:");
    console.log(JSON.stringify(result.failures, null, 2));
  }

  // Export the completed job to Excel.
  const file = await dwtc.service.export(job.id);
  const { writeFile } = await import("node:fs/promises");

  await writeFile("DWTC_Events_Test.xlsx", file.buffer);

  console.log("\nExcel file created: DWTC_Events_Test.xlsx");
} catch (error) {
  console.error("Scrape failed:", error);
  process.exitCode = 1;
} finally {
  await dwtc.shutdown();
}
