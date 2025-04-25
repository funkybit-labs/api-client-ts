import {Zodios} from '@zodios/core';
import { pluginToken } from '@zodios/plugins';
import { z } from 'zod';
import {
  BitcoinWallet,
  EvmWallet,
  AccountConfigurationApiResponseSchema, ConfigurationApiResponseSchema,
  ApiErrorsSchema
} from './types.js';
import {ethers, TypedDataDomain, TypedDataField} from "ethers";
import {SignTypedDataParameters} from "@wagmi/core";
import {Hex, TypedData} from "viem";
import {base64urlEncode} from "./utils.js";

export const apiBaseUrl = process.env.FUNKYBIT_API ?? "https://prod-api.funkybit.fun"

export interface FunkybitClientConfig {
  bitcoinWallet: BitcoinWallet;
  evmWallet: EvmWallet;
}

const AuthorizeWalletRequestSchema = z.object({
  authorizedAddress: z.string(),
  chainId: z.string(),
  address: z.string(),
  timestamp: z.string(),
  signature: z.string()
})

export const noAuthApiClient = new Zodios(apiBaseUrl, [
  {
    method: 'get',
    path: '/v1/config',
    alias: 'getConfiguration',
    response: ConfigurationApiResponseSchema
  },
  {
    method: 'post',
    path: '/v1/wallets/authorize',
    alias: 'authorizeWallet',
    parameters: [
      {
        name: 'payload',
        type: 'Body',
        schema: AuthorizeWalletRequestSchema
      }
    ],
    response: z.undefined(),
    errors: [
      {
        status: 'default',
        schema: ApiErrorsSchema
      }
    ]
  }
]);

export type LoadAuthTokenOptions = {
  forceRefresh: boolean
}

export class FunkybitClient {
  private config: FunkybitClientConfig;
  private authToken: string | undefined;
  private api

  constructor(config: FunkybitClientConfig) {
    this.config = config;
    this.authToken = undefined;

    this.api = new Zodios(apiBaseUrl, [
      {
        method: 'get',
        path: '/v1/account-config',
        alias: 'getAccountConfiguration',
        response: AccountConfigurationApiResponseSchema,
        errors: [
          {
            status: 'default',
            schema: ApiErrorsSchema
          }
        ]
      },
    ]);
    this.api.use(
      pluginToken({
        getToken: async () => {
          return this.loadAuthToken()
        },
        renewToken: async () => {
          return this.loadAuthToken({forceRefresh: true})
        }
      })
    );
  }

  async loadAuthToken( options: LoadAuthTokenOptions = { forceRefresh: false }
  ): Promise<string> {
      const existingToken = this.authToken
      if (existingToken && !options.forceRefresh) return existingToken
        const sessionKey = ethers.Wallet.createRandom()
        return this.signAuthToken(
          this.config.bitcoinWallet.address,
          0,
          sessionKey.address
        )
          .then((token) => {
            if (token == null) {
              // user has rejected signing the token, disconnect
              return ''
            } else {
              return token
            }
          })
          .catch((error) => {
            // user has rejected signing the token, disconnect
            throw error
          })
  }

  async evmSignTypedData<
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | 'EIP712Domain'
  >(
    parameters: SignTypedDataParameters<typedData, primaryType>,
  ): Promise<Hex | null> {
    const types = parameters.types as Record<string, Array<TypedDataField>>
    const primaryType = Object.keys(types).filter(
      (t) => t !== 'EIP712Domain'
    )[0]
    const typesToSign = {
      [primaryType]: types[primaryType]
    }
    return (await this.config.evmWallet.signTypedData(
      parameters.domain as TypedDataDomain,
      typesToSign,
      parameters.message as Record<string, string>
    )) as Hex
  }

  async signAuthToken(
    address: string,
    chainId: number,
    sessionKeyAddress: string
  ): Promise<string | null> {
    let ordinalsAddress: {
      address: string
      ownershipProof: { signature: string; timestamp: string } | null
    } | null = null

    if (chainId == 0) {
      const bitcoinOrdinalsAddress = this.config.bitcoinWallet.ordinalsAddress
      if (bitcoinOrdinalsAddress) {
        let ownershipProof = null
        if (bitcoinOrdinalsAddress !== address) {
          const timestamp = new Date().toISOString()
          const signature = await this.config.bitcoinWallet.signMessage(
            bitcoinOrdinalsAddress,
            `[funkybit] Please sign this message to verify your ownership of this wallet address. This action will not cost any gas fees.\nAddress: ${bitcoinOrdinalsAddress}, Timestamp: ${timestamp}`
          )

          if (signature == null) {
            return null
          } else {
            ownershipProof = { signature, timestamp }
          }
        }

        ordinalsAddress = {
          address: bitcoinOrdinalsAddress,
          ownershipProof: ownershipProof
        }
      }
    }

    const signInMessage = {
      message: `[funkybit] Please sign this message to verify your ownership of this wallet address. This action will not cost any gas fees.`,
      address: chainId > 0 ? address.toLowerCase() : address,
      chainId: chainId,
      timestamp: new Date().toISOString(),
      sessionKeyAddress: sessionKeyAddress,
      ordinalsAddress: ordinalsAddress
    }

    const signature =
      chainId > 0
        ? await this.evmSignTypedData(
          {
            domain: {
              name: 'funkybit',
              chainId: BigInt(chainId)
            },
            types: {
              EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'chainId', type: 'uint256' }
              ],
              'Sign In': [
                { name: 'message', type: 'string' },
                { name: 'address', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'timestamp', type: 'string' },
                { name: 'sessionKeyAddress', type: 'string' }
              ]
            },
            message: (function () {
              // drop ordinalsAddress field from message we request EVM wallet to sign
              // backend does not expect this field to be set

              /* eslint-disable */
              // lint disabled here because it complains about ordinalsAddress not being used
              const { ordinalsAddress, chainId, ...message } = signInMessage
              /* eslint-enable */
              return {chainId: BigInt(chainId), ...message}
            })(),
            primaryType: 'Sign In'
          }
        )
        : await (async () => {
          const secondLineParts = [
            `Address: ${address}`,
            ordinalsAddress
              ? `Ordinals Address: ${ordinalsAddress.address}`
              : null,
            `Timestamp: ${signInMessage.timestamp}`,
            `Session Key Address: ${signInMessage.sessionKeyAddress}`
          ].filter((it) => it !== null)

          return await this.config.bitcoinWallet.signMessage(
            address,
            signInMessage.message + '\n' + secondLineParts.join(', ')
          )
        })()

    if (signature == null) {
      return null
    }

    const signInMessageBody = base64urlEncode(
      new TextEncoder().encode(JSON.stringify(signInMessage))
    )
    this.authToken = `${signInMessageBody}.${signature}`
    return this.authToken
  }

  async login(): Promise<boolean> {
    if (!this.config.bitcoinWallet || !this.config.evmWallet) {
      throw new Error('Both Bitcoin and EVM wallets are required for login');
    }

    // First authenticate with Bitcoin wallet
    const config = await this.api.getAccountConfiguration()
    if (config.authorizedAddresses.length === 0) {

      const authorizedWalletAuthToken = await this.signAuthToken(
        this.config.evmWallet.address,
        this.config.evmWallet.chainId,
        ethers.Wallet.createRandom().address
      )
      if (authorizedWalletAuthToken != null) {
        const timestamp = new Date().toISOString()
        const authorizingWalletSignature = await this.config.bitcoinWallet.signMessage(
          this.config.bitcoinWallet.address,
          `[funkybit] Please sign this message to authorize EVM wallet ${this.config.evmWallet.address.toLowerCase()}. This action will not cost any gas fees.\nAddress: ${this.config.bitcoinWallet.address}, Timestamp: ${timestamp}`
        )

        await noAuthApiClient.authorizeWallet(
          {
            authorizedAddress: this.config.evmWallet.address,
            chainId: "bitcoin",
            address: this.config.bitcoinWallet.address,
            timestamp: timestamp,
            signature: authorizingWalletSignature
          },
          {
            headers: {
              Authorization: `Bearer ${authorizedWalletAuthToken}`
            }
          }
        )
      }
    }
    return true
  }
}