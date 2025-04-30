import { Decimal } from "decimal.js";

export const FEE_RATE_PIPS_MAX_VALUE = 1000000;

export function calculateFee(
  notional: bigint,
  feeRate: bigint | Decimal,
): bigint {
  return (
    (notional * feeRateToBigInt(feeRate)) / BigInt(FEE_RATE_PIPS_MAX_VALUE)
  );
}

function feeRateToBigInt(feeRate: bigint | Decimal): bigint {
  return feeRate instanceof Decimal
    ? BigInt(
        new Decimal(FEE_RATE_PIPS_MAX_VALUE).mul(feeRate).floor().toNumber(),
      )
    : feeRate;
}

export function adjustQuoteToExcludeFee(
  notional: bigint,
  feeRate: bigint | Decimal,
): bigint {
  return (
    (notional * BigInt(FEE_RATE_PIPS_MAX_VALUE)) /
    (BigInt(FEE_RATE_PIPS_MAX_VALUE) + feeRateToBigInt(feeRate))
  );
}

export function adjustQuoteToIncludeFee(
  quoteAmount: bigint,
  feeRate: bigint,
): bigint {
  return (
    (quoteAmount * BigInt(FEE_RATE_PIPS_MAX_VALUE)) /
    (BigInt(FEE_RATE_PIPS_MAX_VALUE) - feeRateToBigInt(feeRate))
  );
}
