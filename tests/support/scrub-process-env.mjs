// Test isolation for every executed test file: an operator's launch environment must never select reminder
// text, reminder cadence or a worker role. Tests that exercise these seams inject or set them explicitly and
// restore them. Loaded with `node --test --import` so each child test process gets it before its first test.
for (const name of ['PI_INTERCOM_REMINDER_FILE', 'PI_INTERCOM_REMINDER_MINUTES', 'PI_ROLE_DIR', 'PI_INTERCOM_WORKER_ROLE']) delete process.env[name];
