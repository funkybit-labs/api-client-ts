import {
  absBigInt,
  bigintToScaledDecimal,
  minBigInt,
  scaledDecimalToBigint,
} from "./utils.js";
import { FeeRates, MarketWithSymbolInfos, OrderSide } from "./types.js";
import {
  AmmState,
  BondingCurveAmmState,
  ConstantProductAmmState,
  LiquidityPoolState,
  OrderBook,
} from "./websocketMessages.js";
import { adjustQuoteToExcludeFee, calculateFee } from "./fees.js";
import {
  baseAmountToGetForQuoteAmountAtClobMarket,
  baseAmountToSellToGetQuoteAmountAtClobMarket,
  quoteAmountToGetFromSellingBaseAmountAtClobMarket,
} from "./clob.js";
import { Decimal } from "decimal.js";

export type AdapterMarketState = {
  market: MarketWithSymbolInfos;
  orderBook: OrderBook;
  feeRates: FeeRates;
};

export function quoteAmountRequiredForBuyingBaseIncludingFee(
  baseAmount: bigint,
  market: MarketWithSymbolInfos,
  ammState: AmmState,
  adapterMarketState: AdapterMarketState | null = null,
): bigint | null {
  if (baseAmount === 0n) {
    return 0n;
  }

  const baseAmountDecimal = bigintToScaledDecimal(
    baseAmount,
    market.baseSymbol.decimals,
  );

  let quoteRequired: bigint;

  switch (ammState.type) {
    case "BondingCurve": {
      const realBaseReserves = bigintToScaledDecimal(
        ammState.realBaseReserves,
        market.baseSymbol.decimals,
      );
      const safeAmount = baseAmountDecimal.gt(realBaseReserves)
        ? realBaseReserves
        : baseAmountDecimal;
      const cost = bondingCurveCostFor(safeAmount, market, ammState);
      quoteRequired = cost + calculateFee(cost, ammState.feeRate);
      break;
    }
    case "ConstantProduct": {
      const bestBuyEstimate = getCpBestBuyEstimate(baseAmount, ammState);
      if (!bestBuyEstimate) {
        return null;
      }

      quoteRequired = bestBuyEstimate.notional + bestBuyEstimate.fee;
      break;
    }
  }

  if (adapterMarketState) {
    return baseAmountToSellToGetQuoteAmountAtClobMarket(
      quoteRequired,
      adapterMarketState.market,
      adapterMarketState.orderBook,
      adapterMarketState.feeRates,
    );
  } else {
    return quoteRequired;
  }
}

export function quoteAmountMinusFeeToReceiveForSellingBase(
  baseAmount: bigint,
  market: MarketWithSymbolInfos,
  ammState: AmmState,
  adapterMarketState: AdapterMarketState | null = null,
): bigint | null {
  if (baseAmount === 0n) {
    return 0n;
  }

  const baseAmountDecimal = bigintToScaledDecimal(
    baseAmount,
    market.baseSymbol.decimals,
  );

  let quoteToReceive: bigint;

  switch (ammState.type) {
    case "BondingCurve": {
      const cost = bondingCurveCostFor(
        baseAmountDecimal.neg(),
        market,
        ammState,
      );
      quoteToReceive = cost - calculateFee(cost, ammState.feeRate);
      break;
    }
    case "ConstantProduct": {
      const bestSellEstimate = getCpBestSellEstimate(baseAmount, ammState);
      if (!bestSellEstimate) {
        return null;
      }

      quoteToReceive = absBigInt(
        bestSellEstimate.notional - bestSellEstimate.fee,
      );
      break;
    }
  }

  if (adapterMarketState) {
    return baseAmountToGetForQuoteAmountAtClobMarket(
      quoteToReceive,
      adapterMarketState.market,
      adapterMarketState.orderBook,
      adapterMarketState.feeRates,
    );
  } else {
    return quoteToReceive;
  }
}

export function baseAmountToReceiveForSellingQuoteIncludingFee(
  quoteAmount: bigint,
  market: { baseDecimals: number; quoteDecimals: number },
  ammState: AmmState,
  adapterMarketState: AdapterMarketState | null = null,
): bigint | null {
  const actualQuoteAmount = adapterMarketState
    ? // if adapter is provided, we assume quoteAmount is in adapter market base symbol
      quoteAmountToGetFromSellingBaseAmountAtClobMarket(
        quoteAmount,
        adapterMarketState.market,
        adapterMarketState.orderBook,
        adapterMarketState.feeRates,
      )
    : quoteAmount;

  if (actualQuoteAmount == null) {
    return null;
  }

  switch (ammState.type) {
    case "BondingCurve": {
      const virtualQuoteReserves = bigintToScaledDecimal(
        ammState.virtualQuoteReserves,
        market.quoteDecimals,
      );
      const virtualBaseReserves = bigintToScaledDecimal(
        ammState.virtualBaseReserves,
        market.baseDecimals,
      );
      const quoteAmountLessFeeDecimal = bigintToScaledDecimal(
        adjustQuoteToExcludeFee(actualQuoteAmount, ammState.feeRate),
        market.quoteDecimals,
      );
      const newQuoteReserves = virtualQuoteReserves.plus(
        quoteAmountLessFeeDecimal,
      );
      const product = virtualQuoteReserves.mul(virtualBaseReserves);
      const newBaseReserves = product.div(newQuoteReserves);
      const rawBase = scaledDecimalToBigint(
        virtualBaseReserves.sub(newBaseReserves),
        market.baseDecimals,
      );
      return minBigInt(rawBase, ammState.realBaseReserves);
    }
    case "ConstantProduct": {
      let largestBaseAmount = 0n;

      ammState.liquidityPools.forEach((pool) => {
        const estimate = baseAmountToRemoveToIncreasePoolQuoteByDelta(
          pool,
          adjustQuoteToExcludeFee(actualQuoteAmount, pool.feeRate),
        );
        if (estimate != null && estimate > largestBaseAmount) {
          largestBaseAmount = estimate;
        }
      });

      return largestBaseAmount == 0n ? null : largestBaseAmount;
    }
  }
}

function bondingCurveCostFor(
  amount: Decimal,
  market: MarketWithSymbolInfos,
  bondingCurve: BondingCurveAmmState,
): bigint {
  const virtualQuoteReserves = bigintToScaledDecimal(
    bondingCurve.virtualQuoteReserves,
    market.quoteSymbol.decimals,
  );
  const virtualBaseReserves = bigintToScaledDecimal(
    bondingCurve.virtualBaseReserves,
    market.baseSymbol.decimals,
  );
  return scaledDecimalToBigint(
    amount
      .abs()
      .mul(virtualQuoteReserves.div(virtualBaseReserves.add(amount.neg())))
      .plus(bigintToScaledDecimal(1n, market.baseSymbol.decimals)),
    market.quoteSymbol.decimals,
  );
}

type LiquidityPoolTradeEstimate = {
  pool: LiquidityPoolState;
  baseAmount: bigint;
  notional: bigint;
  fee: bigint;
  side: OrderSide;
};

export function getCpBestBuyEstimate(
  buyAmount: bigint,
  ammState: ConstantProductAmmState,
): LiquidityPoolTradeEstimate | null {
  const possibleTrades: LiquidityPoolTradeEstimate[] = [];

  ammState.liquidityPools.forEach((pool) => {
    const estimate = estimatePoolBaseLiquidityAdjustment(pool, -buyAmount);
    if (estimate) {
      possibleTrades.push({
        pool,
        baseAmount: absBigInt(estimate.baseDelta),
        notional: estimate.quoteDelta,
        fee: estimate.fee,
        side: "Buy",
      });
    }
  });

  if (possibleTrades.length == 0) {
    return null;
  }

  let bestTrade: LiquidityPoolTradeEstimate = possibleTrades[0];

  possibleTrades.forEach((trade) => {
    if (trade.notional + trade.fee < bestTrade.notional + bestTrade.fee) {
      bestTrade = trade;
    }
  });

  return bestTrade;
}

export function getCpBestSellEstimate(
  sellAmount: bigint,
  ammState: ConstantProductAmmState,
): LiquidityPoolTradeEstimate | null {
  const possibleTrades: LiquidityPoolTradeEstimate[] = [];

  ammState.liquidityPools.forEach((pool) => {
    const estimate = estimatePoolBaseLiquidityAdjustment(pool, sellAmount);
    if (estimate) {
      possibleTrades.push({
        pool,
        baseAmount: estimate.baseDelta,
        notional: absBigInt(estimate.quoteDelta),
        fee: absBigInt(estimate.fee),
        side: "Sell",
      });
    }
  });

  if (possibleTrades.length == 0) {
    return null;
  }

  let bestTrade: LiquidityPoolTradeEstimate = possibleTrades[0];

  possibleTrades.forEach((trade) => {
    if (trade.notional + trade.fee > bestTrade.notional - bestTrade.fee) {
      bestTrade = trade;
    }
  });

  return bestTrade;
}

type LiquidityAdjustmentEstimate = {
  baseDelta: bigint;
  quoteDelta: bigint;
  fee: bigint;
};

function estimatePoolBaseLiquidityAdjustment(
  lp: LiquidityPoolState,
  baseDelta: bigint,
): LiquidityAdjustmentEstimate | null {
  const newBaseLiquidity = lp.baseLiquidity + baseDelta;
  if (newBaseLiquidity <= 0n) {
    return null;
  }
  const product = lp.baseLiquidity * lp.quoteLiquidity;
  const newQuoteLiquidity = product / newBaseLiquidity;
  if (newQuoteLiquidity == 0n) {
    return null;
  }
  const quoteDelta = newQuoteLiquidity - lp.quoteLiquidity + 1n;
  return {
    baseDelta,
    quoteDelta,
    fee: calculateFee(quoteDelta, lp.feeRate),
  };
}

function baseAmountToRemoveToIncreasePoolQuoteByDelta(
  lp: LiquidityPoolState,
  quoteDelta: bigint,
): bigint | null {
  const newQuoteLiquidity = lp.quoteLiquidity + quoteDelta;
  const product = lp.baseLiquidity * lp.quoteLiquidity;
  const newBaseLiquidity = product / newQuoteLiquidity;
  if (newBaseLiquidity == 0n) {
    return null;
  }
  const baseDeltaRoughEstimate = newBaseLiquidity - lp.baseLiquidity;
  const actualQuoteDelta = estimatePoolBaseLiquidityAdjustment(
    lp,
    baseDeltaRoughEstimate,
  )?.quoteDelta;
  if (actualQuoteDelta == null) {
    return null;
  }

  const baseDeltaRoughEstimateAbsoluteValue = absBigInt(baseDeltaRoughEstimate);
  if (actualQuoteDelta == quoteDelta) {
    return baseDeltaRoughEstimateAbsoluteValue;
  }

  // Use binary search to find the precise base amount to be removed from the pool
  // so that quote liquidity is increased by max value that is less or equal to provided delta
  let [left, right] =
    actualQuoteDelta < quoteDelta
      ? [
          baseDeltaRoughEstimateAbsoluteValue,
          baseDeltaRoughEstimateAbsoluteValue * 2n,
        ]
      : [
          baseDeltaRoughEstimateAbsoluteValue / 2n,
          baseDeltaRoughEstimateAbsoluteValue,
        ];

  let lastAcceptableEstimate: LiquidityAdjustmentEstimate | null = null;

  while (right - left > 1n) {
    const middle = (left + right) / 2n;

    const estimate = estimatePoolBaseLiquidityAdjustment(lp, -middle);
    if (estimate == null) {
      return null;
    }
    if (estimate.quoteDelta == quoteDelta) {
      lastAcceptableEstimate = estimate;
      break;
    } else if (estimate.quoteDelta < quoteDelta) {
      lastAcceptableEstimate = estimate;
      left = middle;
    } else {
      right = middle;
    }
  }

  return lastAcceptableEstimate
    ? absBigInt(lastAcceptableEstimate.baseDelta)
    : null;
}
