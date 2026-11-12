# Chrome Web Store listing — YAB3D for MakerWorld

Last updated: 12 November 2026.

## Store listing

**Name:** YAB3D for MakerWorld

**Short description:** Open MakerWorld projects in YAB3D to prepare colours and plates, convert them to Snapmaker U1 files, and let YAB3D set your U1's filament slots.

**Detailed description:**

Open original MakerWorld projects in YAB3D to prepare their colours and plates, or convert a print profile directly into a Snapmaker U1 project.

FEATURES

• Open the original 3MF in YAB3D's Analyse & convert or Full Spectrum workspace.
• Review colours, edit objects and arrange plates in the YAB3D web app.
• Convert MakerWorld print profiles into Snapmaker U1 files in your browser.
• Choose conversion preferences and import your own printer profiles.
• Keep the model file on your device during conversion and transfer.
• Optional: let the YAB3D web app read your Snapmaker U1's filament slots and set their colour and type labels, after you allow that one printer.

HOW TO USE

1. Open a MakerWorld model and choose a print profile.
2. Choose a workspace beside Open in YAB3D, then click the button. Or use Convert to Snapmaker U1 for a direct conversion.
3. Complete MakerWorld sign-in or verification if requested, and allow the new YAB3D tab.
4. Review the project and settings. Download it and check the sliced result before printing.

PRIVACY

Model conversion runs in your browser. Opening YAB3D passes the original file directly to its browser tab; the extension does not upload the model to a server. Chrome may sync conversion preferences when browser sync is enabled. Custom printer profiles stay in local extension storage. There is no advertising or automatic telemetry.

PERMISSIONS

Access is limited to MakerWorld's .com and .com.cn sites so the extension can add its controls and capture a download you request. Storage remembers your preferences. Downloads saves converted project files. On yab3d.uk the extension only passes printer requests you start there. Access to a printer is optional: it is asked for one address at a time, on a page that names the address, and only after you press Check U1 in YAB3D.

SUPPORT

https://github.com/rendez2k/yab3u1/issues
hello@productkit.digital

Independent community extension. Not affiliated with or endorsed by MakerWorld, Bambu Lab or Snapmaker. Based on the MakerWorld to Snapmaker U1 extension; upstream licences and credits are included.

Version 1.5.4.0 adds the optional printer connection for the YAB3D web app. Version 1.5.3.7 opened the production YAB3D Workbench and updated the privacy information.

**Category:** Workflow and planning.

**Single purpose:** Prepare user-selected MakerWorld 3MF projects for printing on a Snapmaker U1: open them in YAB3D, convert them locally, and set the printer's filament slots to match the prepared project.

**Primary language:** English (United Kingdom).

## Graphics

| Asset | Dimensions | Status | File |
| --- | --- | --- | --- |
| Store icon | 128 × 128 | Uploaded; inherited U1 converter icon | extensions/makerworld-yab3d/assets/icons/icon128.png |
| Screenshot | 1280 × 800 JPEG | Uploaded and accepted; production Workbench 2.6.38 with the built-in four-colour support arch | docs/store-assets/workbench-2.6.38-1280x800.jpg |

The screenshot demonstrates the destination web workspace. It uses the public built-in sample, not a user's private model. Optional promotional tiles were not supplied.

## Permissions justification

| Permission | Why it is needed |
| --- | --- |
| downloads | Save user-requested converted 3MF projects; the bundled background download handler uses Chrome's download API. |
| storage | Remember conversion options and print-profile preferences using Chrome sync storage; keep user-imported printer profiles in local storage. |
| https://makerworld.com/* | Add the model-page controls, observe the user's original project download and transfer it to YAB3D or convert it locally. |
| https://makerworld.com.cn/* | The same narrowly scoped functionality on MakerWorld's Chinese site. |
| Content script on https://yab3d.uk/* | Relays printer requests that the user starts in the YAB3D web app to the extension. It reads nothing else from the page and changes nothing on it. |
| Optional host permission http://*/* | A web page cannot contact a printer on the user's home network; the extension can. The permission is never requested at install. When the user presses Check U1 in YAB3D, the extension opens its own page naming that one private address (for example http://192.168.1.31) and requests access to that origin only. The broad pattern is declared because a match pattern cannot express "private IPv4 addresses", and the address is not known in advance. Code refuses anything that is not a private IPv4 address. Requests are limited to reading printer state and filament slots, and one command that sets a slot's filament colour and type label. |

All executable extension code is bundled. Remote requests obtain model files, open the user-selected YAB3D website, or contact the one printer the user allowed; no fetched code is evaluated inside the extension.

## Privacy and data use

The extension handles website content (model titles, user-requested 3MF files and filenames) for its stated purpose. It does not upload those files to a server; an explicit Open in YAB3D action transfers them to a YAB3D tab on the same device. Settings may be synchronised by Chrome. No identity, health, financial, authentication, communications, location, browsing-history or user-activity data is collected for the publisher. Do not claim that no information ever leaves the device: normal website requests and optional Chrome preference sync still occur.

Dashboard disclosure: website content handled for the core purpose; disclose no unrelated data categories. No data is sold, used for unrelated purposes or used for creditworthiness/lending.

**Privacy URL:** https://yab3d.uk/extension-privacy.html

## Distribution and developer

Public; all supported regions; free.

Automatic publication after review is enabled.

Publisher: r2k. Contact: hello@productkit.digital (already published on the YAB3D site). Homepage: https://yab3d.uk/. Support: https://github.com/rendez2k/yab3u1/issues.

## Version history and review

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 1.5.3.7 | 2026-11-04 | Production Workbench handoff, clear fork name and updated privacy policy | Submitted; dashboard showed Pending review on 4 November |
| 1.5.4.0 | 2026-11-12 | Optional printer connection for the YAB3D web app: content script on yab3d.uk, optional host permission requested per printer | **Not submitted.** Package built; the dashboard fields above need updating by the account holder |

Package: web/downloads/makerworld-yab3d-1.5.4.0.zip. Rebuild with `node tools/build_chrome_extension.mjs`.

Store item ID: `cbgaablimljekipakmeflccalaodkfcf`.

Dashboard: https://chrome.google.com/webstore/devconsole/cd9f36a0-cb33-4e30-9299-ff472ec72a44/cbgaablimljekipakmeflccalaodkfcf/edit

Submission verified in the signed-in dashboard on 4 November 2026: the confirmation read "Your extension was submitted for review" and the item status changed to "Pending review". This is not an approval or confirmation that the public listing is live. The uploaded package was verified as 1.5.3.7 with downloads, storage and host permissions.

Saved disclosures: single purpose and all permission explanations; no remote code; website content only; all three limited-use certifications; live privacy policy URL. Distribution was verified as free, public and all regions.

### Reviewer instructions

Saved in the dashboard (464 characters; no account credentials supplied):

> No YAB3D account is required. Open a MakerWorld model with a print profile. Use the workspace selector beside Open in YAB3D, then that button; allow the new tab. MakerWorld may require its own sign-in or verification to download. Alternatively use Convert to Snapmaker U1. Conversion and tab transfer are local; nothing is sent to a printer. Settings are available through the extension Options page. Public sample projects are also available at https://yab3d.uk/.

Limitations: MakerWorld sign-in/verification remains under the user's control; popup permission may be needed; YAB3D handoff accepts projects up to 96 MiB. A live authenticated MakerWorld download and store review remain to be checked. No printer actions are triggered by this extension. Upstream MIT and derived PolyForm Noncommercial notices remain included; this package is distributed free and does not remove those conditions.

### What to change in the dashboard for 1.5.4.0

1. Package: upload `web/downloads/makerworld-yab3d-1.5.4.0.zip`.
2. Store listing: the short description, the new feature line and the PERMISSIONS paragraph above.
3. Privacy practices: the single purpose above; add the two new permission justifications (content script on yab3d.uk, optional host permission); data use is unchanged apart from the printer's filament slot information, which is read from the user's own printer and shown to them, and is not sent to any server.
4. Reviewer instructions, to add: "Printer connection (optional): on yab3d.uk open a model, choose Full Spectrum blends, go to step 3 and open Send filament setup to U1. Enter a private address such as 192.168.1.50 and press Check U1. The extension opens a page asking to allow that address. Without a Snapmaker U1 on the network the check then reports that the printer cannot be reached."
