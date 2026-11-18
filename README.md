# MTB Peer Bank Deposit Rate Monitor

Public, stateless ALCO presentation generator for Mutual Trust Bank's FDR and DPS peer comparisons.

## How to use

1. Open the website and choose the **as-of report date**.
2. Optionally upload official **bank-issued PDFs, JPGs or PNG screenshots**, grouped by bank. This is particularly useful when bank webpages are dynamic or block automated access.
3. Click **Proceed — review rate data**. The app checks latest discoverable eligible official rate sheets and reads your uploaded evidence.
4. Review source statuses. Optionally confirm clearly matched OCR suggestions or manually enter rates from official uploaded documents.
5. Click **Generate editable PPT** to download a single PowerPoint containing FDR and DPS comparisons and a Source Documents slide.

The app also retains the previous on-demand Excel export endpoint. No archive, accounts, login, database, report history or report file storage are required.

## Accuracy policy

- **MTB is the reference bank** and defines products and comparison tenors.
- **Current official bank sources only.** For a selected report date, use the latest discoverable rate sheet effective on or before that date. Publication date is not automatically equated with effective date.
- **Proposed Rate is always blank** in both reports and API data.
- An absent peer product displays **N/A** in the comparable product label.
- Confirmed missing peer tenor displays **-**.
- If a rate cannot be confidently verified, its rate cell remains **blank**.
- Screenshot OCR is not reliable for merged cells, deposit-size brackets, long tables, or low-resolution photos. Uploaded files create candidates; values are included only after user review/confirmation.
- A PowerPoint generated from incomplete evidence is a **working draft**, not an ALCO-verified final document.

## Technology

- Vercel serverless Node.js API, ExcelJS and PptxGenJS
- Official HTML/PDF collection with bank-specific extractors
- PDF parsing in ephemeral server memory; screenshot OCR locally in the browser (Tesseract.js)
- In-memory generation and direct PPTX download

The current PowerPoint export follows the earlier 11-slide FDR / 7-slide DPS product sequence and MTB green-table visual conventions, plus a source-evidence slide. **It does not embed the binary original PowerPoint template**; further pixel-perfect template reproduction would require incorporating the master template file into the deployment.

## Run locally

```sh
npm install
npx vercel dev
```

The public project is maintained at [AkibNizum/mtb-peer-rate-monitor](https://github.com/AkibNizum/mtb-peer-rate-monitor).
