import * as bitcoin from "bitcoinjs-lib";
import { networks } from "bitcoinjs-lib";
import { BitcoinWallet, Symbol } from "./types.js";
import { ECPairFactory, ECPairInterface } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { sign } from "bitcoinjs-message";
import mempoolJS from "@mempool/mempool.js";
import { Signer } from "bip322-js";
import * as wif from "wif";
import { AddressTxsUtxo } from "@mempool/mempool.js/lib/interfaces/bitcoin/addresses.js";
import { MempoolReturn } from "@mempool/mempool.js/lib/interfaces/index.js";
import { MaestroClient } from "./maestro.js";

import { parseUnits } from "viem";
import { Edict, none, RuneId, Runestone, some } from "runelib";

// Initialize bitcoinjs-lib with the required elliptic curve implementation
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// Mempool client configuration
interface MempoolConfig {
  host: string;
  port: number;
}

// Default Mempool client configuration
const defaultMempoolConfig: MempoolConfig = {
  host: process.env.MEMPOOL_HOST ?? "mempool.space",
  port: process.env.MEMPOOL_PORT ? Number(process.env.MEMPOOL_PORT) : 443,
};

// Maestro client configuration
export interface MaestroConfig {
  url: string;
  apiKey: string;
}

const defaultMaestroConfig: MaestroConfig = {
  url: process.env.MAESTRO_API_URL ?? "https://xbt-mainnet.gomaestro-api.org",
  apiKey: process.env.MAESTRO_API_KEY ?? "maestro-api-key",
};

// Define the type for unspent output from Bitcoin RPC
interface UnspentOutput {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
}

const runeOutputAmount = 546; // Dust limit - standard for rune outputs

/**
 * Implementation of the BitcoinWallet interface using bitcoinjs-lib
 */
export class BitcoinWalletImpl implements BitcoinWallet {
  private readonly keyPair: ECPairInterface;
  private readonly network: bitcoin.networks.Network;
  private readonly _address: string;
  private readonly _ordinalsAddress: string;
  private readonly mempoolConfig: MempoolConfig;
  private readonly mempoolClient: MempoolReturn;
  private readonly maestroClient: MaestroClient;

  /**
   * Creates a new Bitcoin wallet
   * @param privateKeyHex The private key in hex format (with or without '0x' prefix)
   * @param network The Bitcoin network to use (default: bitcoin)
   * @param mempoolConfig Optional mempool configuration
   * @param maestroConfig Optional maestro configuration
   */
  constructor(
    privateKeyHex: string,
    network: bitcoin.networks.Network = bitcoin.networks.bitcoin,
    mempoolConfig: MempoolConfig = defaultMempoolConfig,
    maestroConfig: MaestroConfig = defaultMaestroConfig,
  ) {
    // Remove '0x' prefix if present
    const cleanPrivateKeyHex = privateKeyHex.startsWith("0x")
      ? privateKeyHex.slice(2)
      : privateKeyHex;

    // Create key pair from private key
    const privateKeyBuffer = Buffer.from(cleanPrivateKeyHex, "hex");
    this.keyPair = ECPair.fromPrivateKey(privateKeyBuffer);

    this.network = network;
    this.mempoolConfig = mempoolConfig;

    // Create RPC client
    this.mempoolClient = mempoolJS({
      hostname: `${this.mempoolConfig.host}:${this.mempoolConfig.port}`,
      network:
        network === bitcoin.networks.bitcoin
          ? "mainnet"
          : network === bitcoin.networks.testnet
            ? "testnet"
            : "regtest",
      config: {},
    });

    this.maestroClient = new MaestroClient(maestroConfig);

    // Generate P2WPKH address from public key (main address)
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: this.keyPair.publicKey,
      network: this.network,
    });

    if (!address) {
      throw new Error("Failed to generate Bitcoin address");
    }

    this._address = address;

    // Generate P2TR address for ordinals
    this._ordinalsAddress = this.generateP2TRAddress();
  }

  /**
   * Generates a P2TR (Pay-to-Taproot) address for ordinals
   * @returns P2TR address string
   */
  private generateP2TRAddress(): string {
    // Convert the compressed public key to an x-only key (remove the first byte)
    const xOnlyPubkey = this.keyPair.publicKey.slice(1);

    // Create a P2TR payment object
    const p2tr = bitcoin.payments.p2tr({
      internalPubkey: xOnlyPubkey,
      network: this.network,
    });

    if (!p2tr.address) {
      throw new Error("Failed to generate P2TR address for ordinals");
    }

    return p2tr.address;
  }

  /**
   * Creates a new Bitcoin wallet from an existing key pair
   * @param keyPair The ECPair key pair
   * @param network The Bitcoin network to use (default: bitcoin)
   * @param rpcConfig Optional RPC configuration
   * @returns A new BitcoinWalletImpl instance
   */
  static fromKeyPair(
    keyPair: ECPairInterface,
    network: bitcoin.networks.Network = bitcoin.networks.bitcoin,
    rpcConfig: MempoolConfig = defaultMempoolConfig,
  ): BitcoinWalletImpl {
    const privateKeyHex = keyPair.privateKey!.toString("hex");
    return new BitcoinWalletImpl(privateKeyHex, network, rpcConfig);
  }

  /**
   * Creates a new Bitcoin wallet with a random private key
   * @param network The Bitcoin network to use (default: bitcoin)
   * @param rpcConfig Optional RPC configuration
   * @returns A new BitcoinWalletImpl instance
   */
  static createRandom(
    network: bitcoin.networks.Network = bitcoin.networks.bitcoin,
    rpcConfig: MempoolConfig = defaultMempoolConfig,
  ): BitcoinWalletImpl {
    const keyPair = ECPair.makeRandom();
    const privateKeyHex = keyPair.privateKey!.toString("hex");
    return new BitcoinWalletImpl(privateKeyHex, network, rpcConfig);
  }

  /**
   * Gets the wallet's address
   */
  get address(): string {
    return this._address;
  }

  /**
   * Gets the ordinals address
   */
  get ordinalsAddress(): string {
    return this._ordinalsAddress;
  }

  /**
   * Gets UTXOs for a Bitcoin address using the Bitcoin RPC
   * @param address The Bitcoin address to get UTXOs for
   * @returns Promise resolving to an array of UTXOs
   */
  private async getUtxos(
    address: string,
  ): Promise<Array<{ txid: string; vout: number; value: number }>> {
    try {
      // Get unspent outputs for the address
      const unspentOutputs =
        await this.mempoolClient.bitcoin.addresses.getAddressTxsUtxo({
          address: address,
        });

      // Map the unspent outputs to our UTXO format
      return unspentOutputs.map((output: AddressTxsUtxo) => ({
        txid: output.txid,
        vout: output.vout,
        value: output.value,
      }));
    } catch (error) {
      console.error("Failed to get UTXOs from Mempool API:", error);
      return [];
    }
  }

  /**
   * Estimates the fee for a Bitcoin transaction using the Bitcoin RPC
   * @returns Promise resolving to the estimated fee in satoshis
   */
  private async estimateFeeFromRpc(estimatedSize = 140): Promise<bigint> {
    try {
      // Get the current fee rate from the Bitcoin RPC
      const feeRate =
        await this.mempoolClient.bitcoin.fees.getFeesRecommended();

      const satPerVbyte = feeRate.halfHourFee;

      // Calculate the fee
      const fee = Math.ceil(satPerVbyte * estimatedSize);

      return BigInt(fee);
    } catch (error) {
      console.error(
        "Failed to estimate fee from Bitcoin RPC, defaulting to 1000 sats: ",
        error?.toString()?.slice(0, 80),
      );
      return 1000n;
    }
  }

  /**
   * Signs a message using the wallet's private key
   * @param address The address to sign for (must match the wallet's address)
   * @param message The message to sign
   * @returns Promise resolving to the signature
   */
  async signMessage(address: string, message: string): Promise<string> {
    if (address !== this._address && address !== this._ordinalsAddress) {
      throw new Error(
        `Address mismatch: expected ${this._address}, got ${address}`,
      );
    }

    try {
      // For P2WPKH address (main address)
      if (address === this._address) {
        // Use bitcoinjs-message to sign the message
        const signature = sign(
          message,
          this.keyPair.privateKey!,
          this.keyPair.compressed,
        );
        return signature.toString("base64");
      }
      // For P2TR address (ordinals address)
      else {
        return this.signTaprootMessage(message);
      }
    } catch (e) {
      console.error("Bitcoin signing failed:", e);
      throw e;
    }
  }

  /**
   * Signs a message using Taproot (Schnorr) signatures
   * @param message The message to sign
   * @returns Promise resolving to the signature
   */
  private async signTaprootMessage(message: string): Promise<string> {
    try {
      return Signer.sign(
        wif.encode({
          version: this.network === networks.bitcoin ? 128 : 239,
          privateKey: Uint8Array.from(this.keyPair.privateKey!),
          compressed: true,
        }),
        this._ordinalsAddress,
        message,
      ).toString();
    } catch (e) {
      console.error("Taproot message signing failed:", e);
      throw e;
    }
  }

  /**
   * Sends a Bitcoin transaction
   * @param to The recipient address
   * @param amount The amount to send (in satoshis)
   * @returns Promise resolving to the transaction hash
   */
  async sendTransaction(to: string, amount: bigint): Promise<string> {
    try {
      // Create a new transaction
      const psbt = new bitcoin.Psbt({ network: this.network });

      // Get UTXOs for the wallet using the Bitcoin RPC
      const utxos = await this.getUtxos(this._address);

      if (utxos.length === 0) {
        throw new Error("No UTXOs available to spend");
      }

      // Calculate the total available balance
      const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

      // Estimate the fee using the Bitcoin RPC
      const estimatedFee = await this.estimateFee();

      // Check if we have enough balance
      if (totalBalance < Number(amount) + Number(estimatedFee)) {
        throw new Error(
          `Insufficient balance: ${totalBalance} satoshis, need ${Number(amount) + Number(estimatedFee)} satoshis`,
        );
      }

      // Add inputs
      let inputAmount = 0;
      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(this._address, this.network),
            value: utxo.value,
          },
        });
        inputAmount += utxo.value;

        // Break if we have enough inputs
        if (inputAmount >= Number(amount) + Number(estimatedFee)) {
          break;
        }
      }

      // Add output to recipient
      psbt.addOutput({
        address: to,
        value: Number(amount),
      });

      // Add change output if needed
      const changeAmount = inputAmount - Number(amount) - Number(estimatedFee);
      if (changeAmount > runeOutputAmount) {
        // Dust limit
        psbt.addOutput({
          address: this._address,
          value: changeAmount,
        });
      }

      // Sign all inputs
      for (let i = 0; i < psbt.txInputs.length; i++) {
        psbt.signInput(i, this.keyPair);
      }

      // Finalize and broadcast
      psbt.finalizeAllInputs();

      const tx = psbt.extractTransaction();
      await this.mempoolClient.bitcoin.transactions.postTx({
        txhex: tx.toHex(),
      });

      return tx.getId();
    } catch (e) {
      console.error("Failed to send Bitcoin transaction:", e);
      throw e;
    }
  }

  /**
   * Sends a Rune transaction
   * @param symbol The rune symbol
   * @param to The recipient address
   * @param amount The amount to send (in units)
   * @returns Promise resolving to the transaction hash
   */
  async sendRuneTransaction(
    symbol: Symbol,
    to: string,
    amount: bigint,
  ): Promise<string> {
    try {
      // Get rune details from Maestro client
      const runeId = new RuneId(
        Number(symbol.contractAddress!.split(":")[0] || 0),
        Number(symbol.contractAddress!.split(":")[1] || 0),
      );
      const runeDetails = await this.maestroClient.getRuneDetails(
        symbol.nameOnChain ?? symbol.name,
      );
      if (!runeDetails) {
        throw new Error(`Rune with name ${symbol.nameOnChain} not found`);
      }

      // Get unspent rune UTXOs from the Maestro client
      const unspentRuneUtxos = await this.maestroClient.getUnspentUtxosForRune(
        this._ordinalsAddress,
        symbol.contractAddress!,
      );

      if (unspentRuneUtxos.length === 0) {
        throw new Error(`No unspent UTXOs found with rune ${symbol.name}`);
      }

      // Calculate total available rune amount
      let totalRuneAmount = 0n;
      for (const utxo of unspentRuneUtxos) {
        // Use parseUnits for conversion
        const runeAmountBigInt = parseUnits(
          utxo.rune_amount.toFixed(runeDetails.divisibility),
          runeDetails.divisibility,
        );
        totalRuneAmount += runeAmountBigInt;
      }

      if (totalRuneAmount < amount) {
        throw new Error(
          `Insufficient rune balance: ${totalRuneAmount}, need ${amount}`,
        );
      }
      // Select rune UTXOs
      // For runes, select multiple UTXOs if needed to cover the amount
      // N.B.: this is a simple implementation meant as an example - for production use,
      // should replace with an implementation that optimizes for a minimum number of utxos
      const selectedRuneUtxos = [];
      let selectedRuneAmount = 0n;

      for (const utxo of unspentRuneUtxos) {
        const utxoRuneAmount = parseUnits(
          utxo.rune_amount.toFixed(runeDetails.divisibility),
          runeDetails.divisibility,
        );

        selectedRuneUtxos.push(utxo);
        selectedRuneAmount += utxoRuneAmount;

        if (selectedRuneAmount >= amount) {
          break;
        }
      }

      // Get unspent BTC UTXOs for fee payment
      const unspentBtcUtxos = (await this.getUtxos(this._address)).filter(
        (u) => u.value !== runeOutputAmount,
      );

      if (unspentBtcUtxos.length === 0) {
        throw new Error("No unspent BTC UTXOs available for paying fees");
      }

      // Estimate fee
      const estimatedFee = await this.estimateFee(
        11 + (1 + selectedRuneUtxos.length) * 63 + 4 * 41,
      ) + BigInt((2 - selectedRuneUtxos.length) * runeOutputAmount);

      // For BTC, select UTXOs to cover the fee and minimum output values
      // N.B.: this is a simple implementation meant as an example - for production use,
      // should replace with an implementation that optimizes for a minimum number of utxos
      let selectedBtcUtxos = [];
      let totalBtcInput = 0n;

      for (const utxo of unspentBtcUtxos) {
        selectedBtcUtxos.push(utxo);
        totalBtcInput += BigInt(utxo.value);

        if (totalBtcInput >= estimatedFee) {
          break;
        }
      }

      if (totalBtcInput < estimatedFee) {
        throw new Error(
          `Insufficient BTC balance for fees: have ${totalBtcInput}, need ${estimatedFee}`,
        );
      }

      // Create the transaction
      const psbt = new bitcoin.Psbt({ network: this.network });
      const xOnlyPubkey = this.keyPair.publicKey.slice(1);
      // Create tweaking hash (tagged hash of the x-only pubkey)
      const tweakHash = bitcoin.crypto.taggedHash("TapTweak", xOnlyPubkey);

      // Create a new keyPair with the tweaked private key
      // (This is a common pattern in Taproot signing)
      const ECPair = ECPairFactory(ecc);
      let tweakedKeyPair;

      try {
        // Attempt to tweak the private key
        const tweakedPrivateKey = ecc.privateAdd(
          this.keyPair.privateKey!,
          tweakHash,
        );

        if (!tweakedPrivateKey) {
          throw new Error("Failed to create tweaked private key");
        }

        tweakedKeyPair = ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey));
      } catch (e) {
        console.error("Error creating tweaked key:", e);
        throw new Error("Failed to create tweaked signing key: " + e);
      }

      // Add the rune UTXOs as inputs
      for (const utxo of selectedRuneUtxos) {
        // Get the P2TR payment object (using the original internal key)
        const p2tr = bitcoin.payments.p2tr({
          internalPubkey: xOnlyPubkey,
          network: this.network,
        });

        if (!p2tr.output) {
          throw new Error("Failed to create P2TR output script");
        }

        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: p2tr.output,
            value: Number(utxo.satoshis),
          },
          tapInternalKey: xOnlyPubkey,
        });
      }

      // Add BTC inputs
      for (const utxo of selectedBtcUtxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(this._address, this.network),
            value: utxo.value,
          },
        });
      }

      // Create Runestone with edicts for transferring runes

      // Create an edict to transfer runes to output 0 (recipient)
      const edict = new Edict(runeId, amount, 0);

      // Create a runestone with the edict
      // The change output index for any remaining runes is 1
      const runestone = new Runestone(
        [edict],
        none(),
        none(),
        some(1), // Specifies that output 1 should receive any change
      );

      // Add recipient output (with dust amount)
      psbt.addOutput({
        address: to,
        value: runeOutputAmount,
      });

      // Add change output for rune change
      psbt.addOutput({
        address: this._ordinalsAddress,
        value: runeOutputAmount,
      });

      // Add OP_RETURN output with runestone data
      psbt.addOutput({
        script: runestone.encipher(),
        value: 0,
      });

      // Add BTC change output if necessary
      const changeAmount = totalBtcInput - estimatedFee;
      if (changeAmount > runeOutputAmount) {
        psbt.addOutput({
          address: this._address,
          value: Number(changeAmount),
        });
      }

      // Sign all inputs
      // Sign all inputs with appropriate keys
      for (let i = 0; i < psbt.txInputs.length; i++) {
        // If this is a rune input (they come first), use the ordinals key pair
        if (i < selectedRuneUtxos.length) {
          // For P2TR inputs (ordinals), we need special signing
          psbt.signTaprootInput(i, tweakedKeyPair);
        } else {
          // For regular BTC inputs
          psbt.signInput(i, this.keyPair);
        }
      }

      // Finalize and broadcast
      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();

      await this.mempoolClient.bitcoin.transactions.postTx({
        txhex: tx.toHex(),
      });

      return tx.getId();
    } catch (e) {
      console.error("Failed to send Rune transaction:", e);
      throw e;
    }
  }

  /**
   * Estimates the fee for a Bitcoin transaction
   * @returns Promise resolving to the estimated fee in satoshis
   */
  async estimateFee(estimatedSize = 140): Promise<bigint> {
    return this.estimateFeeFromRpc(estimatedSize);
  }
}
