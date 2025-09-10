# CrossDex Arbitrage Bot with Balancer V2 Flash Loans

## Overview
This project implements a sophisticated arbitrage bot that exploits price differences between Uniswap V3 and TraderJoe DEXs on Avalanche C-Chain. It uses Balancer V2 flash loans for capital-efficient trading without requiring upfront liquidity.

## Features
- ✅ Flash loan integration with Balancer V2 (0% fee)
- ✅ Cross-DEX arbitrage between Uniswap V3 and TraderJoe
- ✅ Support for USDC/WAVAX and USDC/WBTC trading pairs
- ✅ Gas optimization and smart contract size reduction
- ✅ Comprehensive error handling and event logging
- ✅ Test mode for validation without profit requirements

## Prerequisites
- Node.js v16+ and Yarn
- Avalanche C-Chain RPC endpoint
- Private key with AVAX for gas fees
- Small amount of USDC/WAVAX for testing

## Installation

```bash
# Clone the repository
git clone [repository-url]
cd crossdex-arbitrage-bot

# Install dependencies
yarn install

# Configure environment variables
cp .env.example .env
# Edit .env with your settings:
# - PRIVATE_KEY=your_private_key_here
# - AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
# - ARBITRAGE_CONTRACT_ADDRESS=(will be set after deployment)
```

## Deployment Process

### Step 1: Compile Smart Contract
```bash
npx hardhat compile
```

### Step 2: Deploy Contract
```bash
npx hardhat run scripts/deployWithHardhat.js --network avalanche
# Save the contract address output to .env as ARBITRAGE_CONTRACT_ADDRESS
```

### Step 3: Configure DEXs
```bash
# Configure Uniswap V3
node scripts/configureUniswap.js

# Configure TraderJoe
node scripts/configureTraderJoe.js
```

### Step 4: Configure Tokens
```bash
# Configure USDC, WAVAX, and WBTC
node scripts/configureTokens.js
```

### Step 5: Configure Pools
```bash
# Configure all trading pools
node scripts/configurePools.js
```

### Step 6: Set Approvals
```bash
# Approve tokens for DEX routers
node scripts/approveTokens.js

# Approve flash loan vault and set test mode approvals
node scripts/approveFlashLoan.js
```

### Step 7: Verify Configuration
```bash
# Check all allowances and configurations
node scripts/checkAllowances.js

# Verify flash loan setup
node scripts/configureFlashLoan.js
```

### Step 8: Fund Contract (Optional for Testing)
```bash
# Add some USDC/WAVAX for test trades
node scripts/fundContract.js
```

### Step 9: Test the System
```bash
# Run test arbitrage with flash loans
node src/test/testFlashLoanArbitrage.js
```

### Step 10: Run Main Arbitrage Bot
```bash
# Start the arbitrage bot
yarn start
```

## Deployment Flow Chart

```
┌─────────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT FLOW CHART                        │
└─────────────────────────────────────────────────────────────────┘

[START]
   │
   ▼
┌──────────────────┐
│ 1. Environment   │
│    Setup         │
│ ─────────────    │
│ • Install deps   │
│ • Configure .env │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 2. Compile       │
│    Contract      │
│ ─────────────    │
│ npx hardhat      │
│ compile          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 3. Deploy        │
│    Contract      │
│ ─────────────    │
│ • Deploy to      │
│   Avalanche      │
│ • Save address   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────┐
│ 4. Configure DEXs                │
│ ─────────────────────────────    │
│                                  │
│  ┌──────────┐    ┌──────────┐    │
│  │ Uniswap  │    │TraderJoe │    │
│  │   V3     │    │          │    │
│  └──────────┘    └──────────┘    │
│       │                │         │
│       └────────┬────────┘        │
└────────────────┼─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│ 5. Configure Tokens              │
│ ─────────────────────────────    │
│                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐    │
│  │ USDC │  │WAVAX │  │WBTC  │    │
│  └──────┘  └──────┘  └──────┘    │
│      │         │         │       │
│      └─────────┼─────────┘       │
└────────────────┼─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│ 6. Configure Pools               │
│ ─────────────────────────────    │
│                                  │
│  ┌─────────────┐ ┌─────────────┐ │
│  │ USDC/WAVAX  │ │ USDC/WBTC   │ │
│  └─────────────┘ └─────────────┘ │
│  (Uni & TJ)      (Uni & TJ)      │
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│ 7. Set Approvals                 │
│ ─────────────────────────────    │
│                                  │
│  ┌─────────────────────────────┐ │
│  │ Contract → Routers          │ │
│  │ Contract → Balancer Vault   │ │
│  │ Wallet → Contract (test)    │ │
│  └─────────────────────────────┘ │
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────┐
│ 8. Verification  │
│ ─────────────    │
│ • Check configs  │
│ • Verify approvals│
│ • Test flash loan│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 9. Testing       │
│ ─────────────    │
│ • Test mode ON   │
│ • Run test trades│
│ • Check events   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 10. Production   │
│ ─────────────    │
│ • Test mode OFF  │
│ • Start bot      │
│ • Monitor logs   │
└────────┬─────────┘
         │
         ▼
      [END]

═══════════════════════════════════════════════════════════════

                 ARBITRAGE EXECUTION FLOW
                 
┌────────────────────────────────────────────────────────┐
│                  Price Monitor Service                 │
│  ┌─────────────┐                   ┌─────────────┐     │
│  │  Uniswap V3 │                   │  TraderJoe  │     │
│  │   Quoter    │                   │   Quoter    │     │
│  └──────┬──────┘                   └──────┬──────┘     │
│         │                                  │           │
│         └──────────┬───────────────────────┘           │
│                    ▼                                   │
│           [Compare Prices]                             │
│                    │                                   │
│                    ▼                                   │
│         [Opportunity Found?]                           │
└────────────────────┼───────────────────────────────────┘
                     │ YES
                     ▼
┌────────────────────────────────────────────────────────┐
│              Flash Loan Service                        │
│  ┌────────────────────────────────────────────────┐    │
│  │ 1. Request Flash Loan from Balancer V2         │    │
│  │ 2. Receive USDC/WAVAX/WBTC                     │    │
│  └──────────────────┬─────────────────────────────┘    │
└────────────────────┼───────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│           Smart Contract Execution                     │
│  ┌────────────────────────────────────────────────┐    │
│  │ 1. First Swap (Lower Price DEX)                │    │
│  │    └─> Buy token at lower price                │    │
│  │                                                │    │
│  │ 2. Second Swap (Higher Price DEX)              │    │
│  │    └─> Sell token at higher price              │    │
│  │                                                │    │
│  │ 3. Repay Flash Loan + 0% fee                   │    │
│  │                                                │    │
│  │ 4. Keep Profit                                 │    │
│  └────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

## Configuration Files

### Required Scripts
- `deployWithHardhat.js` - Deploy the smart contract
- `configureUniswap.js` - Configure Uniswap V3 router
- `configureTraderJoe.js` - Configure TraderJoe router
- `configureTokens.js` - Configure supported tokens
- `configurePools.js` - Configure trading pools
- `approveTokens.js` - Set token approvals for routers
- `approveFlashLoan.js` - Set approvals for Balancer vault
- `checkAllowances.js` - Verify all configurations

### Utility Scripts
- `getBalance.js` - Check contract balances
- `fundContract.js` - Fund contract for testing
- `emergencyWithdraw.js` - Emergency fund recovery

## Smart Contract Architecture

### CrossDexArbitrageWithFlashLoan.sol
- Implements Balancer V2 IFlashLoanRecipient interface
- Executes atomic arbitrage trades
- Handles test mode for validation
- Comprehensive event logging
- Gas optimized (<24KB deployed size)

### Key Functions
- `executeFlashLoanArbitrage()` - Main arbitrage execution
- `receiveFlashLoan()` - Balancer callback handler
- `configureDex()` - Set DEX parameters
- `configureToken()` - Set token parameters
- `configurePool()` - Set pool parameters

## Testing

### Test Mode
Enable test mode to allow trades with negative profit for validation:
```javascript
// In constants.js
ARBITRAGE_SETTINGS.TEST_MODE = true
```

### Test Scripts
```bash
# Test single swap functionality
node src/test/testSingleSwap.js

# Test full arbitrage with flash loans
node src/test/testFlashLoanArbitrage.js

# Run data collection for analysis
node src/analysis/runDataCollection.js

# Analyze quote accuracy
node src/analysis/analyzeQuoteAccuracy.js
```

## Monitoring

### Log Files
- Application logs: `logs/application-YYYY-MM-DD.log`
- Trade logs: `logs/tradelogs/trade-YYYY-MM-DD.log`

### Key Metrics
- Total executions
- Successful trades
- Failed trades
- Cumulative profit
- Flash loan statistics

## Troubleshooting

### Common Issues

1. **Transaction Receipt Not Found**
   - Increase `MAX_RETRY_ATTEMPTS` in constants.js
   - Check RPC endpoint reliability

2. **Insufficient Allowance**
   - Run `checkAllowances.js` to verify
   - Re-run approval scripts if needed

3. **Flash Loan Failures**
   - Ensure Balancer vault approval is set
   - Check wallet has tokens for test mode coverage

4. **Gas Estimation Errors**
   - Adjust `ESTIMATED_GAS_LIMIT` in constants.js
   - Increase `GAS_OPTIMIZATION.BUFFER_MULTIPLIER`

## Safety Features

- Circuit breaker for emergency pause
- Maximum slippage protection
- Gas price limits
- Trade size limits
- Test mode for validation

## Emergency Procedures

### Pause Contract
```javascript
// In case of emergency
node scripts/pauseContract.js
```

### Withdraw Funds
```javascript
// Recover all funds
node scripts/emergencyWithdraw.js
```

## Support

For issues or questions:
1. Check logs in `logs/` directory
2. Run `checkAllowances.js` for configuration issues
3. Review transaction details with `getDetailTransactions.js`

## License
MIT

---

**Note**: Always test thoroughly on testnet before mainnet deployment. Start with small amounts and TEST_MODE enabled.
