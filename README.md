# funkybit API Client

A TypeScript Client for interacting with funkybit - a cross-chain DeFi platform built on Bitcoin and EVM.

## Features

- Cross-chain DeFi operations
- Bitcoin and EVM chain integration
- Type-safe API interactions
- Real-time balance and order updates
- Automated trading and settlement
- Deposit and withdrawal functionality

## Installation

```bash
npm install @funkybit/api-client
# or
yarn add @funkybit/api-client
```

## Quick Start

Before running the example, you'll need to set up two environment variables:

```bash
# A WIF format key for a bitcoin wallet with at least 5000 sats
export FUNKYBIT_EXAMPLE_BTC_KEY="your_btc_wif_key"

# A hex format key for an evm wallet with at least 3 USDC on Base (and a little ETH for gas)
export FUNKYBIT_EXAMPLE_EVM_KEY="your_evm_private_key"
```

Then you can run the example:

```bash
npm run example
```

The example will:
1. Initialize wallets for both Bitcoin and EVM chains
2. Log in to the Funkybit platform
3. Subscribe to real-time balance updates
4. Perform deposits if needed (BTC and USDC)
5. Search for trending coins
6. Execute trades (buy and sell) using both BTC and USDC
7. Wait for trade settlement
8. Withdraw remaining balances
9. Clean up and shut down


## Development

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

### Building

```bash
npm run build
# or
yarn build
```


### Linting

```bash
npm run lint
# or
yarn lint
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT 