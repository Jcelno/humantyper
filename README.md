# humantyper

A minimal web app for building **human-like typing profiles**.

- **Text**: paste or write anything, in Plain or Markdown, and switch to **Preview** to see it rendered.
- **Profiles**: switch between typing profiles with one click. Create, rename, duplicate or delete them.
- **Tune**: adjust speed, rhythm, pauses and mistakes for the active profile.
- **Calibrate**: type a few prompts so the profile learns your speed, pauses and mistake habits.
- **Run**: watch a mock document type your text with the active profile, including realistic mistakes and Backspace corrections.
- **Type into Google Docs**: with the small helper extension installed, the site types your text into an open Google Doc using the active profile. Markdown bold, italic, underline, strikethrough, headings and lists are applied with Docs' own shortcuts.

Everything runs in your browser, and profiles are saved in local storage. Calibration keystrokes are recorded only inside the calibration box and never leave your device.

## Use it

- Open `index.html` in a browser. There is no build step and nothing to install.
- Or host it with GitHub Pages: **Settings → Pages → Deploy from branch → `main` / root**.

## Type into Google Docs

Browsers don't let a website type into another tab, so a small Chrome extension (in `extension/`) does the typing.

**Install it (one time):**
1. Download this repository: **Code → Download ZIP**, then unzip it.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`extension`** folder.
4. Open the site at **https://jcelno.github.io/humantyper/**. The extension can't talk to a local `index.html` file. The Run tab should say **helper connected**.

**Use it:**
1. Open your Google Doc in another tab and click where the text should go.
2. On the site, paste your text, choose a profile, open the **Run** tab and click **Type into Google Doc**.
3. The site switches to your doc and starts typing after 3 seconds. Leave the keyboard and mouse alone while it types.
4. To stop, press **Esc** in the doc, click **Stop** on the site or in the extension popup, or click **Cancel** on Chrome's "started debugging this browser" bar.

**How it works and limits:**
- Chrome shows a "started debugging this browser" bar while typing. The extension uses Chrome's debugging protocol, because that produces real key events Google Docs accepts.
- For the most exact result, turn off Docs' **Tools → Preferences → Automatically detect lists**, **smart quotes** and **substitutions**.
- It only types into the most recently used `docs.google.com/document` tab.
- It sends ordinary keystrokes. It doesn't change version history or metadata, and simulated typing isn't evidence of who wrote something.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Layout and design |
| `js/engine.js` | Typing model: tempo drift, bursts, letter-pair timing, pauses, layout-aware mistakes and corrections, WPM rate control |
| `js/markdown.js` | Text → blocks, and preview rendering |
| `js/calibration.js` | Replays recorded keystrokes and estimates profile parameters |
| `js/docs.js` | Converts planned keystrokes into Google Docs actions and talks to the helper extension |
| `js/app.js` | UI and local persistence |
| `extension/` | Chrome helper extension that types into Google Docs |
