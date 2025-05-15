import * as bitcoin from "bitcoinjs-lib";
import { networks } from "bitcoinjs-lib";
import { BitcoinWallet, RuneDepositPsbtParamsApiResponse } from "./types.js";
import { ECPairFactory, ECPairInterface } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { sign } from "bitcoinjs-message";
import mempoolJS from "@mempool/mempool.js";
import { Signer } from "bip322-js";
import * as wif from "wif";
import { AddressTxsUtxo } from "@mempool/mempool.js/lib/interfaces/bitcoin/addresses.js";
import { MempoolReturn } from "@mempool/mempool.js/lib/interfaces/index.js";

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

  /**
   * Creates a new Bitcoin wallet
   * @param privateKeyHex The private key in hex format (with or without '0x' prefix)
   * @param network The Bitcoin network to use (default: bitcoin)
   * @param mempoolConfig Optional mempool configuration
   */
  constructor(
    privateKeyHex: string,
    network: bitcoin.networks.Network = bitcoin.networks.bitcoin,
    mempoolConfig: MempoolConfig = defaultMempoolConfig,
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
   * @param runeDepositPsbtParams Rune deposit PSBT params from the API
   * @returns Promise resolving to the transaction hash
   */
  async sendRuneTransaction(
    runeDepositPsbtParams: RuneDepositPsbtParamsApiResponse,
  ): Promise<string> {
    try {

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
      for (const utxo of runeDepositPsbtParams.runeInputs) {
        psbt.addInput({
          hash: utxo.txId,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(utxo.script, 'hex'),
            value: Number(utxo.value),
          },
          tapInternalKey: xOnlyPubkey,
        });
      }

      // Add BTC inputs
      for (const utxo of runeDepositPsbtParams.btcInputs) {
        psbt.addInput({
          hash: utxo.txId,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(utxo.script, 'hex'),
            value: Number(utxo.value),
          },
        });
      }

      for (const output of runeDepositPsbtParams.outputs) {
        psbt.addOutput({
          script: Buffer.from(output.script, 'hex'),
          value: Number(output.value),
        });
      }

      // Sign all inputs
      // Sign all inputs with appropriate keys
      for (let i = 0; i < psbt.txInputs.length; i++) {
        // If this is a rune input (they come first), use the ordinals key pair
        if (i < runeDepositPsbtParams.runeInputs.length) {
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
