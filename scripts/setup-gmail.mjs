import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

// A real terminal is required: credentials must not be supplied through a pipe,
// command arguments, shell history, or a chat-controlled tool session.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Open this setup in a separate terminal: node scripts/setup-gmail.mjs');
  process.exitCode = 1;
} else {
  process.chdir(fileURLToPath(new URL('../', import.meta.url)));
  const ask = (prompt, hidden = false) =>
    new Promise((resolve, reject) => {
      // readline echoes exclusively to this discarded output for the secret prompt.
      const sink = hidden
        ? new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
          })
        : process.stdout;
      const reader = createInterface({
        input: process.stdin,
        output: sink,
        terminal: true,
        historySize: 0,
      });
      let answered = false;
      process.stdout.write(prompt);
      reader.once('SIGINT', () => reader.close());
      reader.once('close', () => {
        if (!answered) reject(new Error('Setup cancelled.'));
      });
      reader.question('', (answer) => {
        answered = true;
        reader.close();
        if (hidden) process.stdout.write('\n');
        resolve(answer);
      });
    });
  try {
    console.log('MotorOS Gmail setup. Do not enter your normal Google password.');
    process.env.MOTOROS_SETUP_GMAIL_ADDRESS = await ask('Gmail sending address: ');
    process.env.MOTOROS_SETUP_GMAIL_PASSWORD = await ask(
      'Google App Password (characters hidden): ',
      true,
    );
    await import('./configure-gmail.mjs');
  } catch {
    console.error('Setup cancelled or could not read terminal input. No credentials displayed.');
    process.exitCode = 1;
  } finally {
    delete process.env.MOTOROS_SETUP_GMAIL_ADDRESS;
    delete process.env.MOTOROS_SETUP_GMAIL_PASSWORD;
  }
}
