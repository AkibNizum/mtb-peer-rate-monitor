# MTB Peer Deposit Rate Monitor

Public, minimal, one-click Excel report generator for MTB-first FDR and DPS comparisons.

- Click **Generate Excel** to download an editable `.xlsx`. No report history, cloud report archive, or saved report files.
- Pull from **official bank websites only**. Dates and sources are shown in the workbook.
- Unverified rates remain **blank**. **N/A** marks missing comparable peer products; a dash (`-`) is reserved for confirmed unavailable tenors.
- **Proposed Rate** is deliberately always blank.
- Optional PDF/JPG/PNG uploads are processed in memory to extract text for review. Uploaded material is not stored by the application.
- Rate sheets can block automation; check the **Source Review** sheet before using a report at ALCO.

## Run locally

```bash
npm install
npx vercel dev
```

The Vercel project uses Node.js 22 and a single API function at `/api`. No database and no credentials required for public report generation.

**Note:** The peer product catalog consists of comparison candidates. Verify current product availability with official bank publications before relying on it.
