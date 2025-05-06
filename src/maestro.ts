import { Zodios } from "@zodios/core";
import { z } from "zod";
import {
  BlockResponseSchema,
  EstimateFeeResponseSchema,
  TransactionResponseSchema,
  UnspentUtxosResponseSchema,
  UnspentRuneUtxosResponseSchema,
  RuneListResponseSchema,
  RuneDetailsResponseSchema,
  RunesByAddressResponseSchema,
  ApiErrorsSchema,
  UnspentRuneUtxo,
  UnspentUtxo,
} from "./types.js";
import { MaestroConfig } from "./bitcoin-wallet.js";

/**
 * The Maestro API client for Bitcoin operations
 */
export class MaestroClient {
  private api;
  private apiKey: string;
  private apiUrl: string;

  /**
   * Create a new Maestro API client
   * @param config
   */
  constructor(config: MaestroConfig) {
    this.apiUrl = config.url;
    this.apiKey = config.apiKey;

    this.api = new Zodios(
      this.apiUrl,
      [
        {
          method: "get",
          path: "/v0/addresses/:address/utxos",
          alias: "getUnspentUtxos",
          parameters: [
            {
              name: "address",
              type: "Path",
              schema: z.string(),
            },
            {
              name: "cursor",
              type: "Query",
              schema: z.string().optional(),
            },
          ],
          response: UnspentUtxosResponseSchema,
          errors: [
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/addresses/:address/runes/:runeId",
          alias: "getUnspentUtxosForRune",
          parameters: [
            {
              name: "address",
              type: "Path",
              schema: z.string(),
            },
            {
              name: "runeId",
              type: "Path",
              schema: z.string(),
            },
            {
              name: "cursor",
              type: "Query",
              schema: z.string().optional(),
            },
          ],
          response: UnspentRuneUtxosResponseSchema,
          errors: [
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/assets/runes/:nameOrId",
          alias: "getRuneDetails",
          parameters: [
            {
              name: "nameOrId",
              type: "Path",
              schema: z.string(),
            },
          ],
          response: RuneDetailsResponseSchema,
          errors: [
            {
              status: 404,
              schema: z.null(),
            },
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/assets/runes",
          alias: "listRunes",
          parameters: [
            {
              name: "count",
              type: "Query",
              schema: z.number(),
            },
            {
              name: "cursor",
              type: "Query",
              schema: z.string().optional(),
            },
          ],
          response: RuneListResponseSchema,
          errors: [
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/addresses/:address/runes",
          alias: "getRunesByAddress",
          parameters: [
            {
              name: "address",
              type: "Path",
              schema: z.string(),
            },
          ],
          response: RunesByAddressResponseSchema,
          errors: [
            {
              status: 404,
              schema: z.null(),
            },
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/blockchain/blocks/:height",
          alias: "getBlock",
          parameters: [
            {
              name: "height",
              type: "Path",
              schema: z.number(),
            },
          ],
          response: BlockResponseSchema,
          errors: [
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/blockchain/estimates/fee",
          alias: "estimateFee",
          response: EstimateFeeResponseSchema,
          errors: [
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
        {
          method: "get",
          path: "/v0/blockchain/transactions/:txId",
          alias: "getTransaction",
          parameters: [
            {
              name: "txId",
              type: "Path",
              schema: z.string(),
            },
          ],
          response: TransactionResponseSchema,
          errors: [
            {
              status: "default",
              schema: ApiErrorsSchema,
            },
          ],
        },
      ],
      {
        axiosConfig: {
          headers: {
            "api-key": this.apiKey,
          },
        },
      },
    );
  }

  /**
   * Get all unspent UTXOs for a wallet address
   * @param walletAddress The Bitcoin address
   * @returns List of unspent UTXOs
   */
  async getUnspentUtxos(walletAddress: string) {
    let allUtxos: UnspentUtxo[] = [];
    let nextCursor = null;

    do {
      const response = await this.api.getUnspentUtxos({
        params: { address: walletAddress },
        queries: nextCursor ? { cursor: nextCursor } : {},
      });

      allUtxos = [...allUtxos, ...response.data];
      nextCursor = response.next_cursor;
    } while (nextCursor);

    return allUtxos;
  }

  /**
   * Get all unspent UTXOs for a specific rune at a wallet address
   * @param walletAddress The Bitcoin address
   * @param runeId The rune ID
   * @returns List of unspent rune UTXOs
   */
  async getUnspentUtxosForRune(walletAddress: string, runeId: string) {
    let allUtxos: UnspentRuneUtxo[] = [];
    let nextCursor = null;

    do {
      const response = await this.api.getUnspentUtxosForRune({
        params: { address: walletAddress, runeId },
        queries: nextCursor ? { cursor: nextCursor } : {},
      });

      allUtxos = [...allUtxos, ...response.data];
      nextCursor = response.next_cursor;
    } while (nextCursor);

    return allUtxos;
  }

  /**
   * Get details about a specific rune
   * @param nameOrId The rune name or ID
   * @returns Rune details
   */
  async getRuneDetails(nameOrId: string) {
    try {
      const response = await this.api.getRuneDetails({
        params: { nameOrId },
      });
      return response.data;
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }

  /**
   * List runes with pagination
   * @param count Number of runes to retrieve
   * @param cursor Optional cursor for pagination
   * @returns Rune list response
   */
  async listRunes(count: number, cursor?: string) {
    return await this.api.listRunes({
      queries: { count, cursor },
    });
  }

  /**
   * Get the current block height from the indexer
   * @returns Current block height
   */
  async getIndexerBlockHeight() {
    const runeList = await this.listRunes(1);
    return runeList.last_updated.block_height;
  }

  /**
   * Get the balance of a specific rune for an address
   * @param address The Bitcoin address
   * @param runeId The rune ID
   * @returns The balance as a BigInt
   */
  async getBalance(address: string, runeId: string) {
    // First get the rune details to get divisibility
    const runeDetails = await this.getRuneDetails(runeId);
    if (!runeDetails) {
      throw new Error(`Rune with ID ${runeId} not found`);
    }

    const response = await this.api.getRunesByAddress({
      params: { address },
    });

    // Find the balance for the specified rune ID
    const balance = response.data[runeId] || "0";

    // Convert to fundamental units based on divisibility
    return BigInt(Number(balance) * Math.pow(10, runeDetails.divisibility));
  }

  /**
   * Estimate the current Bitcoin network fee
   * @returns The estimated fee rate
   */
  async estimateFee() {
    const response = await this.api.estimateFee();
    return response.data.feerate;
  }

  /**
   * Get transaction details
   * @param txId The transaction ID
   * @returns Transaction details
   */
  async getTransaction(txId: string) {
    const response = await this.api.getTransaction({
      params: { txId },
    });
    return response.data;
  }
}
