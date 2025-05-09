import { Zodios } from "@zodios/core";
import { pluginToken } from "@zodios/plugins";
import { z } from "zod";
import {
  BitcoinWallet,
  EvmWallet,
  AccountConfigurationApiResponseSchema,
  ConfigurationApiResponseSchema,
  ApiErrorsSchema,
  Deposit,
  Symbol,
  ConfigurationApiResponse,
  CreateDepositApiRequestSchema,
  DepositApiResponseSchema,
  Chain,
  evmAddress,
  CoinsSortOptionSchema,
  ListCoinsApiResponseSchema,
  CoinsSortOption,
  Coin,
  OrderSide,
  MarketWithSymbolInfosSchema,
  MarketWithSymbolInfos,
  CreateOrderRequestSchema,
  CreateOrderApiResponseSchema,
  ClientOrderId,
  OrderAmount,
  QuoteSymbol,
  Quote,
  GetBalancesApiResponseSchema,
  Balance,
  Order,
  Trade,
  Withdrawal,
  CreateWithdrawalApiRequestSchema,
  WithdrawalApiResponseSchema,
} from "./types.js";
import { ethers, TypedDataDomain, TypedDataField } from "ethers";
import { SignTypedDataParameters } from "@wagmi/core";
import {
  Address,
  encodeFunctionData,
  EncodeFunctionDataParameters,
  formatUnits,
  Hex,
  TypedData,
} from "viem";
import {
  base64urlEncode,
  fromFundamentalUnits,
  generateOrderNonce,
  getDomain,
} from "./utils.js";
import ERC20Abi from "./ERC20Abi.js";
import ExchangeAbi from "./ExchangeAbi.js";
import { Decimal } from "decimal.js";
import { BitcoinWalletImpl } from "./bitcoin-wallet.js";
import { v4 as uuidv4 } from "uuid";
import {
  quoteAmountMinusFeeToReceiveForSellingBase,
  quoteAmountRequiredForBuyingBaseIncludingFee,
} from "./quotes.js";
import { ExponentialBackoff, Websocket, WebsocketBuilder } from "websocket-ts";
import {
  AmmState,
  balancesTopic,
  IncomingWSMessage,
  marketAmmStateTopic,
  myOrdersTopic,
  myTradesTopic,
  OHLCDuration,
  OrderBook,
  orderBookTopic,
  Prices,
  pricesTopic,
  Publishable,
  PublishableSchema,
  SubscriptionTopic,
  UpdatedBalance,
} from "./websocketMessages.js";

export const apiBaseUrl =
  process.env.FUNKYBIT_API ?? "https://prod-api.funkybit.fun";

export interface FunkybitClientParams {
  bitcoinWallet: BitcoinWallet;
  evmWallet: EvmWallet;
}

const AuthorizeWalletRequestSchema = z.object({
  authorizedAddress: z.string(),
  chainId: z.string(),
  address: z.string(),
  timestamp: z.string(),
  signature: z.string(),
});

export const noAuthApiClient = new Zodios(apiBaseUrl, [
  {
    method: "get",
    path: "/v1/config",
    alias: "getConfiguration",
    response: ConfigurationApiResponseSchema,
  },
  {
    method: "post",
    path: "/v1/wallets/authorize",
    alias: "authorizeWallet",
    parameters: [
      {
        name: "payload",
        type: "Body",
        schema: AuthorizeWalletRequestSchema,
      },
    ],
    response: z.undefined(),
    errors: [
      {
        status: "default",
        schema: ApiErrorsSchema,
      },
    ],
  },
]);

export type LoadAuthTokenOptions = {
  forceRefresh: boolean;
};

type SubscriptionEventHandler = (
  data: Publishable,
  topic: SubscriptionTopic,
) => void;
type UnsubscriptionHandler = () => void;
const CloseEventCodeUnauthorized = 3000;

export class FunkybitClient {
  private params: FunkybitClientParams;
  private authToken: string | undefined;
  private api;
  private config: ConfigurationApiResponse | undefined;
  private ws: Websocket | undefined;
  private subscriptions: Map<string, SubscriptionEventHandler[]> = new Map();
  private adapterMarketOrderBook: OrderBook | undefined;
  private associatedSymbols: Map<string, Symbol> = new Map();
  myReferralCode: string | undefined = undefined
  referredBy: string | null = null
  loggedIn: boolean = false;

  constructor(params: FunkybitClientParams) {
    this.params = params;
    this.authToken = undefined;

    this.api = new Zodios(apiBaseUrl, [
      {
        method: "get",
        path: "/v1/account-config",
        alias: "getAccountConfiguration",
        response: AccountConfigurationApiResponseSchema,
        errors: [
          {
            status: "default",
            schema: ApiErrorsSchema,
          },
        ],
      },
      {
        method: "post",
        path: "/v1/deposits",
        alias: "createDeposit",
        parameters: [
          {
            name: "payload",
            type: "Body",
            schema: CreateDepositApiRequestSchema,
          },
        ],
        response: DepositApiResponseSchema,
        errors: [
          {
            status: "default",
            schema: ApiErrorsSchema,
          },
        ],
      },
      {
        method: "get",
        path: "/v1/coins",
        alias: "listCoins",
        response: ListCoinsApiResponseSchema,
        parameters: [
          {
            name: "sort",
            type: "Query",
            schema: CoinsSortOptionSchema,
          },
          {
            name: "search",
            type: "Query",
            schema: z.string(),
          },
          {
            name: "safe-search",
            type: "Query",
            schema: z.boolean(),
          },
        ],
      },
      {
        method: "get",
        path: "/v1/coin/:name/market",
        alias: "getCoinMarket",
        parameters: [
          {
            name: "name",
            type: "Path",
            schema: z.string(),
          },
        ],
        response: MarketWithSymbolInfosSchema,
        errors: [
          {
            status: "default",
            schema: ApiErrorsSchema,
          },
        ],
      },
      {
        method: "post",
        path: "/v1/orders",
        alias: "createOrder",
        parameters: [
          {
            name: "payload",
            type: "Body",
            schema: CreateOrderRequestSchema,
          },
        ],
        response: CreateOrderApiResponseSchema,
        errors: [
          {
            status: "default",
            schema: ApiErrorsSchema,
          },
        ],
      },
      {
        method: "get",
        path: "/v1/balances",
        alias: "getBalances",
        response: GetBalancesApiResponseSchema,
      },
      {
        method: "post",
        path: "/v1/withdrawals",
        alias: "createWithdrawal",
        parameters: [
          {
            name: "payload",
            type: "Body",
            schema: CreateWithdrawalApiRequestSchema,
          },
        ],
        response: WithdrawalApiResponseSchema,
        errors: [
          {
            status: "default",
            schema: ApiErrorsSchema,
          },
        ],
      },
      {
        method: 'post',
        path: '/v1/account-config/referred-by/:referralCode',
        alias: 'setReferredBy',
        parameters: [
          {
            name: 'referralCode',
            type: 'Path',
            schema: z.string()
          }
        ],
        response: z.undefined(),
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
          return this.loadAuthToken();
        },
        renewToken: async () => {
          return this.loadAuthToken({ forceRefresh: true });
        },
      }),
    );
  }

  async loadAuthToken(
    options: LoadAuthTokenOptions = { forceRefresh: false },
  ): Promise<string> {
    const existingToken = this.authToken;
    if (existingToken && !options.forceRefresh) return existingToken;
    const sessionKey = ethers.Wallet.createRandom();
    return this.signAuthToken(
      this.params.bitcoinWallet.address,
      0,
      sessionKey.address,
    )
      .then((token) => {
        if (token == null) {
          // user has rejected signing the token, disconnect
          return "";
        } else {
          return token;
        }
      })
      .catch((error) => {
        // user has rejected signing the token, disconnect
        throw error;
      });
  }

  async evmSignTypedData<
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain",
  >(
    parameters: SignTypedDataParameters<typedData, primaryType>,
  ): Promise<Hex | null> {
    const types = parameters.types as Record<string, Array<TypedDataField>>;
    const primaryType = Object.keys(types).filter(
      (t) => t !== "EIP712Domain",
    )[0];
    const typesToSign = {
      [primaryType]: types[primaryType],
    };
    return (await this.params.evmWallet.signTypedData(
      parameters.domain as TypedDataDomain,
      typesToSign,
      parameters.message as Record<string, string>,
    )) as Hex;
  }

  async signAuthToken(
    address: string,
    chainId: number,
    sessionKeyAddress: string,
  ): Promise<string | null> {
    let ordinalsAddress: {
      address: string;
      ownershipProof: { signature: string; timestamp: string } | null;
    } | null = null;

    if (chainId == 0) {
      const bitcoinOrdinalsAddress = this.params.bitcoinWallet.ordinalsAddress;
      if (bitcoinOrdinalsAddress) {
        let ownershipProof = null;
        if (bitcoinOrdinalsAddress !== address) {
          const timestamp = new Date().toISOString();
          const signature = await this.params.bitcoinWallet.signMessage(
            bitcoinOrdinalsAddress,
            `[funkybit] Please sign this message to verify your ownership of this wallet address. This action will not cost any gas fees.\nAddress: ${bitcoinOrdinalsAddress}, Timestamp: ${timestamp}`,
          );

          if (signature == null) {
            return null;
          } else {
            ownershipProof = { signature, timestamp };
          }
        }

        ordinalsAddress = {
          address: bitcoinOrdinalsAddress,
          ownershipProof: ownershipProof,
        };
      }
    }

    const signInMessage = {
      message: `[funkybit] Please sign this message to verify your ownership of this wallet address. This action will not cost any gas fees.`,
      address: chainId > 0 ? address.toLowerCase() : address,
      chainId: chainId,
      timestamp: new Date().toISOString(),
      sessionKeyAddress: sessionKeyAddress,
      ordinalsAddress: ordinalsAddress,
    };

    const signature =
      chainId > 0
        ? await this.evmSignTypedData({
            domain: {
              name: "funkybit",
              chainId: BigInt(chainId),
            },
            types: {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "chainId", type: "uint256" },
              ],
              "Sign In": [
                { name: "message", type: "string" },
                { name: "address", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "timestamp", type: "string" },
                { name: "sessionKeyAddress", type: "string" },
              ],
            },
            message: (function () {
              // drop ordinalsAddress field from message we request EVM wallet to sign
              // backend does not expect this field to be set

              /* eslint-disable */
              // lint disabled here because it complains about ordinalsAddress not being used
              const { ordinalsAddress, chainId, ...message } = signInMessage;
              /* eslint-enable */
              return { chainId: BigInt(chainId), ...message };
            })(),
            primaryType: "Sign In",
          })
        : await (async () => {
            const secondLineParts = [
              `Address: ${address}`,
              ordinalsAddress
                ? `Ordinals Address: ${ordinalsAddress.address}`
                : null,
              `Timestamp: ${signInMessage.timestamp}`,
              `Session Key Address: ${signInMessage.sessionKeyAddress}`,
            ].filter((it) => it !== null);

            return await this.params.bitcoinWallet.signMessage(
              address,
              signInMessage.message + "\n" + secondLineParts.join(", "),
            );
          })();

    if (signature == null) {
      return null;
    }

    const signInMessageBody = base64urlEncode(
      new TextEncoder().encode(JSON.stringify(signInMessage)),
    );
    this.authToken = `${signInMessageBody}.${signature}`;
    return this.authToken;
  }

  async refreshSymbols(): Promise<void> {
    const config = await this.api.getAccountConfiguration();
    config.associatedSymbols.forEach((symbol) => {
      this.associatedSymbols.set(symbol.name, symbol);
    });
  }

  associatedSymbolInfo(name: string) {
    return this.associatedSymbols.get(name);
  }

  async login(): Promise<void> {
    if (!this.params.bitcoinWallet || !this.params.evmWallet) {
      throw new Error("Both Bitcoin and EVM wallets are required for login");
    }

    if (this.loggedIn) {
      return;
    }

    this.config = await noAuthApiClient.getConfiguration();

    // First authenticate with Bitcoin wallet
    const config = await this.api.getAccountConfiguration();
    config.associatedSymbols.forEach((symbol) => {
      this.associatedSymbols.set(symbol.name, symbol);
    });

    this.myReferralCode = config.inviteCode
    this.referredBy = config.referredByNickName

    // link EVM if it is not already linked
    if (config.authorizedAddresses.length === 0) {
      const authorizedWalletAuthToken = await this.signAuthToken(
        this.params.evmWallet.address,
        this.params.evmWallet.chainId,
        ethers.Wallet.createRandom().address,
      );
      if (authorizedWalletAuthToken != null) {
        const timestamp = new Date().toISOString();
        const authorizingWalletSignature =
          await this.params.bitcoinWallet.signMessage(
            this.params.bitcoinWallet.address,
            `[funkybit] Please sign this message to authorize EVM wallet ${this.params.evmWallet.address.toLowerCase()}. This action will not cost any gas fees.\nAddress: ${this.params.bitcoinWallet.address}, Timestamp: ${timestamp}`,
          );

        await noAuthApiClient.authorizeWallet(
          {
            authorizedAddress: this.params.evmWallet.address,
            chainId: "bitcoin",
            address: this.params.bitcoinWallet.address,
            timestamp: timestamp,
            signature: authorizingWalletSignature,
          },
          {
            headers: {
              Authorization: `Bearer ${authorizedWalletAuthToken}`,
            },
          },
        );
      }
    }

    await this.connectWebsocket();
    this.subscribeToAdapterMarket();

    this.loggedIn = true;
    return;
  }

  async signUpWithReferralCode(referralCode: string): Promise<void> {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }

    await this.api.setReferredBy(undefined, {
      params: { referralCode }
    })

    const config = await this.api.getAccountConfiguration();
    this.referredBy = config.referredByNickName
    return;
  }

  async withdrawal(symbol: Symbol, amount: bigint): Promise<Withdrawal> {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    if (this.config !== undefined) {
      const chain = this.config.chains.find((c) => c.id === symbol.chainId);
      if (chain !== undefined) {
        const timestamp = new Date();
        if (symbol.chainId === "bitcoin") {
          let formattedAmount =
            amount === 0n ? "100% of" : formatUnits(amount, symbol.decimals);

          if (amount !== 0n && symbol.decimals > 0) {
            if (!formattedAmount.includes(".")) {
              formattedAmount = formattedAmount + ".";
            }

            formattedAmount = formattedAmount.padEnd(
              formattedAmount.split(".")[0].length + symbol.decimals + 1,
              "0",
            );
          }

          const address =
            (symbol.contractAddress?.split(":")?.length ?? 0) === 2
              ? this.params.bitcoinWallet.ordinalsAddress
              : this.params.bitcoinWallet.address;
          const signature = await this.params.bitcoinWallet.signMessage(
            address,
            `[funkybit] Please sign this message to authorize withdrawal of ${formattedAmount} ${
              symbol.name
            } from the exchange to your wallet.\nAddress: ${address}, Timestamp: ${timestamp.toISOString()}`,
          );
          return (
            await this.api.createWithdrawal({
              symbol: symbol.name,
              amount,
              nonce: timestamp.getTime(),
              signature,
            })
          ).withdrawal;
        } else {
          const exchangeContractAddress = this.baseChain()!.contracts!.find(
            (c) => c.name === "Exchange",
          )!.address;

          const signature = await this.evmSignTypedData({
            types: {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
              ],
              Withdraw: [
                { name: "sender", type: "address" },
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint64" },
              ],
            },
            domain: getDomain(exchangeContractAddress, Number(symbol.chainId)),
            primaryType: "Withdraw",
            message: {
              sender: this.params.evmWallet.address as Address,
              token: symbol.contractAddress as Address,
              amount: amount,
              nonce: BigInt(timestamp.getTime()),
            },
          });
          if (signature === null) {
            throw new Error("");
          } else {
            return (
              await this.api.createWithdrawal({
                symbol: symbol.name,
                amount,
                nonce: timestamp.getTime(),
                signature,
              })
            ).withdrawal;
          }
        }
      } else {
        throw new Error("Chain not found");
      }
    } else {
      throw new Error("Not configured yet");
    }
  }

  async deposit(symbol: Symbol, amount: bigint): Promise<Deposit> {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    if (this.config !== undefined) {
      const chain = this.config.chains.find((c) => c.id === symbol.chainId);
      if (chain !== undefined) {
        if (symbol.chainId === "bitcoin") {
          if (symbol.contractAddress === null) {
            const depositAddress = chain.contracts.find(
              (c) => c.name === "CoinProxy",
            )?.nativeDepositAddress;
            if (depositAddress !== undefined) {
              const txHash = await this.params.bitcoinWallet.sendTransaction(
                depositAddress,
                amount,
              );
              const response = await this.api.createDeposit({
                symbol: symbol.name,
                amount: amount,
                txHash,
              });
              return response.deposit;
            } else {
              throw new Error("Bitcoin deposit address not found");
            }
          } else {
            const depositAddress = chain.contracts.find(
              (c) => c.name === "CoinProxy",
            )?.tokenDepositAddress;
            if (depositAddress !== undefined) {
              const txHash =
                await this.params.bitcoinWallet.sendRuneTransaction(
                  symbol,
                  depositAddress,
                  amount,
                );
              const response = await this.api.createDeposit({
                symbol: symbol.name,
                amount: amount,
                txHash,
              });
              return response.deposit;
            } else {
              throw new Error("Rune deposit address not found");
            }
          }
        } else {
          await this.params.evmWallet.switchChain(Number(chain.id));
          const depositAddress = chain.contracts.find(
            (c) => c.name === "Exchange",
          )?.address;
          if (depositAddress !== undefined) {
            if (symbol.contractAddress === null) {
              const txHash = await this.params.evmWallet.sendTransaction(
                depositAddress,
                amount,
              );
              const response = await this.api.createDeposit({
                symbol: symbol.name,
                amount: amount,
                txHash,
              });
              return response.deposit;
            } else {
              const approvalTx = await this.params.evmWallet.sendTransaction(
                symbol.contractAddress,
                0n,
                encodeFunctionData({
                  abi: ERC20Abi,
                  args: [depositAddress, amount],
                  functionName: "approve",
                } as EncodeFunctionDataParameters),
              );
              await this.params.evmWallet.waitForTransactionReceipt(approvalTx);
              const depositTx = await this.params.evmWallet.sendTransaction(
                depositAddress,
                0n,
                encodeFunctionData({
                  abi: ExchangeAbi,
                  functionName: "deposit",
                  args: [evmAddress(symbol.contractAddress!), amount],
                }),
              );
              const response = await this.api.createDeposit({
                symbol: symbol.name,
                amount: amount,
                txHash: depositTx,
              });
              return response.deposit;
            }
          } else {
            throw new Error("EVM deposit address not found");
          }
        }
      } else {
        throw new Error("Chain not found");
      }
    } else {
      throw new Error("Not configured yet");
    }
  }

  bitcoin(): Chain | undefined {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    return this.config?.chains?.find((c) => c.id === "bitcoin");
  }

  bitcoinSymbol(): Symbol | undefined {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    return this.bitcoin()?.symbols?.find((s) => s.contractAddress === null);
  }

  baseChain(): Chain | undefined {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    return this.config?.chains?.find((c) => c.name.startsWith("Base"));
  }

  usdcSymbol(): Symbol | undefined {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    return this.baseChain()?.symbols?.find((s) => s.name.startsWith("USDC:"));
  }

  async search(
    sort: CoinsSortOption,
    search: string | undefined,
    safeSearch: boolean | undefined,
  ): Promise<Coin[]> {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    return (
      await this.api.listCoins({
        queries: {
          sort,
          search: search ?? "",
          "safe-search": safeSearch ?? false,
        },
      })
    ).coins;
  }

  subscribe(topic: SubscriptionTopic, handler: SubscriptionEventHandler) {
    const stringifiedTopic = JSON.stringify(topic);
    const topicSubscribers = this.subscriptions.get(stringifiedTopic) || [];
    if (topicSubscribers.length === 0) this.sendSubscribeMessage(topic);
    if (!topicSubscribers.includes(handler)) {
      topicSubscribers.push(handler);
    }
    this.subscriptions.set(stringifiedTopic, topicSubscribers);
  }

  unsubscribe(topic: SubscriptionTopic, handler: SubscriptionEventHandler) {
    const stringifiedTopic = JSON.stringify(topic);
    const topicSubscribers = this.subscriptions.get(stringifiedTopic);
    if (topicSubscribers) {
      const idx = topicSubscribers.indexOf(handler);
      if (idx != -1) {
        topicSubscribers.splice(idx, 1);
        if (topicSubscribers.length == 0) {
          this.subscriptions.delete(stringifiedTopic);
          this.sendUnsubscribeMessage(topic);
        }
      }
    }
  }

  sendSubscribeMessage(topic: SubscriptionTopic) {
    this.ws?.send(
      JSON.stringify({
        type: "Subscribe",
        topic: topic,
      }),
    );
  }

  sendUnsubscribeMessage(topic: SubscriptionTopic) {
    this.ws?.send(
      JSON.stringify({
        type: "Unsubscribe",
        topic: topic,
      }),
    );
  }

  handleMessage(ws: Websocket, event: MessageEvent) {
    const message = JSON.parse(event.data) as IncomingWSMessage;
    if (
      "type" in message &&
      message.type === "Publish" &&
      "topic" in message &&
      "data" in message
    ) {
      const stringifiedTopic = JSON.stringify(message.topic);
      const handlers = this.subscriptions.get(stringifiedTopic);
      if (handlers) {
        const parseResult = PublishableSchema.safeParse(message.data);
        if (parseResult.success) {
          handlers.forEach((handler) => {
            handler(parseResult.data, message.topic as SubscriptionTopic);
          });
        }
      }
    }
  }

  restoreSubscriptions() {
    for (const stringifiedTopic of this.subscriptions.keys()) {
      this.sendSubscribeMessage(JSON.parse(stringifiedTopic));
    }
  }

  private async connectWebsocket(refreshAuth: boolean = false) {
    const authQuery = `?auth=${await this.loadAuthToken({ forceRefresh: refreshAuth })}`;

    this.ws?.close();
    const connectionUrl =
      apiBaseUrl.replace("http:", "ws:").replace("https:", "wss:") + "/connect";

    this.ws = new WebsocketBuilder(connectionUrl + authQuery)
      .withBackoff(new ExponentialBackoff(1000, 4))
      .onMessage((ws, m) => {
        this.handleMessage(ws, m);
      })
      .onOpen(() => {
        this.restoreSubscriptions();
      })
      .onReconnect(() => {
        this.restoreSubscriptions();
      })
      .onClose((ws, event) => {
        if (event.code === CloseEventCodeUnauthorized) {
          this.connectWebsocket(true);
        }
      })
      .build();
  }

  private async signOrderCreation(
    wallet: BitcoinWallet | EvmWallet,
    chainId: number,
    nonce: string,
    exchangeContractAddress: string,
    baseSymbol: Symbol,
    quoteSymbol: Symbol,
    side: OrderSide,
    amount: bigint,
    limitPrice: Decimal | null,
    percentage: number | null,
  ): Promise<{ signature: string; signingAddress: string } | null> {
    if (!this.loggedIn) {
      throw new Error("Must be logged in first");
    }
    if (wallet instanceof BitcoinWalletImpl) {
      let swapMessage;
      if (percentage) {
        const percent = `${percentage}% of your`;
        swapMessage =
          side === "Buy"
            ? `Swap ${percent} ${quoteSymbol.name} for ${baseSymbol.name}`
            : `Swap ${percent} ${baseSymbol.name} for ${quoteSymbol.name}`;
      } else {
        const formattedAmount = fromFundamentalUnits(
          amount < 0 ? -amount : amount,
          baseSymbol.decimals,
        );
        swapMessage =
          side === "Buy"
            ? `Swap ${quoteSymbol.name} for ${formattedAmount} ${baseSymbol.name}`
            : `Swap ${formattedAmount} ${baseSymbol.name} for ${quoteSymbol.name}`;
      }

      const signature = await this.params.bitcoinWallet.signMessage(
        wallet.address,
        `[funkybit] Please sign this message to authorize a swap. This action will not cost any gas fees.\n${swapMessage}${
          limitPrice ? `\nPrice: ${limitPrice}` : `\nPrice: Market`
        }\nAddress: ${wallet.address}, Nonce: ${nonce}`,
      );
      if (signature !== null) {
        return { signature, signingAddress: wallet.address };
      } else {
        return null;
      }
    } else {
      const limitPriceAsBigInt = limitPrice
        ? BigInt(
            limitPrice
              .mul(new Decimal(10).pow(quoteSymbol.decimals))
              .floor()
              .toFixed(0),
          )
        : 0n;

      const signature = percentage
        ? await this.params.evmWallet.signTypedData(
            getDomain(exchangeContractAddress, chainId),
            {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
              ],
              PercentageOrder: [
                { name: "sender", type: "string" },
                { name: "baseChainId", type: "uint256" },
                { name: "baseToken", type: "string" },
                { name: "quoteChainId", type: "uint256" },
                { name: "quoteToken", type: "string" },
                { name: "percentage", type: "int256" },
                { name: "price", type: "uint256" },
                { name: "nonce", type: "int256" },
              ],
            },
            {
              sender: this.params.evmWallet.address.toString(),
              baseChainId:
                baseSymbol.chainId === "bitcoin"
                  ? 0
                  : BigInt(baseSymbol.chainId),
              baseToken:
                baseSymbol.contractAddress ??
                "0x0000000000000000000000000000000000000000",
              quoteChainId:
                baseSymbol.chainId === "bitcoin"
                  ? 0
                  : BigInt(quoteSymbol.chainId),
              quoteToken:
                quoteSymbol.contractAddress ??
                "0x0000000000000000000000000000000000000000",
              percentage: BigInt(percentage),
              price: limitPriceAsBigInt,
              nonce: BigInt("0x" + nonce),
            },
          )
        : await this.params.evmWallet.signTypedData(
            getDomain(exchangeContractAddress, chainId),
            {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
              ],
              Order: [
                { name: "sender", type: "string" },
                { name: "baseChainId", type: "uint256" },
                { name: "baseToken", type: "string" },
                { name: "quoteChainId", type: "uint256" },
                { name: "quoteToken", type: "string" },
                { name: "amount", type: "int256" },
                { name: "price", type: "uint256" },
                { name: "nonce", type: "int256" },
              ],
            },
            {
              sender: this.params.evmWallet.address.toString(),
              baseChainId:
                baseSymbol.chainId === "bitcoin"
                  ? 0
                  : BigInt(baseSymbol.chainId),
              baseToken:
                baseSymbol.contractAddress ??
                "0x0000000000000000000000000000000000000000",
              quoteChainId:
                quoteSymbol.chainId === "bitcoin"
                  ? 0
                  : BigInt(quoteSymbol.chainId),
              quoteToken:
                quoteSymbol.contractAddress ??
                "0x0000000000000000000000000000000000000000",
              amount: amount,
              price: limitPriceAsBigInt,
              nonce: BigInt("0x" + nonce),
            },
          );
      if (signature !== null) {
        return {
          signature,
          signingAddress: this.params.evmWallet.address.toString(),
        };
      } else {
        return null;
      }
    }
  }

  async getMarket(coin: Coin): Promise<MarketWithSymbolInfos> {
    return await this.api.getCoinMarket({ params: { name: coin.symbol.name } });
  }

  private findSymbolByName(name: string): Symbol | undefined {
    let ret: Symbol | undefined;
    this.config?.chains?.forEach((c) => {
      c.symbols.forEach((s) => {
        if (s.name === name) {
          ret = s;
          return;
        }
      });
      if (ret !== undefined) {
        {
          return;
        }
      }
    });
    return ret;
  }

  private adapterMarket(): MarketWithSymbolInfos {
    const market = this.config!.markets[0];
    return {
      ...market,
      baseSymbol: this.findSymbolByName(market.baseSymbol)!,
      quoteSymbol: this.findSymbolByName(market.quoteSymbol)!,
    };
  }

  private subscribeToAdapterMarket() {
    this.subscribe(orderBookTopic(this.adapterMarket().id), (message) => {
      if (message.type == "OrderBook") {
        this.adapterMarketOrderBook = message;
      }
    });
  }

  async getQuote(
    market: MarketWithSymbolInfos,
    side: OrderSide,
    amount: bigint,
    inAsset: QuoteSymbol,
  ): Promise<Quote> {
    const quoteSymbol =
      inAsset === "BTC" ? this.bitcoinSymbol() : this.usdcSymbol();
    let ammState: AmmState | undefined;
    const handler = (message: Publishable) => {
      if (message.type === "MarketAmmState") {
        ammState = message.ammState;
      }
    };
    return new Promise((resolve, reject) => {
      let interval: NodeJS.Timeout;
      try {
        // subscribe to the market amm state
        this.subscribe(marketAmmStateTopic(market.id), handler);
        // wait up to 10 seconds to get the state
        const start = new Date().getTime();
        interval = setInterval(() => {
          if (ammState !== undefined) {
            const adapterMarketState =
              this.adapterMarket().baseSymbol.name === quoteSymbol?.name
                ? {
                    market: this.adapterMarket(),
                    orderBook: this.adapterMarketOrderBook!,
                    feeRates: this.config!.feeRates!,
                  }
                : null;
            const quoteAmount =
              side === "Buy"
                ? quoteAmountRequiredForBuyingBaseIncludingFee(
                    amount,
                    market,
                    ammState,
                    adapterMarketState,
                  )
                : quoteAmountMinusFeeToReceiveForSellingBase(
                    amount,
                    market,
                    ammState,
                    adapterMarketState,
                  );
            this.unsubscribe(marketAmmStateTopic(market.id), handler);

            clearInterval(interval);
            if (quoteAmount === null) {
              reject("Unable to get quote");
            } else {
              resolve({ market, side, amount, quote: quoteAmount, inAsset });
            }
          }
          if (new Date().getTime() - start > 1000 * 10) {
            clearInterval(interval);
            reject("Timeout getting amm state");
          }
        }, 20);
      } catch (e) {
        reject(e);
      }
    });
  }

  async placeOrder(
    quote: Quote,
    slippageTolerance: Decimal = new Decimal("0.02"),
  ) {
    const nonce = generateOrderNonce();
    const signatureAndSigningAddress = (await this.signOrderCreation(
      this.params.bitcoinWallet,
      0,
      nonce,
      this.baseChain()!.contracts!.find((c) => c.name === "Exchange")!.address,
      quote.market.baseSymbol,
      quote.inAsset === "BTC"
        ? this.adapterMarket().baseSymbol
        : quote.market.quoteSymbol,
      quote.side,
      quote.amount,
      null,
      null,
    ))!;

    const commonRequestParams = {
      nonce: nonce,
      marketId: quote.market.id,
      side: quote.side,
      amount: { type: "fixed", value: quote.amount } as OrderAmount,
      signature: signatureAndSigningAddress.signature,
      signingAddress: signatureAndSigningAddress.signingAddress,
      verifyingChainId: "0",
      captchaToken: "",
      clientOrderId: uuidv4() as ClientOrderId,
      slippageTolerance: slippageTolerance.eq(new Decimal(0))
        ? null
        : {
            expectedNotionalWithFee: quote.quote,
            maxDeviation: slippageTolerance,
          },
    };
    return await this.api.createOrder(
      quote.inAsset === "USDC"
        ? {
            type: "market",
            baseTokenContractAddress: quote.market.baseSymbol.contractAddress,
            ...commonRequestParams,
          }
        : {
            type: "backToBackMarket",
            adapterMarketId: this.adapterMarket().id,
            ...commonRequestParams,
          },
    );
  }

  shutdown() {
    this.ws?.close();
  }

  async balances(): Promise<Balance[]> {
    return (await this.api.getBalances()).balances;
  }

  subscribeToBalances(
    full: (balances: Balance[]) => void,
    update: (update: UpdatedBalance[]) => void,
  ): UnsubscriptionHandler {
    const handler = (message: Publishable) => {
      switch (message.type) {
        case "Balances":
          full(message.balances);
          break;
        case "BalancesUpdated":
          update(message.balances);
          break;
      }
    };
    this.subscribe(balancesTopic, handler);
    return () => this.unsubscribe(balancesTopic, handler);
  }

  subscribeToOrders(
    onOrders: (orders: Order[]) => void,
  ): UnsubscriptionHandler {
    const handler = (message: Publishable) => {
      switch (message.type) {
        case "MyOrders":
        case "MyOrdersCreated":
        case "MyOrdersUpdated":
          onOrders(message.orders);
          break;
      }
    };
    this.subscribe(myOrdersTopic, handler);
    return () => this.unsubscribe(myOrdersTopic, handler);
  }

  subscribeToTrades(
    onTrades: (trades: Trade[]) => void,
  ): UnsubscriptionHandler {
    const handler = (message: Publishable) => {
      switch (message.type) {
        case "MyTrades":
        case "MyTradesCreated":
        case "MyTradesUpdated":
          onTrades(message.trades);
          break;
      }
    };
    this.subscribe(myTradesTopic, handler);
    return () => this.unsubscribe(myTradesTopic, handler);
  }

  subscribeToPrices(
    marketId: string,
    duration: OHLCDuration,
    onPrices: (prices: Prices) => void,
  ): UnsubscriptionHandler {
    const handler = (message: Publishable) => {
      switch (message.type) {
        case "Prices":
          onPrices(message);
          break;
      }
    };
    this.subscribe(pricesTopic(marketId, duration), handler);
    return () => this.unsubscribe(pricesTopic(marketId, duration), handler);
  }
}
