# humantyper

A minimal web app for building **human-like typing profiles**.

- **Text**: paste or write anything, in Plain or Markdown, and switch to **Preview** to see it rendered.
- **Profiles**: switch between typing profiles with one click. Create, rename, duplicate or delete them.
- **Tune**: adjust speed, rhythm, pauses and mistakes for the active profile.
- **Calibrate**: type a few prompts so the profile learns your speed, pauses and mistake habits.
- **Run**: watch a mock document type your text with the active profile, including realistic mistakes and Backspace corrections.

Everything runs in your browser, and profiles are saved in local storage. Calibration keystrokes are recorded only inside the calibration box and never leave your device.

## Use it

- Open `index.html` in a browser. There is no build step and nothing to install.
- Or host it with GitHub Pages: **Settings → Pages → Deploy from branch → `main` / root**.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Layout and design |
| `js/engine.js` | Typing model: tempo drift, bursts, letter-pair timing, pauses, layout-aware mistakes and corrections, WPM rate control |
| `js/markdown.js` | Text → blocks, and preview rendering |
| `js/calibration.js` | Replays recorded keystrokes and estimates profile parameters |
| `js/app.js` | UI and local persistence |
