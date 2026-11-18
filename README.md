# MTB Peer Bank Deposit Rate Monitor

Public, stateless ALCO presentation generator using **only the PDFs uploaded by the user**.

## ALCO PowerPoint workflow

1. Choose a **presentation date** (this is a report label, not a source-date cutoff).
2. Upload bank rate PDFs, grouped by bank. All uploaded PDFs are accepted as sources **without verifying publication dates, effective dates or official website URLs**. No bank website search is performed.
3. Click **Proceed**. The system reads the PDF text, including local OCR fallback for scanned PDFs, and matches identifiable rates to MTB's equivalent product categories and offered tenors. Unique matches are accepted automatically; conflicting matches are not guessed.
4. Click **Generate original-format PPTs**. Download a ZIP containing the two original editable templates (11-slide FDR, 7-slide DPS) and a source-filename summary. Original formatting, logos, tables and geometry remain unchanged.
5. Where a PDF provides no identifiable, relevant comparator rate, the rate cell is **-**. The dash means **not established from the uploaded PDF**, not confirmed discontinuation of the product. **Proposed Rate** always remains blank.

The project **never saves generated reports or uploaded bank documents** and requires no account.

## Additional PDF tools

- **Screenshot → PDF:** Paste or select screenshots, arrange pages, and generate a multi-page PDF entirely in the browser. OCR adds an invisible, **extractable and searchable text layer** to each image. English OCR quality depends on image clarity and table structure; text may need checking.
- **Text → PDF:** Paste English, Bangla or other text and generate A4 PDFs entirely in the browser. English is written as selectable PDF text; Unicode uses a readable visual page with an invisible Unicode extraction layer. Text can be copied or extracted in compatible PDF readers.

## Known constraints

- Complex bank PDF tables with merged cells, amount brackets and multiple rates may not match automatically. When a rate cannot be reliably linked to an MTB product and tenor, the system uses **-** rather than inventing a value.
- Scanned PDF OCR and screenshot OCR can misread small figures; PDFs are accepted as sources regardless, but reading a figure accurately remains a technical constraint.
- Automatic OCR for Screenshot → PDF currently uses English recognition. Bangla screenshot OCR is not guaranteed, although pasted Bangla text PDFs have extractable text.
- The ALCO presentation is made by editing the actual **original template PPTX files**, not by recreating their layout.

## Code and tools

- Node.js Vercel serverless API, PDF text extraction, in-browser Tesseract OCR and in-browser Unicode text-layer PDF builder
- Original binary FDR and DPS PowerPoint templates embedded in the project
- No database, archived reports, credentialed access or bank website scraping

```sh
npm install
npx vercel dev
```

Source repository: https://github.com/AkibNizum/mtb-peer-rate-monitor
