import { FunkybitClient } from '../src/index.js';
import {BitcoinWalletImpl} from '../src/bitcoin-wallet.js';
import {EvmWalletImpl} from "../src/evm-wallet.js";
import {networks} from "bitcoinjs-lib";
import * as wif from "wif"
import {Balance, Order, Trade} from "@/types.js";
import {Decimal} from "decimal.js";
import {formatUnits, parseUnits} from "viem";
import {run} from "jest";

// before running this example, populate these with:
//   a WIF format key for a bitcoin wallet with at least 5000 sats
const btcPrivateKey = process.env.FUNKYBIT_EXAMPLE_BTC_KEY ?? ""
//   a hex format key for an evm wallet with at least 3 USDC on Base (and a little ETH for gas)
const evmPrivateKey = process.env.FUNKYBIT_EXAMPLE_EVM_KEY ?? ""
const bitcoinWallet = new BitcoinWalletImpl(Buffer.from(wif.decode(btcPrivateKey).privateKey).toString('hex'), networks.regtest)
console.log(`Demo Bitcoin Address (P2WPKH): ${bitcoinWallet.address}`);

const evmWallet = new EvmWalletImpl(evmPrivateKey) //.createRandom()
console.log(`Demo EVM Address: ${evmWallet.address}`);

const providedReferralCode = process.env.FUNKYBIT_REFERRAL_CODE


async function waitFor(description: string, condition: () => boolean, upTo: number = 10000) {
  const start = new Date().getTime()
  return await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      try {
        if (condition()) {
          clearInterval(interval)
          resolve(true)
        }
      } catch (e) {
        clearInterval(interval)
        reject(e)
      }
      if (new Date().getTime() - start > upTo) {
        clearInterval(interval)
        reject(`Timeout waiting for ${description}`)
      }
    }, 20)
  })
}

export async function runExample() {
  console.log("Starting FunkybitClient example...");

  try {
    console.log("Initializing FunkybitClient...");
    console.log(`Using Bitcoin Address: ${bitcoinWallet.address}`);
    console.log(`Using EVM Address: ${evmWallet.address}`);
    console.log(`Using EVM Chain ID: ${evmWallet.chainId}`);

    const client = new FunkybitClient({
      bitcoinWallet: bitcoinWallet,
      evmWallet: evmWallet,
    });

    console.log("Attempting Funkybit login...");
    await client.login();
    console.log("✅ Funkybit login successful!");

    console.log("My referral code is", client.myReferralCode)
    if (!client.referredBy && providedReferralCode) {
      console.log("Signing up with referral code", providedReferralCode)
      await client.signUpWithReferralCode(providedReferralCode)
    }
    client.referredBy && console.log("✅ I was referred by", client.referredBy)

    let balances: Balance[]
    const unsubscribeFromBalances = client.subscribeToBalances((full) => {
      balances = full
    }, (update) => {
      update.forEach(u => {
        const existing = balances.find(b => b.symbol === u.symbol)
        if (existing) {
          if (u.type === 'Available') {
            existing.available = u.value
          } else {
            existing.total = u.value
          }
        } else {
          balances.push({
            symbol: u.symbol,
            lastUpdated: new Date(),
            usdcValue: new Decimal(0),
            ...(u.type === 'Available' ? {available: u.value, total: 0n} : {total: u.value, available: 0n})
          })
        }
      })
    })

    await waitFor("Balances to be set", () => balances !== undefined)

    function balanceOf(name: string): bigint | undefined {
      return balances.find(b => b.symbol === name)?.available
    }

    const bitcoinSymbol = client.bitcoinSymbol()
    const btcDepositAmount = 3000n
    if (bitcoinSymbol !== undefined) {
      const bitcoinBalance = balances!.find(b => b.symbol === bitcoinSymbol.name)?.available
      if ((bitcoinBalance ?? 0n) < btcDepositAmount) {
        console.log("Attempting a btc deposit")
        const deposit = await client.deposit(bitcoinSymbol, btcDepositAmount)
        await waitFor(`BTC deposit ${deposit.id} to complete`, () => (balanceOf(bitcoinSymbol.name) ?? 0n) >= btcDepositAmount, 30 * 60 * 1000)
        console.log("✅ BTC deposit successful!");
      }
    }

    const usdcDepositAmount = 3000000n
    const usdcSymbol = client.usdcSymbol()
    if (usdcSymbol !== undefined) {
      const usdcBalance = balances!.find(b => b.symbol === usdcSymbol.name)?.available
      if ((usdcBalance ?? 0n) < usdcDepositAmount) {
        console.log("Attempting a USDC deposit")
        const deposit = await client.deposit(usdcSymbol, usdcDepositAmount)
        await waitFor(`USDC deposit ${deposit.id} to complete`, () => (balanceOf(usdcSymbol.name) ?? 0n) >= usdcDepositAmount)
        console.log("✅ USDC deposit successful!");
      }
    }

    // get a list of coins
    const coins = await client.search("Trending", "", false)

    if (coins.length > 0) {
      const orders: Map<string, Order> = new Map()
      const unsubscribeFromOrders = client.subscribeToOrders(
        (newOrUpdated: Order[]) => {
          newOrUpdated.forEach(o => {
            orders.set(o.id, o)
          })
        },
      )

      const trades: Map<string, Trade> = new Map()
      const unsubscribeFromTrades = client.subscribeToTrades(
        (newOrUpdated: Trade[]) => {
          newOrUpdated.forEach(t => trades.set(t.id, t))
        }
      )
      const filledOrderIds: string[] = []

      // choose the market with the smallest market cap
      const market = await client.getMarket(coins.sort((a, b) => a.marketCap.sub(b.marketCap).toNumber())[0])
      console.log("Picked coin to trade:", market.baseSymbol.name)
      // buy with USDC
      const buyUSDCQuote = await client.getQuote(market, 'Buy', 200000000000n, 'USDC')
      if (buyUSDCQuote) {
        console.log(`Got a quote of ${formatUnits(buyUSDCQuote.quote, 6)} USDC to buy 200,000 coins`)
        const order = await client.placeOrder(buyUSDCQuote)
        console.log("✅ Placed USDC buy order");
        await waitFor("USDC buy order to reach a terminal state", () => orders.get(order.orderId)?.isFinal() ?? false)
        const finalStatus = orders.get(order.orderId)?.status
        console.log("USDC buy order final status", finalStatus);
        if (finalStatus === 'Filled') {
          filledOrderIds.push(order.orderId)
        }
      }

      // sell with USDC
      const sellUSDCQuote = await client.getQuote(market, 'Sell', 200000000000n, 'USDC')
      if (sellUSDCQuote) {
        console.log(`Got a quote of ${formatUnits(sellUSDCQuote.quote, 6)} USDC for selling 200,000 coins`)
        const order = await client.placeOrder(sellUSDCQuote)
        console.log("✅ Placed USDC sell order");
        await waitFor("USDC sell order to reach a terminal state", () => orders.get(order.orderId)?.isFinal() ?? false)
        const finalStatus = orders.get(order.orderId)?.status
        console.log("USDC sell order final status", finalStatus);
        if (finalStatus === 'Filled') {
          filledOrderIds.push(order.orderId)
        }
      }

      // buy with BTC
      const buyBTCQuote = await client.getQuote(market, 'Buy', 200000000000n, 'BTC')
      if (buyBTCQuote) {
        console.log(`Got a quote of ${formatUnits(buyBTCQuote.quote, 8)} BTC to buy 200,000 coins`)
        const order = await client.placeOrder(buyBTCQuote)
        console.log("✅ Placed BTC buy order");
        await waitFor("BTC buy order to reach a terminal state", () => orders.get(order.orderId)?.isFinal() ?? false)
        const finalStatus = orders.get(order.orderId)?.status
        console.log("BTC buy order final status", finalStatus);
        if (finalStatus === 'Filled') {
          filledOrderIds.push(order.orderId)
        }
      }

      // sell with BTC
      const sellBTCQuote = await client.getQuote(market, 'Sell', 200000000000n, 'BTC')
      if (sellBTCQuote) {
        console.log(`Got a quote of ${formatUnits(sellBTCQuote.quote, 8)} BTC for selling 200,000 coins`)
        const order = await client.placeOrder(sellBTCQuote)
        console.log("✅ Placed BTC sell order");
        await waitFor("BTC sell order to reach terminal state", () => orders.get(order.orderId)?.isFinal() ?? false)
        const finalStatus = orders.get(order.orderId)?.status
        console.log("BTC sell order final status", finalStatus);
        if (finalStatus === 'Filled') {
          filledOrderIds.push(order.orderId)
        }
      }

      console.log(`Waiting up to 2 minutes for ${filledOrderIds.length} trades to settle`)
      await waitFor("Trades to settle",
        () => new Set(
          trades.values()
            .filter(t => t.settlementStatus === 'Completed')
            .map(t => t.orderId)
        )
          .intersection(
            new Set(filledOrderIds)
          ).size === filledOrderIds.length,
        120 * 1000
      )
      console.log(`✅ Settlement completed`)

      // look for the coin with the smallest market cap that we can withdraw
      const withdrawableRunes = coins.filter(c => c.status === 'ConstantProductAmm').sort((a, b) => a.marketCap.sub(b.marketCap).toNumber())
      if (withdrawableRunes.length > 0) {
        const runeToWithdraw = withdrawableRunes[0]
        const filledRuneOrderIds: string[] = []
        // first let's buy $2 worth
        const approximateAmount = new Decimal(2).div(runeToWithdraw.currentPrice)
        const runeMarket = await client.getMarket(runeToWithdraw)
        const quote = await client.getQuote(runeMarket, 'Buy', parseUnits(approximateAmount.toString(), runeToWithdraw.symbol.decimals), 'USDC')
        console.log(`Got a quote of ${formatUnits(quote.quote, 6)} USDC for buying ${approximateAmount.toString()} of ${runeToWithdraw.symbol.name}`)
        const order = await client.placeOrder(quote)
        console.log("✅ Placed Rune buy order");
        await waitFor("Rune buy order to reach a terminal state", () => orders.get(order.orderId)?.isFinal() ?? false)

        const finalStatus = orders.get(order.orderId)?.status
        console.log("rune order final status", finalStatus);
        if (finalStatus === 'Filled') {
          filledRuneOrderIds.push(order.orderId)
          const runeBalance = balanceOf(runeToWithdraw.symbol.name) ?? 0n
          if (runeBalance > 0n) {
            console.log(`Withdrawing ${formatUnits(runeBalance, runeToWithdraw.symbol.decimals)} ${runeToWithdraw.symbol.name}`);
            await client.withdrawal(runeMarket.baseSymbol, runeBalance)
            await waitFor("Rune withdrawal to complete", () => balanceOf(runeToWithdraw.symbol.name) === 0n)
            console.log(`✅ Withdrawal completed`)

            // need to refresh symbol info to get all relevant fields for rune
            await client.refreshSymbols()
            const runeSymbol = client.associatedSymbolInfo(runeToWithdraw.symbol.name)!

            console.log(`Depositing ${formatUnits(runeBalance, runeToWithdraw.symbol.decimals)} ${runeToWithdraw.symbol.name}`);
            await client.deposit(runeSymbol, runeBalance)
            await waitFor("Rune deposit to complete", () => balanceOf(runeToWithdraw.symbol.name) === runeBalance, 30 * 60 * 1000)
            console.log(`✅ Deposit completed`)

            // sell the rune
            const sellRuneQuote = await client.getQuote(runeMarket, 'Sell', runeBalance, 'USDC')
            const sellOrder = await client.placeOrder(sellRuneQuote)
            console.log("✅ Placed Rune sell order");
            await waitFor("Rune sell order to reach terminal state", () => orders.get(sellOrder.orderId)?.isFinal() ?? false)
            const finalSellStatus = orders.get(sellOrder.orderId)?.status
            console.log("Rune sell order final status", finalSellStatus);
            if (finalSellStatus === 'Filled') {
              filledRuneOrderIds.push(sellOrder.orderId)
            }
          }

          console.log(`Waiting up to 2 minutes for ${filledRuneOrderIds.length} trades to settle`)
          await waitFor("Rune trades to settle",
            () => new Set(
              trades.values()
                .filter(t => t.settlementStatus === 'Completed')
                .map(t => t.orderId)
            )
              .intersection(
                new Set(filledRuneOrderIds)
              ).size === filledRuneOrderIds.length,
            120 * 1000
          )
          console.log(`✅ Settlement completed`)
        }
      }
      const remainingBTCBalance = bitcoinSymbol ? balanceOf(bitcoinSymbol.name) ?? 0n : 0n
      const remainingUSDCBalance = usdcSymbol ? balanceOf(usdcSymbol.name) ?? 0n : 0n
      if (remainingUSDCBalance > 0n) {
        console.log(`Withdrawing ${formatUnits(remainingUSDCBalance, 6)} USDC`)
        await client.withdrawal(usdcSymbol!, remainingUSDCBalance)
        await waitFor("USDC withdrawal to complete", () => balanceOf(usdcSymbol!.name) === 0n)
        console.log(`✅ Withdrawal completed`)
      }
      if (remainingBTCBalance > 0n) {
        console.log(`Withdrawing ${formatUnits(remainingBTCBalance, 8)} BTC`)
        await client.withdrawal(bitcoinSymbol!, remainingBTCBalance)
        await waitFor("BTC withdrawal to complete", () => balanceOf(bitcoinSymbol!.name) === 0n)
        console.log(`✅ Withdrawal completed`)
      }

      unsubscribeFromOrders()
      unsubscribeFromTrades()
    }

    unsubscribeFromBalances()
    client.shutdown()
    console.log("✅ FunkybitClient example completed!");
  } catch (error) {
    console.error("❌ An error occurred during the FunkybitClient operation:", error);
  }
}