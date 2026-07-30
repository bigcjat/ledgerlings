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
// Overridable, because the original candidate (r3cTNtQA4DuDPtvnbNFjVmafBURv1A2c5f, "Ledgerlings2")
// was created in Xaman, and Xaman never exports account secrets. A RegularKey whose seed cannot be
// retrieved is useless to a backend that has to sign unattended. Generate one with
// mainnet_genkey.cjs and pass it here:
//   LEDGERLINGS_REGULAR_KEY=rXXXX node mainnet_regularkey.cjs set
const REGULAR_KEY = process.env.LEDGERLINGS_REGULAR_KEY || 'r3cTNtQA4DuDPtvnbNFjVmafBURv1A2c5f';
if (!require('xrpl').isValidClassicAddress(REGULAR_KEY)) {
  console.error(`LEDGERLINGS_REGULAR_KEY is not a valid classic address: ${REGULAR_KEY}`);
  process.exit(2);
}

// xrpl.Wallet.fromSeed() defaults to ed25519 and, given a secp256k1 family seed, silently derives a
// DIFFERENT account instead of erroring. Xaman secret-number accounts are secp256k1. Encoded
// ed25519 seeds start with "sEd"; everything else is secp256k1.
const walletFromSeed = seed =>
  xrpl.Wallet.fromSeed(seed, { algorithm: seed.startsWith('sEd') ? 'ed25519' : 'ecdsa-secp256k1' });

/**
 * Accept either a family seed or Xaman secret numbers.
 * Xaman shows 8 groups of 6 digits labelled A-H. Paste them separated by spaces, commas or
 * newlines; the letters are ignored if present. Converted locally, in memory, never stored.
 */
function walletFromInput(raw) {
  const digitGroups = raw.replace(/[A-Ha-h]\s*[:.]?/g, ' ').match(/\d{6}/g) || [];
  if (digitGroups.length === 8) {
    const { Account } = require('xrpl-secret-numbers');   // devDependency, local tooling only
    return { wallet: walletFromSeed(new Account(digitGroups).getFamilySeed()), kind: 'Xaman secret numbers' };
  }
  if (digitGroups.length > 0 && digitGroups.length !== 8) {
    throw new Error(`found ${digitGroups.length} groups of 6 digits; Xaman secret numbers need exactly 8`);
  }
  const seed = raw.replace(/\s+/g, '');
  if (!/^s[1-9A-HJ-NP-Za-km-z]{28,30}$/.test(seed)) {
    throw new Error('not recognisable as a family seed (s...) or as 8 groups of 6 digits');
  }
  return { wallet: walletFromSeed(seed), kind: `family seed (${seed.startsWith('sEd') ? 'ed25519' : 'secp256k1'})` };
}

const b = s => `\x1b[1m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const grn = s => `\x1b[32m${s}\x1b[0m`;
const ylw = s => `\x1b[33m${s}\x1b[0m`;

function prompt(question, hidden) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('no terminal attached; run this in a real Terminal window'));
    }
    // Earlier this opened /dev/tty and handed the same file descriptor to a ReadStream, a
    // WriteStream AND a manual closeSync. Three owners of one descriptor, so the second prompt
    // died with EBADF after the first one closed it. stdin/stdout were always sufficient here.
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      // Suppress echo so the seed never appears on screen or in a scrollback buffer.
      rl._writeToOutput = function (str) {
        if (str.includes(question)) rl.output.write(question);
        else if (['\r\n', '\n', '\r'].includes(str)) rl.output.write(str);
      };
    }
    rl.question(question, a => { rl.close(); resolve(a.trim()); });
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

      const raw = await prompt('\n  MASTER seed, or Xaman secret numbers (hidden): ', true);
      const { wallet, kind } = walletFromInput(raw);
      console.log(`  input read as  ${kind}`);
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

      const raw = await prompt('\n  REGULARKEY seed, or Xaman secret numbers (hidden): ', true);
      const { wallet, kind } = walletFromInput(raw);
      console.log(`  input read as  ${kind}`);
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
