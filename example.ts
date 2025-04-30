import { FunkybitClient } from './src/index.js';
import {BitcoinWalletImpl} from './src/bitcoin-wallet.js';
import {EvmWalletImpl} from "./src/evm-wallet.js";
import {networks} from "bitcoinjs-lib";
import * as wif from "wif"
import {Balance, Order, Trade} from "@/types.js";
import {Decimal} from "decimal.js";
import {formatUnits} from "viem";

const bitcoinWallet = new BitcoinWalletImpl(Buffer.from(wif.decode("L56pJGiipykc6Q7nSbNTpVoRtgBice5tqtsWWaFisjY1tu2nbD7z").privateKey).toString('hex'), networks.regtest)
console.log(`Demo Bitcoin Address (P2WPKH): ${bitcoinWallet.address}`);

const evmWallet = new EvmWalletImpl("eb26ff8ad398676bdb5a9759ad2c8635c73bd2f5825341df1b952a99bad9d220") //.createRandom()
console.log(`Demo EVM Address: ${evmWallet.address}`);

// --- FunkybitClient Instantiation and Login ---
async function waitFor(description: string, condition: () => boolean, upTo: number = 5000) {
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
    const loginSuccess = await client.login();

    if (loginSuccess) {
      console.log("✅ Funkybit login successful!");
    } else {
      console.log("❌ Funkybit login failed or was cancelled by the user.");
    }

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
    if (bitcoinSymbol !== undefined) {
      const bitcoinBalance = balances!.find(b => b.symbol === bitcoinSymbol.name)?.available
      if ((bitcoinBalance ?? 0n) < 10000n) {
        console.log("Attempting a btc deposit")
        const deposit = await client.deposit(bitcoinSymbol, 10000n)
        await waitFor("BTC deposit to complete", () => (balanceOf(bitcoinSymbol.name) ?? 0n) >= 10000n)
        console.log("✅ BTC deposit successful!", deposit);
      }
    }

    const usdcSymbol = client.usdcSymbol()
    if (usdcSymbol !== undefined) {
      const usdcBalance = balances!.find(b => b.symbol === usdcSymbol.name)?.available
      if ((usdcBalance ?? 0n) < 10000000n) {
        console.log("Attempting a USDC deposit")
        const deposit = await client.deposit(usdcSymbol, 10000000n)
        await waitFor("USDC deposit to complete", () => (balanceOf(usdcSymbol.name) ?? 0n) >= 10000000n)
        console.log("✅ USDC deposit successful!", deposit);
      }
    }

    // get a list of coins
    const coins = await client.search("Trending", "", false)
    console.log("Coins:", coins.map(c => c.symbol.name))

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
      const market = await client.getMarket(coins[0])
      // buy with USDC
      const buyUSDCQuote = await client.getQuote(market, 'Buy', 200000000000n, 'USDC')
      if (buyUSDCQuote) {
        const order = await client.placeOrder(buyUSDCQuote)
        console.log("✅ Placed USDC buy order", order);
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
        const order = await client.placeOrder(sellUSDCQuote)
        console.log("✅ Placed USDC sell order", order);
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
        const order = await client.placeOrder(buyBTCQuote)
        console.log("✅ Placed BTC buy order", order);
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
        const order = await client.placeOrder(sellBTCQuote)
        console.log("✅ Placed BTC sell order", order);
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
      const remainingBTCBalance = bitcoinSymbol ? balanceOf(bitcoinSymbol.name) ?? 0n : 0n
      const remainingUSDCBalance = usdcSymbol ? balanceOf(usdcSymbol!.name) ?? 0n : 0n
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
  } catch (error) {
    console.error("❌ An error occurred during the FunkybitClient operation:", error);
  }
}