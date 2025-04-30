import { Address } from "viem";
import { Decimal } from "decimal.js";
import { Symbol } from "./types.js";

export function base64urlEncode(input: Uint8Array): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function fromFundamentalUnits(value: bigint, decimals: number): string {
  // if decimals is 0 just return the value as a string
  if (decimals === 0) {
    return value.toString();
  }

  const str = value.toString().padStart(decimals + 1, "0");
  return str.slice(0, -decimals) + "." + str.slice(-decimals);
}

export type Domain = {
  name: string;
  chainId: bigint;
  verifyingContract: Address;
  version: string;
};

export function getDomain(
  exchangeContractAddress: string,
  chain: number,
): Domain {
  return {
    name: "funkybit",
    chainId: BigInt(chain),
    verifyingContract: exchangeContractAddress as Address,
    version: "0.1.0",
  };
}

export function generateOrderNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function bigintToScaledDecimal(bi: bigint, decimals: number): Decimal {
  const scaleFactor = new Decimal(10).pow(decimals);
  return new Decimal(bi.toString()).div(scaleFactor);
}

export function scaledDecimalToBigint(
  sd: Decimal,
  decimals: number,
  round: boolean = false,
): bigint {
  const scaleFactor = new Decimal(10).pow(decimals);
  const scaled = sd.mul(scaleFactor);
  if (round) {
    return BigInt(scaled.round().toFixed(0));
  } else {
    return BigInt(scaled.floor().toFixed(0));
  }
}

export function calculateNotional(
  price: bigint,
  baseAmount: bigint,
  baseSymbol: Symbol,
): bigint {
  return (price * baseAmount) / BigInt(Math.pow(10, baseSymbol.decimals));
}

export function minBigInt(a: bigint, b: bigint): bigint {
  if (a <= b) {
    return a;
  } else {
    return b;
  }
}

export function absBigInt(value: bigint): bigint {
  if (value < 0) {
    return -value;
  } else {
    return value;
  }
}
