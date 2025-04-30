import z from 'zod'
import {
  BalanceSchema,
  decimal,
  MarketTradeSchema,
  OrderSchema,
  UserIdSchema,
  TradeSchema,
  CoinSchema,
  CoinCommentSchema
} from './types.js'
export type SubscriptionTopic =
  | { type: 'OrderBook'; marketId: string }
  | { type: 'Prices'; marketId: string; duration: string }
  | { type: 'PriceOracle'; marketId: string }
  | { type: 'MyTrades' }
  | { type: 'MyOrders' }
  | { type: 'Balances' }
  | { type: 'Consumption'; marketId: string }
  | { type: 'Launchpad' }
  | { type: 'MarketAmmState'; marketId: string }
  | { type: 'TopHodlers'; symbol: string }
  | { type: 'MarketTrades'; marketId: string }
  | { type: 'ChatMentions'; marketId: string }
  | { type: 'ChatComments'; marketId: string }

export function orderBookTopic(marketId: string): SubscriptionTopic {
  return { type: 'OrderBook', marketId }
}

export function marketAmmStateTopic(marketId: string): SubscriptionTopic {
  return { type: 'MarketAmmState', marketId }
}

export function topHodlersTopic(symbol: string): SubscriptionTopic {
  return { type: 'TopHodlers', symbol }
}

export function pricesTopic(
  marketId: string,
  duration: string
): SubscriptionTopic {
  return { type: 'Prices', marketId, duration }
}

export function priceOracleTopic(marketId: string): SubscriptionTopic {
  return { type: 'PriceOracle', marketId }
}

export function marketTradesTopic(marketId: string): SubscriptionTopic {
  return { type: 'MarketTrades', marketId }
}

export function consumptionTopic(marketId: string): SubscriptionTopic {
  return { type: 'Consumption', marketId }
}

export const myTradesTopic: SubscriptionTopic = { type: 'MyTrades' }
export const myOrdersTopic: SubscriptionTopic = { type: 'MyOrders' }
export const balancesTopic: SubscriptionTopic = { type: 'Balances' }
export const launchpadTopic: SubscriptionTopic = { type: 'Launchpad' }

export function chatMentionsTopic(marketId: string): SubscriptionTopic {
  return { type: 'ChatMentions', marketId }
}

export function chatCommentsTopic(marketId: string): SubscriptionTopic {
  return { type: 'ChatComments', marketId }
}

export type Publish = {
  type: 'Publish'
  data: Publishable
}

const OrderBookEntrySchema = z.object({
  price: z.string(),
  size: z.coerce.number()
})
export type OrderBookEntry = z.infer<typeof OrderBookEntrySchema>

const DirectionSchema = z.enum(['Up', 'Down', 'Unchanged'])
export type Direction = z.infer<typeof DirectionSchema>

const LastTradeSchema = z.object({
  price: z.string(),
  direction: DirectionSchema
})
export type LastTrade = z.infer<typeof LastTradeSchema>

export const OrderBookSchema = z.object({
  marketId: z.string(),
  type: z.literal('OrderBook'),
  buy: z.array(OrderBookEntrySchema),
  sell: z.array(OrderBookEntrySchema),
  last: LastTradeSchema
})
export type OrderBook = z.infer<typeof OrderBookSchema>

export const OHLCDurationSchema = z.enum([
  'P1M',
  'P5M',
  'P15M',
  'P1H',
  'P4H',
  'P1D'
])
export type OHLCDuration = z.infer<typeof OHLCDurationSchema>

const OHLCSchema = z.object({
  start: z.coerce.date(),
  duration: OHLCDurationSchema,
  open: z.coerce.number(),
  high: z.coerce.number(),
  low: z.coerce.number(),
  close: z.coerce.number(),
  openMarketCap: z.coerce.number().nullable(),
  highMarketCap: z.coerce.number().nullable(),
  lowMarketCap: z.coerce.number().nullable(),
  closeMarketCap: z.coerce.number().nullable()
})
export type OHLC = z.infer<typeof OHLCSchema>

export const PricesSchema = z.object({
  type: z.literal('Prices'),
  full: z.boolean(),
  ohlc: z.array(OHLCSchema),
  dailyChange: z.coerce.number(),
  dailyMarketCapChange: z.coerce.number().nullable()
})
export type Prices = z.infer<typeof PricesSchema>

export const PriceOracleSchema = z.object({
  type: z.literal('PriceOracle'),
  market: z.string(),
  lastPrice: z.coerce.number()
})
export type PriceOracle = z.infer<typeof PriceOracleSchema>

export const MyTradesSchema = z.object({
  type: z.literal('MyTrades'),
  trades: z.array(TradeSchema)
})
export type MyTrades = z.infer<typeof MyTradesSchema>

export const MyTradesCreatedSchema = z.object({
  type: z.literal('MyTradesCreated'),
  trades: z.array(TradeSchema)
})
export type MyTradesCreated = z.infer<typeof MyTradesCreatedSchema>

export const MyTradesUpdatedSchema = z.object({
  type: z.literal('MyTradesUpdated'),
  trades: z.array(TradeSchema)
})
export type MyTradesUpdated = z.infer<typeof MyTradesUpdatedSchema>

export const MyOrdersSchema = z.object({
  type: z.literal('MyOrders'),
  orders: z.array(OrderSchema)
})
export type MyOrders = z.infer<typeof MyOrdersSchema>

export const BalancesSchema = z.object({
  type: z.literal('Balances'),
  balances: z.array(BalanceSchema)
})
export type Balances = z.infer<typeof BalancesSchema>

export const BalanceTypeSchema = z.enum(['Available', 'Total'])
export type BalanceType = z.infer<typeof BalanceTypeSchema>

export const UpdatedBalanceSchema = z.object({
  symbol: z.string(),
  value: z.coerce.bigint(),
  type: BalanceTypeSchema
})
export type UpdatedBalance = z.infer<typeof UpdatedBalanceSchema>

export const BalancesUpdatedSchema = z.object({
  type: z.literal('BalancesUpdated'),
  balances: z.array(UpdatedBalanceSchema)
})
export type BalancesUpdated = z.infer<typeof BalancesUpdatedSchema>

export const MyOrdersCreatedSchema = z.object({
  type: z.literal('MyOrdersCreated'),
  orders: z.array(OrderSchema)
})
export type MyOrdersCreated = z.infer<typeof MyOrdersCreatedSchema>

export const MyOrdersUpdatedSchema = z.object({
  type: z.literal('MyOrdersUpdated'),
  orders: z.array(OrderSchema)
})
export type MyOrdersUpdated = z.infer<typeof MyOrdersUpdatedSchema>

export const MarketConsumptionSchema = z
  .tuple([
    z.string(), // marketId
    z.coerce.bigint(), // base
    z.coerce.bigint() // quote
  ])
  .transform((tuple) => {
    return {
      marketId: tuple[0],
      base: tuple[1],
      quote: tuple[2]
    }
  })
export type MarketConsumption = z.infer<typeof MarketConsumptionSchema>

export const ConsumptionSchema = z.object({
  type: z.literal('Consumption'),
  consumption: MarketConsumptionSchema
})
export type Consumption = z.infer<typeof ConsumptionSchema>

export const LaunchpadUpdateSchema = z.object({
  type: z.literal('LaunchpadUpdate'),
  coin: CoinSchema
})
export type LaunchpadUpdate = z.infer<typeof LaunchpadUpdateSchema>

const BondingCurveGraduationStatusSchema = z.enum([
  'NotReady',
  'Initiated',
  'Completed',
  'Failed'
])

export const BondingCurveAmmStateSchema = z.object({
  type: z.literal('BondingCurve'),
  realBaseReserves: z.coerce.bigint(),
  virtualBaseReserves: z.coerce.bigint(),
  realQuoteReserves: z.coerce.bigint(),
  virtualQuoteReserves: z.coerce.bigint(),
  progress: decimal(),
  graduationStatus: BondingCurveGraduationStatusSchema,
  feeRate: decimal()
})
export type BondingCurveAmmState = z.infer<typeof BondingCurveAmmStateSchema>

const LiquidityPoolStateSchema = z.object({
  id: z.string(),
  baseLiquidity: z.coerce.bigint(),
  quoteLiquidity: z.coerce.bigint(),
  feeRate: decimal()
})
export type LiquidityPoolState = z.infer<typeof LiquidityPoolStateSchema>

export const ConstantProductAmmStateSchema = z.object({
  type: z.literal('ConstantProduct'),
  liquidityPools: z.array(LiquidityPoolStateSchema)
})
export type ConstantProductAmmState = z.infer<
  typeof ConstantProductAmmStateSchema
>

const AmmStateSchema = z.discriminatedUnion('type', [
  BondingCurveAmmStateSchema,
  ConstantProductAmmStateSchema
])
export type AmmState = z.infer<typeof AmmStateSchema>

export const MarketAmmStateSchema = z.object({
  type: z.literal('MarketAmmState'),
  marketId: z.string(),
  ammState: AmmStateSchema
})
export type MarketAmmState = z.infer<typeof MarketAmmStateSchema>

export const TopHodlerSchema = z.object({
  id: UserIdSchema,
  nickname: z.string(),
  balance: z.coerce.bigint(),
  percentage: decimal(),
  isCreator: z.boolean()
})
export type TopHodler = z.infer<typeof TopHodlerSchema>

export const TopHodlersSchema = z.object({
  type: z.literal('TopHodlers'),
  symbol: z.string(),
  hodlers: z.array(TopHodlerSchema),
  sequencerNumber: z.number()
})
export type TopHodlers = z.infer<typeof TopHodlersSchema>

export const MarketTradesCreatedSchema = z.object({
  type: z.literal('MarketTradesCreated'),
  sequenceNumber: z.number(),
  marketId: z.string(),
  trades: z.array(MarketTradeSchema)
})
export type MarketTradesCreated = z.infer<typeof MarketTradesCreatedSchema>

export const ChatMentionsSchema = z.object({
  type: z.literal('ChatMentions'),
  marketId: z.string(),
  commentIds: z.array(z.string())
})
export type ChatMentions = z.infer<typeof ChatMentionsSchema>

export const ChatCommentsSchema = z.object({
  type: z.literal('ChatComments'),
  marketId: z.string(),
  comments: z.array(CoinCommentSchema)
})
export type ChatComments = z.infer<typeof ChatCommentsSchema>

export const PublishableSchema = z.discriminatedUnion('type', [
  OrderBookSchema,
  PricesSchema,
  PriceOracleSchema,
  MyTradesSchema,
  MyTradesCreatedSchema,
  MyTradesUpdatedSchema,
  MyOrdersSchema,
  BalancesSchema,
  BalancesUpdatedSchema,
  MyOrdersCreatedSchema,
  MyOrdersUpdatedSchema,
  ConsumptionSchema,
  LaunchpadUpdateSchema,
  MarketAmmStateSchema,
  TopHodlersSchema,
  MarketTradesCreatedSchema,
  ChatMentionsSchema,
  ChatCommentsSchema
])
export type Publishable = z.infer<typeof PublishableSchema>

export type IncomingWSMessage = Publish
