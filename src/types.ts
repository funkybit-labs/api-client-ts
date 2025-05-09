import { z } from "zod";
import { Decimal } from "decimal.js";
import { TypedDataDomain, TypedDataField } from "ethers";

/**
 * Base interface for all wallet types
 */
export interface BaseWallet {
  /** The wallet's address */
  address: string;
}

/**
 * Interface for EVM-compatible wallets
 */
export interface EvmWallet extends BaseWallet {
  /** The chain ID for the EVM wallet */
  chainId: number;
  /**
   * Signs a login message using EIP-712
   * @param domain The domain data
   * @param types The type definitions
   * @param value The value to sign
   * @returns Promise resolving to the signature
   */
  signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ) => Promise<string>;

  /**
   * Executes a read-only contract call
   * @param to The contract address
   * @param data The encoded function call data
   * @returns Promise resolving to the call result
   */
  call: (to: string, data: string) => Promise<string>;

  /**
   * Sends a transaction
   * @param to The recipient address
   * @param value The amount to send (in native currency)
   * @param data Optional transaction data
   * @returns Promise resolving to the transaction hash
   */
  sendTransaction: (
    to: string,
    value: bigint,
    data?: string,
  ) => Promise<string>;

  /**
   * Estimates gas cost for a transaction
   * @param to The recipient address
   * @param value The amount to send (in native currency)
   * @param data Optional transaction data
   * @returns Promise resolving to the estimated gas cost
   */
  estimateGas: (to: string, value: bigint, data?: string) => Promise<bigint>;

  /**
   * Waits for a transaction receipt
   * @param txHash The transaction hash
   */
  waitForTransactionReceipt: (txHash: string) => Promise<void>;

  /**
   * Switches to a different chain
   * @param chainId The chain ID to switch to
   */
  switchChain: (chainId: number) => Promise<void>;
}

/**
 * Interface for Bitcoin wallets
 */
export interface BitcoinWallet extends BaseWallet {
  /** The ordinals address */
  ordinalsAddress: string;
  /**
   * Signs a message
   * @param address The address to sign for
   * @param message The message to sign
   * @returns Promise resolving to the signature
   */
  signMessage: (address: string, message: string) => Promise<string>;

  /**
   * Sends a Bitcoin transaction
   * @param to The recipient address
   * @param amount The amount to send (in satoshis)
   * @returns Promise resolving to the transaction hash
   */
  sendTransaction: (to: string, amount: bigint) => Promise<string>;

  /**
   * Sends a Bitcoin transaction
   * @param symbol The rune symbol
   * @param to The recipient address
   * @param amount The amount to send (in units)
   * @returns Promise resolving to the transaction hash
   */
  sendRuneTransaction: (
    symbol: Symbol,
    to: string,
    amount: bigint,
  ) => Promise<string>;
  /**
   * Estimates the fee for a Bitcoin transaction
   * @returns Promise resolving to the estimated fee in satoshis
   */
  estimateFee: () => Promise<bigint>;
}
declare global {
  interface BigInt {
    toJSON(): Number;
  }
}

BigInt.prototype.toJSON = function () {
  return Number(this);
};

const AuthorizeWalletRequestSchema = z.object({
  authorizedAddress: z.string(),
  chainId: z.string(),
  address: z.string(),
  timestamp: z.string(),
  signature: z.string(),
});

const SetOrdinalsAddressRequestSchema = z.object({
  ordinalsAddress: z.string(),
  proofs: z
    .object({
      addressOwnershipProof: z.string(),
      authorizationProof: z.string(),
      timestamp: z.string(),
    })
    .nullable(),
});

/**
 * Wallet network type
 */
export const WalletNetworkTypeSchema = z.enum(["Bitcoin", "Evm"]);
export type WalletNetworkType = z.infer<typeof WalletNetworkTypeSchema>;

/**
 * Authorized address schema
 */
export const AuthorizedAddressSchema = z.object({
  address: z.string(),
  networkType: WalletNetworkTypeSchema,
});
export type AuthorizedAddress = z.infer<typeof AuthorizedAddressSchema>;

/**
 * Account configuration response schema
 */
export const AccountConfigurationSchema = z.object({
  id: z.string(),
  newSymbols: z.array(z.any()), // We'll define SymbolSchema later
  associatedSymbols: z.array(z.any()), // We'll define SymbolSchema later
  role: z.enum(["User", "Admin"]),
  authorizedAddresses: z.array(AuthorizedAddressSchema),
  nickName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  inviteCode: z.string(),
  ordinalsAddress: z.string().nullable(),
  funkybits: z.any(), // We'll define decimal schema later
});
export type AccountConfiguration = z.infer<typeof AccountConfigurationSchema>;

export const decimal = () =>
  z
    .instanceof(Decimal)
    .or(z.string())
    .or(z.number())
    .transform((value, ctx) => {
      try {
        return new Decimal(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value} can't be parsed into Decimal: ${error}`,
        });
        return z.NEVER;
      }
    });
export const FEE_RATE_PIPS_MAX_VALUE = 1000000;

const feeRatePips = () =>
  decimal().transform((decimalFee) => {
    return BigInt(decimalFee.mul(FEE_RATE_PIPS_MAX_VALUE).toNumber());
  });

export const EvmAddressSchema = z.custom<`0x${string}`>((val: unknown) =>
  /^0x/.test(val as string),
);
export type EvmAddressType = z.infer<typeof EvmAddressSchema>;
export const evmAddress = (address: string): EvmAddressType => {
  // will throw if the address is invalid
  return EvmAddressSchema.parse(address);
};
export const AddressSchema = z.string().min(1);
export type AddressType = z.infer<typeof AddressSchema>;

export const UserIdSchema = z.string();
export type UserId = z.infer<typeof UserIdSchema>;

const ContractSchema = z.object({
  name: z.string(),
  address: AddressSchema,
  nativeDepositAddress: AddressSchema,
  tokenDepositAddress: AddressSchema,
});

export type Contract = z.infer<typeof ContractSchema>;

const CoinCreatorRefSchema = z.object({
  name: z.string(),
  userId: UserIdSchema,
});
export type CoinCreatorRef = z.infer<typeof CoinCreatorRefSchema>;

const SymbolSchema = z.object({
  name: z.string(),
  description: z.string(),
  contractAddress: AddressSchema.nullable(),
  decimals: z.number(),
  faucetSupported: z.boolean(),
  iconUrl: z.string(),
  withdrawalFee: z.coerce.bigint(),
  chainId: z.string(),
  chainName: z.string(),
  nameOnChain: z.string().nullable().optional(),
});

export type Symbol = z.infer<typeof SymbolSchema>;

const ChainSchema = z.object({
  id: z.string(),
  name: z.string(),
  contracts: z.array(ContractSchema),
  symbols: z.array(SymbolSchema),
  jsonRpcUrl: z.string(),
  blockExplorerNetName: z.string(),
  blockExplorerUrl: z.string(),
});
export type Chain = z.infer<typeof ChainSchema>;

const MarketSchema = z.object({
  type: z.literal("Clob"),
  id: z.string(),
  baseSymbol: z.string(),
  quoteSymbol: z.string(),
  tickSize: decimal(),
  lastPrice: decimal(),
  minFee: z.coerce.bigint(),
  feeRate: decimal(),
});
export type Market = z.infer<typeof MarketSchema>;

const MarketTypeSchema = z.enum(["Clob", "BondingCurve", "Amm"]);
export type MarketType = z.infer<typeof MarketTypeSchema>;

export const MarketWithSymbolInfosSchema = z.object({
  id: z.string(),
  baseSymbol: SymbolSchema,
  quoteSymbol: SymbolSchema,
  tickSize: decimal(),
  lastPrice: decimal(),
  minFee: z.coerce.bigint(),
  feeRate: decimal(),
  type: MarketTypeSchema,
});

export type MarketWithSymbolInfos = z.infer<typeof MarketWithSymbolInfosSchema>;

const FeeRatesSchema = z.object({
  maker: feeRatePips(),
  taker: feeRatePips(),
});
export type FeeRates = z.infer<typeof FeeRatesSchema>;

const SetFeeRatesSchema = z.object({
  maker: z.coerce.bigint(),
  taker: z.coerce.bigint(),
});

export type SetFeeRates = z.infer<typeof SetFeeRatesSchema>;

export const ConfigurationApiResponseSchema = z.object({
  chains: z.array(ChainSchema),
  markets: z.array(MarketSchema),
  feeRates: FeeRatesSchema,
  minimumRune: z.string(),
});
export type ConfigurationApiResponse = z.infer<
  typeof ConfigurationApiResponseSchema
>;

export const AccountConfigurationApiResponseSchema = z.object({
  id: UserIdSchema,
  newSymbols: z.array(SymbolSchema),
  associatedSymbols: z.array(SymbolSchema),
  role: z.enum(["User", "Admin"]),
  authorizedAddresses: z.array(AuthorizedAddressSchema),
  nickName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  inviteCode: z.string(),
  ordinalsAddress: AddressSchema.nullable(),
  funkybits: decimal(),
});
export type AccountConfigurationApiResponse = z.infer<
  typeof AccountConfigurationApiResponseSchema
>;

export const ApiErrorsSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export const CreateDepositApiRequestSchema = z.object({
  symbol: z.string(),
  amount: z.coerce.bigint(),
  txHash: z.string(),
});

const DepositStatusSchema = z.enum(["Pending", "Complete", "Failed"]);
export type DepositStatus = z.infer<typeof DepositStatusSchema>;

const DepositSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  txHash: z.string(),
  amount: z.coerce.bigint(),
  status: DepositStatusSchema,
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Deposit = z.infer<typeof DepositSchema>;

export const DepositApiResponseSchema = z.object({
  deposit: DepositSchema,
});

const ListDepositsApiResponseSchema = z.object({
  deposits: z.array(DepositSchema),
});

export const CreateWithdrawalApiRequestSchema = z.object({
  symbol: z.string(),
  amount: z.coerce.bigint(),
  nonce: z.number(),
  signature: z.string(),
});

const WithdrawalStatusSchema = z.enum([
  "Pending",
  "Sequenced",
  "Settling",
  "Complete",
  "Failed",
]);
export type WithdrawalStatus = z.infer<typeof WithdrawalStatusSchema>;
const WithdrawalSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  txHash: z.string().nullable(),
  amount: z.coerce.bigint(),
  status: WithdrawalStatusSchema,
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
  fee: z.coerce.bigint(),
});
export type Withdrawal = z.infer<typeof WithdrawalSchema>;

export const WithdrawalApiResponseSchema = z.object({
  withdrawal: WithdrawalSchema,
});

const ListWithdrawalsApiResponseSchema = z.object({
  withdrawals: z.array(WithdrawalSchema),
});

export const SymbolLinkTypeSchema = z.enum(["Web", "X", "Telegram", "Discord"]);

export type SymbolLinkType = z.infer<typeof SymbolLinkTypeSchema>;

const SymbolLinkSchema = z.object({
  type: SymbolLinkTypeSchema,
  url: z.string(),
});

const CoinStatus = z.enum([
  "Pending",
  "BondingCurveAmm",
  "Graduating",
  "ConstantProductAmm",
]);

export const CoinSchema = z.object({
  symbol: SymbolSchema,
  createdBy: CoinCreatorRefSchema.nullable(),
  createdAt: z.coerce.date(),
  currentPrice: decimal(),
  marketCap: decimal(),
  lastTradedAt: z.coerce.date().nullable(),
  progress: decimal().nullable(),
  status: CoinStatus,
  sequenceNumber: z.number(),
  h24Change: decimal(),
  d7Change: decimal(),
  h24Volume: decimal(),
  tvl: decimal(),
  h24PoolVolume: decimal(),
  h24PoolFees: decimal(),
  h24MinPoolYield: decimal(),
  h24MaxPoolYield: decimal(),
  lastPoolCreatedAt: z.coerce.date().nullable(),
  links: z.array(SymbolLinkSchema),
});
export type Coin = z.infer<typeof CoinSchema>;
export const ListCoinsApiResponseSchema = z.object({
  coins: z.array(CoinSchema),
});
export type ListCoinsApiResponse = z.infer<typeof ListCoinsApiResponseSchema>;

export const CoinsSortOptionSchema = z.enum([
  // home
  "Trending",
  "MarketCap",
  "NewCoins",
  "Faves",
  "FunkedUp",
  // pools
  "NewestPool",
  "Tvl",
  "H24Volume",
  "Yield",
  "H24Fees",
]);
export type CoinsSortOption = z.infer<typeof CoinsSortOptionSchema>;

export const CoinPoolsListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  feeRate: decimal(),
  tvl: decimal(),
  h24Volume: decimal(),
  h24Fees: decimal(),
  h24Yield: decimal(),
  createdAt: z.coerce.date().nullable(),
});
export type CoinPoolsListItem = z.infer<typeof CoinPoolsListItemSchema>;

const ListCoinPoolsApiResponseSchema = z.object({
  pools: z.array(CoinPoolsListItemSchema),
});

const OrderSideSchema = z.enum(["Buy", "Sell"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

const FixedAmountSchema = z.object({
  type: z.literal("fixed"),
  value: z.coerce.bigint(),
});

const PercentAmountSchema = z.object({
  type: z.literal("percent"),
  value: z.number(),
});

const OrderAmountSchema = z.discriminatedUnion("type", [
  FixedAmountSchema,
  PercentAmountSchema,
]);
export type OrderAmount = z.infer<typeof OrderAmountSchema>;

const OrderSlippageToleranceSchema = z.object({
  expectedNotionalWithFee: z.coerce.bigint(),
  maxDeviation: decimal(),
});

export type ClientOrderId = string;

export const CreateMarketOrderSchema = z.object({
  nonce: z.string(),
  type: z.literal("market"),
  marketId: z.string(),
  side: OrderSideSchema,
  amount: OrderAmountSchema,
  signature: z.string(),
  signingAddress: z.string(),
  verifyingChainId: z.string(),
  clientOrderId: z.string().nullable(),
  captchaToken: z.string().nullable(),
  slippageTolerance: OrderSlippageToleranceSchema.nullable(),
  baseTokenContractAddress: z.string().nullable(),
});
export type CreateMarketOrder = z.infer<typeof CreateMarketOrderSchema>;

export const CreateBackToBackMarketOrderSchema = z.object({
  nonce: z.string(),
  type: z.literal("backToBackMarket"),
  marketId: z.string(),
  adapterMarketId: z.string(),
  side: OrderSideSchema,
  amount: OrderAmountSchema,
  signature: z.string(),
  signingAddress: z.string(),
  verifyingChainId: z.string(),
  clientOrderId: z.string().nullable(),
  captchaToken: z.string().nullable(),
  slippageTolerance: OrderSlippageToleranceSchema.nullable(),
});
export type CreateBackToBackMarketOrder = z.infer<
  typeof CreateBackToBackMarketOrderSchema
>;

export const CreateLimitOrderSchema = z.object({
  nonce: z.string(),
  type: z.literal("limit"),
  marketId: z.string(),
  side: OrderSideSchema,
  amount: OrderAmountSchema,
  price: decimal(),
  signature: z.string(),
  signingAddress: z.string(),
  verifyingChainId: z.string(),
  clientOrderId: z.string().nullable(),
  captchaToken: z.string().nullable(),
});
export type CreateLimitOrder = z.infer<typeof CreateLimitOrderSchema>;

export const CreateOrderRequestSchema = z.discriminatedUnion("type", [
  CreateMarketOrderSchema,
  CreateLimitOrderSchema,
  CreateBackToBackMarketOrderSchema,
]);
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

const RequestStatusSchema = z.enum(["Accepted", "Rejected"]);
export const CreateOrderApiResponseSchema = z.object({
  orderId: z.string(),
  requestStatus: RequestStatusSchema,
});

const OrderTimingSchema = z.object({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  sequencerTimeNs: z.coerce.bigint(),
});

const OrderStatusSchema = z.enum([
  "Open",
  "Partial",
  "Filled",
  "Cancelled",
  "Expired",
  "Failed",
  "Rejected",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
const ExecutionRoleSchema = z.enum(["Maker", "Taker"]);
export type ExecutionRole = z.infer<typeof ExecutionRoleSchema>;

const OrderExecutionSchema = z.object({
  timestamp: z.coerce.date(),
  amount: z.coerce.bigint(),
  price: decimal(),
  role: ExecutionRoleSchema,
  feeAmount: z.coerce.bigint(),
  feeSymbol: z.string(),
  marketId: z.string(),
});
const MarketOrderSchema = z.object({
  id: z.string(),
  type: z.literal("market"),
  status: OrderStatusSchema,
  marketId: z.string(),
  side: OrderSideSchema,
  amount: z.coerce.bigint(),
  executions: z.array(OrderExecutionSchema),
  timing: OrderTimingSchema,
});

const LimitOrderSchema = z.object({
  id: z.string(),
  type: z.literal("limit"),
  status: OrderStatusSchema,
  marketId: z.string(),
  side: OrderSideSchema,
  amount: z.coerce.bigint(),
  price: decimal(),
  originalAmount: z.coerce.bigint(),
  autoReduced: z.boolean(),
  executions: z.array(OrderExecutionSchema),
  timing: OrderTimingSchema,
});

const BackToBackMarketOrderSchema = z.object({
  id: z.string(),
  type: z.literal("backToBackMarket"),
  status: OrderStatusSchema,
  marketId: z.string(),
  adapterMarketId: z.string(),
  side: OrderSideSchema,
  amount: z.coerce.bigint(),
  executions: z.array(OrderExecutionSchema),
  timing: OrderTimingSchema,
});

export const OrderSchema = z
  .discriminatedUnion("type", [
    MarketOrderSchema,
    LimitOrderSchema,
    BackToBackMarketOrderSchema,
  ])
  .transform((data) => {
    return {
      ...data,
      isFinal: function (): boolean {
        return (
          ["Filled", "Cancelled", "Expired", "Failed", "Rejected"].includes(
            data.status as string,
          ) ||
          (data.status == "Partial" &&
            (data.type === "market" || data.type === "backToBackMarket"))
        );
      },
    };
  });
export type Order = z.infer<typeof OrderSchema>;

const TradeSettlementStatusSchema = z.enum([
  "Pending",
  "Settling",
  "FailedSettling",
  "Completed",
  "Failed",
]);
export type TradeSettlementStatus = z.infer<typeof TradeSettlementStatusSchema>;

export const TradeSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  orderId: z.string(),
  executionRole: ExecutionRoleSchema,
  counterOrderId: z.string(),
  marketId: z.string(),
  side: OrderSideSchema,
  amount: z.coerce.bigint(),
  price: decimal(),
  feeAmount: z.coerce.bigint(),
  feeSymbol: z.string(),
  settlementStatus: TradeSettlementStatusSchema,
});
export type Trade = z.infer<typeof TradeSchema>;

export const BalanceSchema = z.object({
  symbol: z.string(),
  total: z.coerce.bigint(),
  available: z.coerce.bigint(),
  lastUpdated: z.coerce.date(),
  usdcValue: decimal(),
});
export type Balance = z.infer<typeof BalanceSchema>;

export const GetBalancesApiResponseSchema = z.object({
  balances: z.array(BalanceSchema),
});

export const GetWalletBalanceApiResponseSchema = z.object({
  balance: z.coerce.bigint(),
});

export const MarketTradeFields = {
  ID: 0,
  SIDE: 1,
  AMOUNT: 2,
  PRICE: 3,
  NOTIONAL: 4,
  TIMESTAMP: 5,
  TAKER_NICKNAME: 6,
  TAKER_ID: 7,
} as const;
export const MarketTradeSchema = z.tuple([
  z.string(), // trade id
  OrderSideSchema, // type
  z.coerce.bigint(), // amount
  decimal(), // price
  z.coerce.bigint(), // notional
  z.coerce.date(), // timestamp
  z.string(), // taker nickname
  UserIdSchema, // taker id
]);
export type MarketTrade = z.infer<typeof MarketTradeSchema>;

const MarketTradesApiResponse = z.object({
  marketId: z.string(),
  trades: z.array(MarketTradeSchema),
});
export type MarketTradesApiResponseType = z.infer<
  typeof MarketTradesApiResponse
>;

export const CoinCommentSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  authorId: UserIdSchema,
  authorNickName: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
  content: z.string(),
  isMention: z.coerce.boolean(),
  isMentionUnread: z.coerce.boolean(),
});
export type CoinComment = z.infer<typeof CoinCommentSchema>;

export type QuoteSymbol = "USDC" | "BTC";
export type Quote = {
  market: MarketWithSymbolInfos;
  side: OrderSide;
  amount: bigint;
  quote: bigint;
  inAsset: QuoteSymbol;
};

// Maestro API Schemas

/**
 * MaestroApi schemas for Bitcoin operations
 */

/**
 * Block schema
 */
export const BlockSchema = z.object({
  height: z.number(),
});
export type Block = z.infer<typeof BlockSchema>;

/**
 * Block response schema
 */
export const BlockResponseSchema = z.object({
  data: BlockSchema,
});
export type BlockResponse = z.infer<typeof BlockResponseSchema>;

/**
 * Estimate fee schema
 */
export const EstimateFeeSchema = z.object({
  feerate: decimal(),
});
export type EstimateFee = z.infer<typeof EstimateFeeSchema>;

/**
 * Estimate fee response schema
 */
export const EstimateFeeResponseSchema = z.object({
  data: EstimateFeeSchema,
});
export type EstimateFeeResponse = z.infer<typeof EstimateFeeResponseSchema>;

/**
 * Script public key schema
 */
export const ScriptPubKeySchema = z.object({
  address: z.string().nullable(),
});
export type ScriptPubKey = z.infer<typeof ScriptPubKeySchema>;

/**
 * Transaction output schema
 */
export const VOutSchema = z.object({
  value: decimal(),
  script_pub_key: ScriptPubKeySchema.nullable(),
});
export type VOut = z.infer<typeof VOutSchema>;

/**
 * Transaction input schema
 */
export const VInSchema = z.object({
  txid: z.string(),
  vout: z.number(),
});
export type VIn = z.infer<typeof VInSchema>;

/**
 * Transaction schema
 */
export const TransactionSchema = z.object({
  txid: z.string(),
  version: z.number(),
  size: z.number(),
  weight: z.number(),
  confirmations: z.number(),
  vins: z.array(VInSchema),
  vouts: z.array(VOutSchema),
});
export type Transaction = z.infer<typeof TransactionSchema>;

/**
 * Rune amount schema
 */
export const RuneAmountSchema = z.object({
  rune_id: z.string(),
  amount: decimal(),
});
export type RuneAmount = z.infer<typeof RuneAmountSchema>;

/**
 * Unspent UTXO schema
 */
export const UnspentUtxoSchema = z.object({
  txId: z.string(),
  vout: z.number(),
  confirmations: z.number().nullable(),
  height: z.number().nullable(),
  satoshis: z.coerce.bigint(),
  runes: z.array(RuneAmountSchema),
});
export type UnspentUtxo = z.infer<typeof UnspentUtxoSchema>;

/**
 * Unspent Rune UTXO schema
 */
export const UnspentRuneUtxoSchema = z.object({
  txid: z.string(),
  vout: z.number(),
  confirmations: z.number().nullable(),
  height: z.number().nullable(),
  satoshis: z.coerce.bigint(),
  rune_amount: decimal(),
});
export type UnspentRuneUtxo = z.infer<typeof UnspentRuneUtxoSchema>;

/**
 * Chain tip schema
 */
export const ChainTipSchema = z.object({
  block_hash: z.string(),
  block_height: z.number(),
});
export type ChainTip = z.infer<typeof ChainTipSchema>;

/**
 * Unspent Rune UTXOs response schema
 */
export const UnspentRuneUtxosResponseSchema = z.object({
  data: z.array(UnspentRuneUtxoSchema),
  last_updated: ChainTipSchema,
  next_cursor: z.string().nullable(),
});
export type UnspentRuneUtxosResponse = z.infer<
  typeof UnspentRuneUtxosResponseSchema
>;

/**
 * Unspent UTXOs response schema
 */
export const UnspentUtxosResponseSchema = z.object({
  data: z.array(UnspentUtxoSchema),
  last_updated: ChainTipSchema,
  next_cursor: z.string().nullable(),
});
export type UnspentUtxosResponse = z.infer<typeof UnspentUtxosResponseSchema>;

/**
 * Transaction response schema
 */
export const TransactionResponseSchema = z.object({
  data: TransactionSchema,
});
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;

/**
 * Rune info schema
 */
export const RuneInfoSchema = z.object({
  id: z.string(),
  spaced_name: z.string(),
});
export type RuneInfo = z.infer<typeof RuneInfoSchema>;

/**
 * Rune list response schema
 */
export const RuneListResponseSchema = z.object({
  data: z.array(RuneInfoSchema),
  last_updated: ChainTipSchema,
  next_cursor: z.string().nullable(),
});
export type RuneListResponse = z.infer<typeof RuneListResponseSchema>;

/**
 * Rune details schema
 */
export const RuneDetailsSchema = z.object({
  id: z.string(),
  spaced_name: z.string(),
  name: z.string(),
  divisibility: z.number(),
  symbol: z.string().nullable(),
  etching_cenotaph: z.boolean(),
  etching_tx: z.string(),
});
export type RuneDetails = z.infer<typeof RuneDetailsSchema>;

/**
 * Rune details response schema
 */
export const RuneDetailsResponseSchema = z.object({
  data: RuneDetailsSchema,
  last_updated: ChainTipSchema,
});
export type RuneDetailsResponse = z.infer<typeof RuneDetailsResponseSchema>;

/**
 * Runes by address response schema
 */
export const RunesByAddressResponseSchema = z.object({
  data: z.record(z.string(), decimal()),
  last_updated: ChainTipSchema,
});
export type RunesByAddressResponse = z.infer<
  typeof RunesByAddressResponseSchema
>;
