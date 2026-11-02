
import ExcelJS from "exceljs";

const HEADERS = [
  "Eventname",
  "Date",
  "Venue / halls",
  "Event type",
  "Industry",
  "Audience",
  "Organised By",
  "Event Description",
  "DWTC Event URL",
  "External Event Website",
  "Speakers",
  "Exhibitors",
  "Sponsors",
  "Host",
  "Scrape Status",
];

const PROPERTIES = [
  "name",
  "dateText",
  "venue",
  "eventType",
  "industry",
  "audience",
  "organisedBy",
  "description",
  "dwtcUrl",
  "externalUrl",
  "speakers",
  "exhibitors",
  "sponsors",
  "host",
  "scrapeStatus",
];

const COLUMN_WIDTHS = [
  30, 25, 25, 20, 25, 20, 25, 60,
  45, 45, 40, 40, 40, 25, 22,
];

function formatCellValue(value) {
  if (Array.isArray(value)) {
    value = value.join("; ");
  }

  value = String(value ?? "");

  // Prevent Excel formula injection.
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }

  return value;
}

export async function exportMonthlyWorkbook(monthResults, outputPath) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "DWTC Events Scraper";
  workbook.created = new Date();

  for (const { month, events } of monthResults) {
    const worksheet = workbook.addWorksheet(month.label);

    worksheet.views = [
      {
        state: "frozen",
        ySplit: 1,
      },
    ];

    worksheet.addRow(HEADERS);

    const headerRow = worksheet.getRow(1);

    headerRow.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };

    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0B1957" },
    };

    COLUMN_WIDTHS.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    for (const event of events) {
      const row = PROPERTIES.map((property) =>
        formatCellValue(event[property])
      );

      worksheet.addRow(row);
    }

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = {
          vertical: "top",
          wrapText: true,
        };
      }
    });

    worksheet.autoFilter = {
      from: {
        row: 1,
        column: 1,
      },
      to: {
        row: 1,
        column: HEADERS.length,
      },
    };
  }

  await workbook.xlsx.writeFile(outputPath);

  return outputPath;
}
