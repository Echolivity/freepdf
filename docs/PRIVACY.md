# FreePDF privacy policy

_Applies to version 1.0.0. The in-app "How it works" page (`/privacy`) says the same thing in English
and Arabic._

## Your documents

- **Processing:** PDFs and images you add are processed **inside your browser tab**, on your device.
  They are never uploaded to FreePDF or to anyone else.
- **What the app loads:** its only network requests are for its own code, fonts and PDF.js data files,
  all from the same site.
- **What the browser blocks:** the Content-Security-Policy tells your browser to refuse connections to
  any other website.
- **What CSP can't block:** requests to the site itself. Those are covered by design: the app never
  sends file data, and the hosting has no endpoint that accepts uploads.
- **How results are kept:** results exist only in the tab's memory as temporary files.
  - Previews are released when you press "Start over" or leave the tool.
  - Download links are released 30 seconds after the download starts.
  - Closing the tab releases everything.
- **No retention elsewhere:** document contents are never written to browser storage.

## What is stored in your browser

FreePDF writes exactly three entries to `localStorage` on your device. They are never sent anywhere.

| Key | Contents | When it's written |
|-----|----------|-------------------|
| `freepdf:theme` | `light` or `dark` | When you change the theme |
| `freepdf:lang` | `en` or `ar` | When you change the language |
| `freepdf:recent` | Names of up to 6 tools you opened recently, e.g. `["merge-pdf","split-pdf"]`. **Never** file names or document data. | When you open a tool |

No cookies, sessionStorage, IndexedDB, Cache Storage or service workers are used.

To clear these entries, go to **How it works → Clear these settings**. The home page's **Clear** button
removes the recent list only. Your browser's "clear site data" also removes them.

## Document scripts

PDFs can contain JavaScript. FreePDF never runs it: PDF.js scripting is disabled, and its script
sandbox isn't even shipped with the site. Output files can keep scripts the input had (FreePDF
doesn't strip them); whether they run depends on the viewer you open the result in.

## Analytics, advertising, accounts

None. FreePDF has no analytics or tracking scripts, no advertising, no accounts and no third-party fonts
or CDNs.

The hosting provider (Cloudflare) handles network requests for the site's files, as any web host
does. Its standard request logs are covered by Cloudflare's own policy. They never contain document
data, because no document data is sent.

## Passwords

When you open a password-protected PDF in **PDF to JPG/PNG**, the password is used only in that tab to
decrypt the file locally. It is never stored or transmitted.

## How this is verified

The automated browser tests run with a global privacy guard (`tests/e2e/fixtures.ts`). It fails any test
in which:
- the app contacts another origin;
- the app sends a non-GET request or any request body;
- the app requests an unexpected path or a URL with a query string;
- an analytics host is contacted;
- a CSP violation occurs;
- the page or one of its workers writes a file name or document content to the console;
- browser storage contains anything beyond the three entries above.

Page titles, URLs and browser history only ever contain tool names, never file names.

`tests/e2e/security.spec.ts` checks that a PDF carrying JavaScript (in its open action, document-level
scripts, page actions and links) is rendered and processed without any of it running.
