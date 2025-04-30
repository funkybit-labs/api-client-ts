import { ethers, TypedDataDomain, TypedDataField } from "ethers";
import { EvmWallet } from "./types.js";

/**
 * Configuration for the Ethereum provider
 */
interface ProviderConfig {
  url: string;
  network?: string | number;
}

/**
 * Default provider configuration for Ethereum mainnet
 */
const defaultProviderConfig: ProviderConfig = {
  url: "http://localhost:8545",
  network: 1337,
};

/**
 * Implementation of the EvmWallet interface using ethers.js
 */
export class EvmWalletImpl implements EvmWallet {
  private readonly wallet: ethers.Wallet;
  private _chainId: number;
  private readonly provider: ethers.Provider;

  /**
   * Create a new EVM wallet
   * @param privateKeyHex The private key in hex format (with or without '0x' prefix)
   * @param providerConfig Optional provider configuration
   */
  constructor(
    privateKeyHex: string,
    providerConfig: ProviderConfig = defaultProviderConfig,
  ) {
    // Ensure the private key has the '0x' prefix
    const cleanPrivateKeyHex = privateKeyHex.startsWith("0x")
      ? privateKeyHex
      : "0x" + privateKeyHex;

    this._chainId = Number(providerConfig.network);

    // Create provider
    this.provider = this.createProvider(providerConfig);

    // Create wallet from private key
    this.wallet = new ethers.Wallet(cleanPrivateKeyHex, this.provider);
  }

  /**
   * Creates an Ethereum provider
   * @param config Provider configuration
   * @returns An Ethereum provider
   */
  private createProvider(config: ProviderConfig): ethers.Provider {
    return new ethers.JsonRpcProvider(config.url, config.network);
  }

  /**
   * Create a new EVM wallet from an existing ethers Wallet
   * @param wallet An ethers.js Wallet instance
   * @param providerConfig Optional provider configuration
   * @returns A new EvmWalletImpl instance
   */
  static fromWallet(
    wallet: ethers.Wallet,
    providerConfig: ProviderConfig = defaultProviderConfig,
  ): EvmWalletImpl {
    return new EvmWalletImpl(wallet.privateKey, providerConfig);
  }

  /**
   * Create a new EVM wallet with a random private key
   * @param providerConfig Optional provider configuration
   * @returns A new EvmWalletImpl instance
   */
  static createRandom(
    providerConfig: ProviderConfig = defaultProviderConfig,
  ): EvmWalletImpl {
    const wallet = ethers.Wallet.createRandom();
    return new EvmWalletImpl(wallet.privateKey, providerConfig);
  }

  /**
   * Get the wallet's address
   */
  get address(): string {
    return this.wallet.address;
  }

  /**
   * Get the chain ID
   */
  get chainId(): number {
    return this._chainId;
  }

  /**
   * Sign typed data using the wallet's private key
   * @param domain The domain data
   * @param types The type definitions
   * @param value The value to sign
   * @returns Promise resolving to the signature
   */
  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> {
    try {
      // Sign the typed data using ethers.js
      const primaryType = Object.keys(types).filter(
        (t) => t !== "EIP712Domain",
      )[0];
      const typesToSign = {
        [primaryType]: types[primaryType],
      };

      return await this.wallet.signTypedData(domain, typesToSign, value);
    } catch (e: any) {
      console.error("EVM signing failed:", e);
      throw e;
    }
  }

  /**
   * Make a read-only call to a contract
   * @param to The contract address
   * @param data The call data
   * @returns Promise resolving to the result
   */
  async call(to: string, data: string): Promise<string> {
    try {
      // Make a read-only call using the provider
      return await this.provider.call({
        to,
        data,
      });
    } catch (e: any) {
      console.error("Failed to make contract call:", e);
      throw e;
    }
  }

  /**
   * Send a transaction
   * @param to The recipient address
   * @param value The amount to send (in wei)
   * @param data Optional data for the transaction
   * @returns Promise resolving to the transaction hash
   */
  async sendTransaction(
    to: string,
    value: bigint,
    data?: string,
  ): Promise<string> {
    try {
      // Create transaction object
      const tx = {
        to,
        value: BigInt(value.toString()),
        data: data || "0x",
      };

      // Send transaction
      const txResponse = await this.wallet.sendTransaction(tx);

      // Wait for transaction to be mined
      const receipt = await txResponse.wait();

      return receipt!.hash;
    } catch (e: any) {
      console.error("Failed to send transaction:", e);
      throw e;
    }
  }

  async waitForTransactionReceipt(txHash: string): Promise<void> {
    await this.wallet.provider?.waitForTransaction(txHash);
  }

  async switchChain(chainId: number): Promise<void> {
    this._chainId = chainId;
  }

  /**
   * Estimate gas for a transaction
   * @param to The recipient address
   * @param value The amount to send (in wei)
   * @param data Optional data for the transaction
   * @returns Promise resolving to the estimated gas
   */
  async estimateGas(to: string, value: bigint, data?: string): Promise<bigint> {
    try {
      // Create transaction object
      const tx = {
        from: this.address,
        to,
        value: BigInt(value.toString()),
        data: data || "0x",
      };

      // Estimate gas
      const gasEstimate = await this.provider.estimateGas(tx);

      return BigInt(gasEstimate.toString());
    } catch (e: any) {
      console.error("Failed to estimate gas:", e);
      throw e;
    }
  }
}
