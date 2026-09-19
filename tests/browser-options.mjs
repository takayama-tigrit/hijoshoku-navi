// Explicit executable override; Linux CI uses installed Playwright Chromium.
export function browserOptions(platform = process.platform, env = process.env) {
  return env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: env.PLAYWRIGHT_EXECUTABLE_PATH }
    : platform === 'darwin' ? { channel: 'chrome' } : {};
}
