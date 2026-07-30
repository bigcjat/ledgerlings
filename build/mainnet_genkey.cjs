#!/usr/bin/env node
/**
 * Generate a fresh RegularKey for the Ledgerlings mainnet issuer.
 *
 *   node mainnet_genkey.cjs
 *
 * WHY THIS EXISTS. Xaman never displays or exports an account secret; secret numbers are shown
 * once at creation and cannot be retrieved later (help.xaman.app, "Can I view/export my account
 * secret?"). The backend has to sign unattended, so its key must be one whose seed we hold. An
 * account living only inside Xaman cannot fill that role.
 *
 * The account this generates is the HOT key. It signs mints on the issuer's behalf and its seed
 * goes into Railway. It is deliberately disposable: if it is ever compromised, the master key
 * rotates it with one SetRegularKey and the issuer, its NFTs and its royalties are untouched.
 * That is the entire point of the RegularKey arrangement.
 *
 * This account does NOT need funding. A RegularKey is an authorization, not a payer; fees come
 * from the issuer.
 *
 * The seed is printed to the terminal once and never written to disk. Save it in your password
 * manager before closing the window.
 */
'use strict';

const xrpl = require('xrpl');

const b = s => `\x1b[1m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const grn = s => `\x1b[32m${s}\x1b[0m`;

const wallet = xrpl.Wallet.generate();   // ed25519, seed encodes as sEd...

// Prove the seed actually round-trips to this address through the same path the server uses,
// before it is trusted with anything. A generated key that cannot be re-derived is worthless.
const walletFromSeed = seed =>
  xrpl.Wallet.fromSeed(seed, { algorithm: seed.startsWith('sEd') ? 'ed25519' : 'ecdsa-secp256k1' });
const rt = walletFromSeed(wallet.seed);
if (rt.classicAddress !== wallet.classicAddress || rt.publicKey !== wallet.publicKey) {
  console.error(red('round-trip check FAILED; refusing to output an unusable key'));
  process.exit(1);
}

console.log(`
${b('New RegularKey for the Ledgerlings mainnet issuer')}

  address   ${grn(wallet.classicAddress)}
  seed      ${grn(wallet.seed)}
  curve     ed25519   (re-derives correctly through server.js walletFromSeed)

${b('Do these three things now, in this order:')}

  1. Save the seed in your password manager. It is not written to disk and this is the only
     time it is shown. Losing it before the master is disabled costs you one SetRegularKey to
     rotate; losing it after would brick the account.

  2. Set it as the RegularKey on the issuer:
       node mainnet_regularkey.cjs set        (with LEDGERLINGS_REGULAR_KEY=${wallet.classicAddress})
     then prove it can sign:
       node mainnet_regularkey.cjs test

  3. Only after that test passes, put the seed in Railway as LEDGERLINGS_ISSUER_SEED, typed
     into the dashboard yourself.

${b('Do not')} fund this account, paste the seed into a chat, or reuse it anywhere else.
`);
