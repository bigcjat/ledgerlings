#!/usr/bin/env node
/**
 * Ledgerlings mainnet key setup — steps 1 and 2 of MAINNET_CUTOVER_CHECKLIST.md
 *
 *   node mainnet_regularkey.cjs check    read-only. What is true on mainnet right now.
 *   node mainnet_regularkey.cjs set      SetRegularKey on the issuer.   Signed by the MASTER seed.
 *   node mainnet_regularkey.cjs test     no-op AccountSet on the issuer. Signed by the REGULARKEY seed.
 *
 * Run `check`, then `set`, then `test`. Do not skip `test`: it is the step that proves the
 * RegularKey can actually sign before you ever rely on it. If `test` fails, the RegularKey is not
 * usable and putting its seed in Railway would take the backend offline.
 *
 * asfDisableMaster is deliberately NOT implemented here. It is irreversible, it is not required to
 * pass the Make Waves mainnet gate, and it should not be run in the same sitting as everything
 * else. Do it after the gate, on a quiet day, once the RegularKey has been signing in production.
 *
 * SEED HANDLING. The seed is read from a hidden prompt on the terminal. It is never taken from
 * argv (visible in `ps`), never from an env var, and never written to disk, so it does not land in
 * shell history. Nothing here transmits the seed anywhere except to sign locally; only the signed
 * blob goes to the network.
 */
'use strict';

const xrpl = require('xrpl');

const NETWORK = 'wss://xrplcluster.com';           // MAINNET
const ISSUER = 'rDe4tWiu8hVNQEySmfzms47M6qt4JSWf6L';
const REGULAR_KEY = 'r3cTNtQA4DuDPtvnbNFjVmafBURv1A2c5f';

const b = s => `\x1b[1m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const grn = s => `\x1b[32m${s}\x1b[0m`;
const ylw = s => `\x1b[33m${s}\x1b[0m`;

function prompt(question, hidden) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    let fd;
    try { fd = fs.openSync('/dev/tty', 'r+'); }
    catch { return reject(new Error('no terminal available; run this in a real Terminal window')); }
    const rl = require('readline').createInterface({
      input: fs.createReadStream(null, { fd }),
      output: fs.createWriteStream(null, { fd }),
      terminal: true,
    });
    if (hidden) {
      // Suppress echo so the seed never appears on screen or in a scrollback buffer.
      rl._writeToOutput = function (str) {
        if (str.includes(question)) rl.output.write(question);
        else if (['\r\n', '\n', '\r'].includes(str)) rl.output.write(str);
      };
    }
    rl.question(question, a => { rl.close(); try { fs.closeSync(fd); } catch {} resolve(a.trim()); });
  });
}

async function accountState(client) {
  const r = await client.request({ command: 'account_info', account: ISSUER, ledger_index: 'validated' });
  const a = r.result.account_data;
  const LSF_DISABLE_MASTER = 0x00100000;
  return {
    balance: Number(a.Balance) / 1e6,
    sequence: a.Sequence,
    regularKey: a.RegularKey || null,
    masterDisabled: Boolean((a.Flags || 0) & LSF_DISABLE_MASTER),
  };
}

function report(s) {
  console.log(`  balance        ${s.balance.toFixed(6)} XRP`);
  console.log(`  sequence       ${s.sequence}`);
  console.log(`  RegularKey     ${s.regularKey ? grn(s.regularKey) : ylw('not set')}`);
  console.log(`  master key     ${s.masterDisabled ? red('DISABLED') : 'enabled'}`);
}

async function submit(client, wallet, tx, label) {
  const prepared = await client.autofill(tx);
  console.log(`\n${b('About to submit to MAINNET:')}`);
  console.log(JSON.stringify(prepared, null, 2));
  console.log(`  fee            ${Number(prepared.Fee) / 1e6} XRP`);
  console.log(`  signed by      ${wallet.classicAddress}`);

  const ok = await prompt(`\nType ${b('yes')} to submit ${label}, anything else aborts: `);
  if (ok !== 'yes') { console.log(red('  aborted, nothing submitted')); return null; }

  const res = await client.submitAndWait(wallet.sign(prepared).tx_blob);
  const code = res.result.meta.TransactionResult;
  console.log(`\n  result         ${code === 'tesSUCCESS' ? grn(code) : red(code)}`);
  console.log(`  hash           ${res.result.hash}`);
  console.log(`  explorer       https://livenet.xrpl.org/transactions/${res.result.hash}`);
  return code;
}

(async () => {
  const mode = (process.argv[2] || '').toLowerCase();
  if (!['check', 'set', 'test'].includes(mode)) {
    console.log('usage: node mainnet_regularkey.cjs check|set|test');
    process.exit(2);
  }

  const client = new xrpl.Client(NETWORK);
  await client.connect();
  console.log(`\n${b('MAINNET')} ${NETWORK}`);
  console.log(`${b('issuer')}  ${ISSUER}\n`);

  let state = await accountState(client);
  report(state);

  try {
    if (mode === 'check') {
      console.log(`\n  next: ${state.regularKey ? 'RegularKey already set, run `test`' : 'run `set`'}`);
      return;
    }

    if (mode === 'set') {
      if (state.regularKey === REGULAR_KEY) {
        console.log(grn('\n  RegularKey is already set to the intended address. Nothing to do; run `test`.'));
        return;
      }
      if (state.regularKey) {
        console.log(red(`\n  RegularKey is already set to a DIFFERENT address: ${state.regularKey}`));
        console.log('  Refusing to overwrite it automatically. Work out why before continuing.');
        process.exitCode = 1;
        return;
      }
      console.log(`\n  This sets RegularKey = ${b(REGULAR_KEY)}`);
      console.log('  It is reversible: the master key can change or remove it at any time.');

      const seed = await prompt('\n  MASTER seed for the issuer (hidden): ', true);
      const wallet = xrpl.Wallet.fromSeed(seed);
      if (wallet.classicAddress !== ISSUER) {
        console.log(red(`\n  WRONG SEED. That seed is for ${wallet.classicAddress}, not the issuer.`));
        console.log('  Nothing was submitted.');
        process.exitCode = 1;
        return;
      }
      console.log(grn(`  seed matches the issuer account`));

      const code = await submit(client, wallet,
        { TransactionType: 'SetRegularKey', Account: ISSUER, RegularKey: REGULAR_KEY }, 'SetRegularKey');
      if (code !== 'tesSUCCESS') { process.exitCode = 1; return; }

      state = await accountState(client);
      console.log(`\n${b('after:')}`);
      report(state);
      console.log(state.regularKey === REGULAR_KEY
        ? grn('\n  STEP 1 DONE. Now run `test` before you trust this key.')
        : red('\n  RegularKey did not land as expected. Stop and investigate.'));
      return;
    }

    if (mode === 'test') {
      if (state.regularKey !== REGULAR_KEY) {
        console.log(red(`\n  RegularKey is not set to ${REGULAR_KEY}. Run \`set\` first.`));
        process.exitCode = 1;
        return;
      }
      console.log('\n  This submits a no-op AccountSet on the issuer, signed by the REGULARKEY seed.');
      console.log('  It proves the RegularKey can sign for the issuer. Costs one transaction fee.');

      const seed = await prompt('\n  REGULARKEY seed (hidden): ', true);
      const wallet = xrpl.Wallet.fromSeed(seed);
      if (wallet.classicAddress !== REGULAR_KEY) {
        console.log(red(`\n  WRONG SEED. That seed is for ${wallet.classicAddress}, not ${REGULAR_KEY}.`));
        if (wallet.classicAddress === ISSUER) {
          console.log(red('  That looks like the MASTER seed. This test must use the RegularKey seed,'));
          console.log(red('  otherwise it proves nothing.'));
        }
        process.exitCode = 1;
        return;
      }
      console.log(grn('  seed matches the RegularKey account'));

      // Account is the ISSUER; the signature comes from the RegularKey. That is the whole point.
      const code = await submit(client, wallet, { TransactionType: 'AccountSet', Account: ISSUER },
        'the RegularKey signing test');
      if (code === 'tesSUCCESS') {
        console.log(grn('\n  STEP 2 DONE. The RegularKey can sign for the issuer.'));
        console.log('  Its seed is now safe to put in Railway as LEDGERLINGS_ISSUER_SEED.');
        console.log('  Type it into the Railway dashboard yourself. Do not paste it into a chat.');
      } else {
        console.log(red('\n  The RegularKey could NOT sign. Do not put its seed in Railway.'));
        console.log('  The backend would be unable to mint. Investigate before going further.');
        process.exitCode = 1;
      }
    }
  } finally {
    await client.disconnect();
  }
})().catch(e => { console.error('\n', e.message); process.exit(1); });
