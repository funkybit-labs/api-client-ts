import * as bitcoin from "bitcoinjs-lib";
import { networks } from "bitcoinjs-lib";
import { BitcoinWallet } from "./types.js";
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
   * Create a new Bitcoin wallet
   * @param privateKeyHex The private key in hex format (with or without '0x' prefix)
   * @param network The Bitcoin network to use (default: bitcoin)
   * @param rpcConfig Optional RPC configuration
   */
  constructor(
    privateKeyHex: string,
    network: bitcoin.networks.Network = bitcoin.networks.bitcoin,
    rpcConfig: MempoolConfig = defaultMempoolConfig,
  ) {
    // Remove '0x' prefix if present
    const cleanPrivateKeyHex = privateKeyHex.startsWith("0x")
      ? privateKeyHex.slice(2)
      : privateKeyHex;

    // Create key pair from private key
    const privateKeyBuffer = Buffer.from(cleanPrivateKeyHex, "hex");
    this.keyPair = ECPair.fromPrivateKey(privateKeyBuffer);

    this.network = network;
    this.mempoolConfig = rpcConfig;

    // Create RPC client
    this.mempoolClient = mempoolJS({
      hostname: `${this.mempoolConfig.host}:${this.mempoolConfig.port}`,
      network: network === bitcoin.networks.bitcoin ? "mainnet" : "regtest",
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
   * Generate a P2TR (Pay-to-Taproot) address for ordinals
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
   * Create a new Bitcoin wallet from an existing key pair
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
   * Create a new Bitcoin wallet with a random private key
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
   * Get the wallet's address
   */
  get address(): string {
    return this._address;
  }

  /**
   * Get the ordinals address
   */
  get ordinalsAddress(): string {
    return this._ordinalsAddress;
  }

  /**
   * Get UTXOs for a Bitcoin address using the Bitcoin RPC
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
   * Estimate the fee for a Bitcoin transaction using the Bitcoin RPC
   * @returns Promise resolving to the estimated fee in satoshis
   */
  private async estimateFeeFromRpc(): Promise<bigint> {
    try {
      // Get the current fee rate from the Bitcoin RPC
      const feeRate =
        await this.mempoolClient.bitcoin.fees.getFeesRecommended();

      const satPerVbyte = feeRate.halfHourFee;

      // Estimate the size of a typical transaction (1 input, 2 outputs)
      const estimatedSize = 140; // bytes

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
   * Sign a message using the wallet's private key
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
   * Sign a message using Taproot (Schnorr) signatures
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
   * Send a Bitcoin transaction
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
      if (changeAmount > 546) {
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
   * Estimate the fee for a Bitcoin transaction
   * @returns Promise resolving to the estimated fee in satoshis
   */
  async estimateFee(): Promise<bigint> {
    return this.estimateFeeFromRpc();
  }
}
