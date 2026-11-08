const test = Bun.spawn([process.env.BROWSER_TEST_PYTHON || 'python3', 'scripts/test-browser-match.py'], {
  env: process.env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exitCode = await test.exited
