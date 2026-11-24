// Silence Lit's dev-mode notice in test output.
(globalThis as unknown as { litIssuedWarnings: Set<string> }).litIssuedWarnings = new Set(['dev-mode']);

// Arcane cards add a Google Fonts <link>; happy-dom must not try (or complain) to load it.
const hd = (globalThis as unknown as { happyDOM?: { settings: { handleDisabledFileLoadingAsSuccess: boolean } } }).happyDOM;
if (hd) hd.settings.handleDisabledFileLoadingAsSuccess = true;
