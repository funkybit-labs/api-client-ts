import { Decimal } from "decimal.js";
import { FeeRates, MarketWithSymbolInfos, Symbol } from "./types.js";
import { OrderBook } from "./websocketMessages.js";
import { parseUnits } from "viem";
import {
  adjustQuoteToExcludeFee,
  adjustQuoteToIncludeFee,
  calculateFee,
} from "./fees.js";
import { bigintToScaledDecimal, calculateNotional } from "./utils.js";

function baseAmountFromNotionalAndPrice(
  notional: bigint,
  price: bigint,
  baseSymbol: Symbol,
  options: { roundingMode: "Up" | "Down" },
): bigint {
  const notionalDividedByPrice = new Decimal(notional.toString())
    .div(new Decimal(price.toString()))
    .mul(new Decimal(BigInt(Math.pow(10, baseSymbol.decimals)).toString()));

  switch (options.roundingMode) {
    case "Up": {
      return BigInt(
        notionalDividedByPrice.ceil().toDecimalPlaces(0).toNumber(),
      );
    }
    case "Down": {
      return BigInt(
        notionalDividedByPrice.floor().toDecimalPlaces(0).toNumber(),
      );
    }
  }
}

export function baseAmountToSellToGetQuoteAmountAtClobMarket(
  quoteAmount: bigint,
  market: MarketWithSymbolInfos,
  orderBook: OrderBook,
  feeRates: FeeRates,
): bigint | null {
  const levels = orderBook.buy.toReversed().map((l) => {
    return {
      size: parseUnits(l.size.toFixed(36), market.baseSymbol.decimals),
      price: parseUnits(l.price, market.quoteSymbol.decimals),
    };
  });

  let remainingQuote = adjustQuoteToIncludeFee(quoteAmount, feeRates.taker);
  let baseAmount = 0n;

  while (levels.length > 0) {
    const level = levels.pop()!;
    const notionalAtLevel = calculateNotional(
      level.price,
      level.size,
      market.baseSymbol,
    );

    if (notionalAtLevel >= remainingQuote) {
      return (
        baseAmount +
        baseAmountFromNotionalAndPrice(
          remainingQuote,
          level.price,
          market.baseSymbol,
          {
            roundingMode: "Up",
          },
        )
      );
    }
    baseAmount += level.size;
    remainingQuote -= notionalAtLevel;
  }

  if (remainingQuote > 0n) {
    return null;
  }

  return baseAmount;
}

export function baseAmountToGetForQuoteAmountAtClobMarket(
  quoteAmount: bigint,
  market: MarketWithSymbolInfos,
  orderBook: OrderBook,
  feeRates: FeeRates,
): bigint | null {
  const levels = orderBook.sell.map((l) => {
    return {
      size: parseUnits(l.size.toFixed(36), market.baseSymbol.decimals),
      price: parseUnits(l.price, market.quoteSymbol.decimals),
    };
  });

  let remainingQuote = adjustQuoteToExcludeFee(quoteAmount, feeRates.taker);
  let baseAmount = 0n;

  while (levels.length > 0) {
    const level = levels.pop()!;
    const notionalAtLevel = calculateNotional(
      level.price,
      level.size,
      market.baseSymbol,
    );

    if (notionalAtLevel >= remainingQuote) {
      return (
        baseAmount +
        baseAmountFromNotionalAndPrice(
          remainingQuote,
          level.price,
          market.baseSymbol,
          {
            roundingMode: "Down",
          },
        )
      );
    }
    baseAmount += level.size;
    remainingQuote -= notionalAtLevel;
  }

  if (remainingQuote > 0n) {
    return null;
  }

  return baseAmount;
}

export function quoteAmountToGetFromSellingBaseAmountAtClobMarket(
  baseAmount: bigint,
  market: MarketWithSymbolInfos,
  orderBook: OrderBook,
  feeRates: FeeRates,
): bigint | null {
  const levels = orderBook.buy.toReversed().map((l) => {
    return {
      size: parseUnits(l.size.toFixed(36), market.baseSymbol.decimals),
      price: parseUnits(l.price, market.quoteSymbol.decimals),
    };
  });

  let remainingBaseAmount = baseAmount;
  let quoteAmount = 0n;

  while (levels.length > 0) {
    const level = levels.pop()!;

    if (level.size < remainingBaseAmount) {
      quoteAmount += calculateNotional(
        level.price,
        level.size,
        market.baseSymbol,
      );
      remainingBaseAmount -= level.size;
    } else {
      quoteAmount += calculateNotional(
        level.price,
        remainingBaseAmount,
        market.baseSymbol,
      );
      remainingBaseAmount = 0n;
      break;
    }
  }

  if (remainingBaseAmount > 0n) {
    return null;
  }

  return quoteAmount - calculateFee(quoteAmount, feeRates.taker);
}

export function getMarketPriceForSellAtClobMarket(
  baseAmount: bigint,
  market: MarketWithSymbolInfos,
  orderBook: OrderBook,
  feeRates: FeeRates,
  roundingMode: Decimal.Rounding = Decimal.ROUND_HALF_UP,
): Decimal | undefined {
  const quoteAmount = quoteAmountToGetFromSellingBaseAmountAtClobMarket(
    baseAmount,
    market,
    orderBook,
    feeRates,
  );
  return quoteAmount
    ? bigintToScaledDecimal(quoteAmount, market.quoteSymbol.decimals)
        .div(bigintToScaledDecimal(baseAmount, market.baseSymbol.decimals))
        .toDecimalPlaces(market.quoteSymbol.decimals, roundingMode)
    : undefined;
}

export function getMarketPriceForBuyAtClobMarket(
  quoteAmount: bigint,
  market: MarketWithSymbolInfos,
  orderBook: OrderBook,
  feeRates: FeeRates,
  roundingMode: Decimal.Rounding = Decimal.ROUND_HALF_UP,
): Decimal | undefined {
  const baseAmount = baseAmountToGetForQuoteAmountAtClobMarket(
    quoteAmount,
    market,
    orderBook,
    feeRates,
  );
  return baseAmount
    ? bigintToScaledDecimal(quoteAmount, market.quoteSymbol.decimals)
        .div(bigintToScaledDecimal(baseAmount, market.baseSymbol.decimals))
        .toDecimalPlaces(market.quoteSymbol.decimals, roundingMode)
    : undefined;
}
