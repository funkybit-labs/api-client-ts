import { z } from 'zod';
import Decimal from "decimal.js";
import {TypedDataDomain, TypedDataField} from "ethers";

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
   * Sign a login message using EIP-712
   * @param message The EIP-712 message to sign
   * @returns Promise resolving to the signature
   */
  signTypedData: (domain: TypedDataDomain, types: Record<string, Array<TypedDataField>>, value: Record<string, any>) => Promise<string>;
}

/**
 * Interface for Bitcoin wallets
 */
export interface BitcoinWallet extends BaseWallet {
  /** The ordinalsAddress */
  ordinalsAddress: string,
  /**
   * Sign a message
   * @param message The message to sign
   * @returns Promise resolving to the signature
   */
  signMessage: (address: string, message: string) => Promise<string>;
}

const AuthorizeWalletRequestSchema = z.object({
  authorizedAddress: z.string(),
  chainId: z.string(),
  address: z.string(),
  timestamp: z.string(),
  signature: z.string()
})

const SetOrdinalsAddressRequestSchema = z.object({
  ordinalsAddress: z.string(),
  proofs: z
    .object({
      addressOwnershipProof: z.string(),
      authorizationProof: z.string(),
      timestamp: z.string()
    })
    .nullable()
})


/**
 * Wallet network type
 */
export const WalletNetworkTypeSchema = z.enum(['Bitcoin', 'Evm']);
export type WalletNetworkType = z.infer<typeof WalletNetworkTypeSchema>;

/**
 * Authorized address schema
 */
export const AuthorizedAddressSchema = z.object({
  address: z.string(),
  networkType: WalletNetworkTypeSchema
});
export type AuthorizedAddress = z.infer<typeof AuthorizedAddressSchema>;

/**
 * Account configuration response schema
 */
export const AccountConfigurationSchema = z.object({
  id: z.string(),
  newSymbols: z.array(z.any()), // We'll define SymbolSchema later
  associatedSymbols: z.array(z.any()), // We'll define SymbolSchema later
  role: z.enum(['User', 'Admin']),
  authorizedAddresses: z.array(AuthorizedAddressSchema),
  nickName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  inviteCode: z.string(),
  ordinalsAddress: z.string().nullable(),
  funkybits: z.any() // We'll define decimal schema later
});
export type AccountConfiguration = z.infer<typeof AccountConfigurationSchema>;


export const decimal = () =>
  z
    .instanceof(Decimal)
    .or(z.string())
    .or(z.number())
    .transform((value, ctx) => {
      try {
        return new Decimal(value)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value} can't be parsed into Decimal: ${error}`
        })
        return z.NEVER
      }
    })
export const FEE_RATE_PIPS_MAX_VALUE = 1000000

const feeRatePips = () =>
  decimal().transform((decimalFee) => {
    return BigInt(decimalFee.mul(FEE_RATE_PIPS_MAX_VALUE).toNumber())
  })

export const EvmAddressSchema = z.custom<`0x${string}`>((val: unknown) =>
  /^0x/.test(val as string)
)
export type EvmAddressType = z.infer<typeof EvmAddressSchema>
export const evmAddress = (address: string): EvmAddressType => {
  // will throw if the address is invalid
  return EvmAddressSchema.parse(address)
}
export const AddressSchema = z.string().min(1)
export type AddressType = z.infer<typeof AddressSchema>

export const UserIdSchema = z.string()
export type UserId = z.infer<typeof UserIdSchema>

const ContractSchema = z.object({
  name: z.string(),
  address: AddressSchema,
  nativeDepositAddress: AddressSchema,
  tokenDepositAddress: AddressSchema
})

export type Contract = z.infer<typeof ContractSchema>

const CoinCreatorRefSchema = z.object({
  name: z.string(),
  userId: UserIdSchema
})
export type CoinCreatorRef = z.infer<typeof CoinCreatorRefSchema>

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
  nameOnChain: z.string().nullable().optional()
})

export type Symbol = z.infer<typeof SymbolSchema>

const ChainSchema = z.object({
  id: z.string(),
  name: z.string(),
  contracts: z.array(ContractSchema),
  symbols: z.array(SymbolSchema),
  jsonRpcUrl: z.string(),
  blockExplorerNetName: z.string(),
  blockExplorerUrl: z.string()
})
export type Chain = z.infer<typeof ChainSchema>

const MarketSchema = z.object({
  id: z.string(),
  baseSymbol: z.string(),
  quoteSymbol: z.string(),
  tickSize: decimal(),
  lastPrice: decimal(),
  minFee: z.coerce.bigint(),
  feeRate: decimal()
})
export type Market = z.infer<typeof MarketSchema>

const MarketTypeSchema = z.enum(['Clob', 'BondingCurve', 'Amm'])
export type MarketType = z.infer<typeof MarketTypeSchema>

const MarketWithSymbolInfosSchema = z.object({
  id: z.string(),
  baseSymbol: SymbolSchema,
  quoteSymbol: SymbolSchema,
  tickSize: decimal(),
  lastPrice: decimal(),
  minFee: z.coerce.bigint(),
  feeRate: decimal(),
  type: MarketTypeSchema
})
export type MarketWithSymbolInfos = z.infer<typeof MarketWithSymbolInfosSchema>

const FeeRatesSchema = z.object({
  maker: feeRatePips(),
  taker: feeRatePips()
})
export type FeeRates = z.infer<typeof FeeRatesSchema>

const SetFeeRatesSchema = z.object({
  maker: z.coerce.bigint(),
  taker: z.coerce.bigint()
})

export type SetFeeRates = z.infer<typeof SetFeeRatesSchema>

export const ConfigurationApiResponseSchema = z.object({
  chains: z.array(ChainSchema),
  markets: z.array(MarketSchema),
  feeRates: FeeRatesSchema,
  minimumRune: z.string()
})
export type ConfigurationApiResponse = z.infer<
  typeof ConfigurationApiResponseSchema
>

export const AccountConfigurationApiResponseSchema = z.object({
  id: UserIdSchema,
  newSymbols: z.array(SymbolSchema),
  associatedSymbols: z.array(SymbolSchema),
  role: z.enum(['User', 'Admin']),
  authorizedAddresses: z.array(AuthorizedAddressSchema),
  nickName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  inviteCode: z.string(),
  ordinalsAddress: AddressSchema.nullable(),
  funkybits: decimal()
})
export type AccountConfigurationApiResponse = z.infer<
  typeof AccountConfigurationApiResponseSchema
>

export const ApiErrorsSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional()
});