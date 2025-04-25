import { ECPairFactory, ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { sign, verify } from 'bitcoinjs-message';
import { FunkybitClient } from './src/index.js';
import { BitcoinWallet, EvmWallet } from './src/types.js';
import { ethers, TypedDataDomain, TypedDataField, Wallet } from 'ethers';
import {TypedDataEncoder} from "ethers/hash";
import {assert} from "ethers/utils";

// Initialize bitcoinjs-lib
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// --- Bitcoin Wallet Implementation ---

// WARNING: In a real application, DO NOT generate keys like this.
// Use secure key management practices. This is for demonstration purposes only.
const bitcoinKeyPair: ECPairInterface = ECPair.makeRandom();
const { address: bitcoinAddress } = bitcoin.payments.p2wpkh({ pubkey: bitcoinKeyPair.publicKey });

if (!bitcoinAddress) {
  throw new Error("Could not generate Bitcoin address");
}

console.log(`Demo Bitcoin Address (P2WPKH): ${bitcoinAddress}`);
// Keep the private key accessible only within this scope for signing.
const bitcoinPrivateKey = bitcoinKeyPair.privateKey;
if (!bitcoinPrivateKey) {
    throw new Error("Could not get Bitcoin private key");
}

const bitcoinWallet: BitcoinWallet = {
  address: bitcoinAddress,
  ordinalsAddress: bitcoinAddress, // Using the same address for ordinals in this example
  signMessage: async (addressToSignWith: string, message: string): Promise<string> => {
    // Ensure we are signing for the correct address associated with this key
    if (addressToSignWith !== bitcoinAddress) {
      console.error(`Requested signature for address ${addressToSignWith}, but wallet address is ${bitcoinAddress}`);
      throw new Error("Address mismatch");
    }
    console.log(`Bitcoin Wallet: Signing message for ${addressToSignWith}:\n"${message}"`);
    try {
      // bitcoinjs-message expects the private key buffer and compression flag
      const signature = sign(message, bitcoinPrivateKey, bitcoinKeyPair.compressed);
      // Return the signature as a base64 string
      return signature.toString('base64');
    } catch (e) {
      console.error("Bitcoin signing failed:", e);
      throw e;
    }
  }
};

// --- EVM Wallet Implementation (using ethers) ---

// WARNING: In a real application, DO NOT generate keys like this.
// Use secure key management practices. This is for demonstration purposes only.
const evmWallet = Wallet.createRandom();
const chainId = 1; // Ethereum mainnet

const evmWalletImpl: EvmWallet = {
  get address(): string {
    return evmWallet.address;
  },
  get chainId(): number {
    return chainId;
  },
  signTypedData: async (
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>
  ): Promise<string> => {
    console.log(`EVM Wallet: Signing typed data for ${evmWallet.address} on chain ${chainId}`);
    console.log("Domain:", domain);
    console.log("Types:", types);
    console.log("Value:", value);

    try {
      const signature = await evmWallet.signTypedData(domain, types, value);
      console.log("EVM Signature:", signature);
      return signature;
    } catch (e: any) {
      console.error("EVM signing failed:", e);
      throw e;
    }
  }
};

// --- FunkybitClient Instantiation and Login ---

export async function runLoginExample() {
  console.log("Starting FunkybitClient login example...");

  try {
    console.log("Initializing FunkybitClient...");
    console.log(`Using Bitcoin Address: ${bitcoinWallet.address}`);
    console.log(`Using EVM Address: ${evmWalletImpl.address}`);
    console.log(`Using EVM Chain ID: ${evmWalletImpl.chainId}`);

    const client = new FunkybitClient({
      bitcoinWallet: bitcoinWallet,
      evmWallet: evmWalletImpl,
    });

    console.log("Attempting Funkybit login...");
    const loginSuccess = await client.login();

    if (loginSuccess) {
      console.log("✅ Funkybit login successful!");
    } else {
      console.log("❌ Funkybit login failed or was cancelled by the user.");
    }
  } catch (error) {
    console.error("❌ An error occurred during the FunkybitClient operation:", error);
  }
}

// Example invocation (uncomment and adapt to your application's entry point):
// runLoginExample();