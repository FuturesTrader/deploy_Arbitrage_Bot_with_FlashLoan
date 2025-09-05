// scripts/checkAllowances.js
const { createPublicClient, http, formatUnits } = require('viem');
const { avalanche } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { TOKEN_CONFIGS, ADDRESSES, GAS_OPTIMIZATION } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

const FLASH_POOL = ADDRESSES.BALANCER_V2.POOL;
dotenv.config();

async function main() {
    try {
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
        if (!contractAddress) {
            throw new Error('ARBITRAGE_CONTRACT_ADDRESS not set in .env file');
        }

        // Get wallet address from private key
        let walletAddress = "";
        try {
            if (process.env.PRIVATE_KEY) {
                const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
                    ? process.env.PRIVATE_KEY
                    : `0x${process.env.PRIVATE_KEY}`;
                const account = privateKeyToAccount(privateKey);
                walletAddress = account.address;
            }
        } catch (error) {
            logger.warn('Could not derive wallet address from private key', {
                error: error.message
            });
        }

        logger.info('Checking allowances for flash loans and router operations', {
            contractAddress: contractAddress,
            walletAddress: walletAddress || "Not provided"
        });

        const publicClient = createPublicClient({
            chain: avalanche,
            transport: http(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc')
        });

        // Basic ERC20 ABI for allowance checks
        const erc20Abi = [
            {
                inputs: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" }
                ],
                name: "allowance",
                outputs: [{ name: "", type: "uint256" }],
                stateMutability: "view",
                type: "function"
            },
            {
                inputs: [],
                name: "decimals",
                outputs: [{ name: "", type: "uint8" }],
                stateMutability: "view",
                type: "function"
            }
        ];

        // Token addresses and router addresses - UPDATED TO INCLUDE WBTC (BTC.b)
        const tokens = [
            {
                name: "USDC",
                address: TOKEN_CONFIGS.USDC.address,
                decimals: TOKEN_CONFIGS.USDC.decimals
            },
            {
                name: "WAVAX",
                address: TOKEN_CONFIGS.WAVAX.address,
                decimals: TOKEN_CONFIGS.WAVAX.decimals
            },
            {
                name: "BTC.b", // Added WBTC (BTC.b) token
                address: TOKEN_CONFIGS.WBTC.address,
                decimals: TOKEN_CONFIGS.WBTC.decimals
            }
        ];

        // Fetch the flash loan address from the contract
        let flashLoanAddress;
        try {
            const flashLoanConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'verifyFlashLoanConfiguration',
            });

            flashLoanAddress = flashLoanConfig[0];

            logger.info('Flash loan provider configuration', {
                provider: flashLoanAddress,
                feeBps: flashLoanConfig[1].toString()
            });
        } catch (error) {
            logger.error('Failed to get flash loan provider address from contract', {
                error: error.message
            });
            flashLoanAddress = FLASH_POOL;
            logger.warn('Using fallback flash loan address', { flashLoanAddress });
        }

        const spenders = [
            {
                name: "Uniswap V3 Router",
                address: ADDRESSES.UNISWAP_V3.ROUTER
            },
            {
                name: "Trader Joe Router",
                address: ADDRESSES.TRADER_JOE.ROUTER
            },
            {
                name: "Flash Loan Provider",
                address: flashLoanAddress
            }
        ];

        // Check Gas Settings from network
        const baseFee = await publicClient.getGasPrice();
        const currentBlock = await publicClient.getBlock();

        logger.info('Current gas settings', {
            baseFeeGwei: formatUnits(baseFee, 9),
            configuredMultiplier: GAS_OPTIMIZATION.BASE_FEE_MULTIPLIER,
            priorityFeeLow: formatUnits(BigInt(GAS_OPTIMIZATION.PRIORITY_FEE.LOW), 9),
            priorityFeeMedium: formatUnits(BigInt(GAS_OPTIMIZATION.PRIORITY_FEE.MEDIUM), 9),
            priorityFeeHigh: formatUnits(BigInt(GAS_OPTIMIZATION.PRIORITY_FEE.HIGH), 9),
            defaultGasLimit: GAS_OPTIMIZATION.ESTIMATED_GAS_LIMIT.toString(),
            blockNumber: currentBlock.number.toString(),
            blockGasLimit: currentBlock.gasLimit.toString()
        });

        // Check Token Allowances
        logger.info('Checking allowances for contract and wallet', {
            contractAddress: contractAddress,
            walletAddress: walletAddress || "Not available"
        });

        const allowances = [];

        for (const token of tokens) {
            for (const spender of spenders) {
                try {
                    // Check contract allowance
                    const contractAllowance = await publicClient.readContract({
                        address: token.address,
                        abi: erc20Abi,
                        functionName: 'allowance',
                        args: [contractAddress, spender.address]
                    });

                    const contractReadableAmount = formatUnits(contractAllowance, token.decimals);
                    const contractIsUnlimited = contractAllowance > 10n**50n;
                    const contractIsSufficient = contractAllowance > 0n;

                    // Check wallet allowance if available
                    let walletAllowance = 0n;
                    let walletReadableAmount = "N/A";
                    let walletIsUnlimited = false;
                    let walletIsSufficient = false;

                    if (walletAddress) {
                        try {
                            walletAllowance = await publicClient.readContract({
                                address: token.address,
                                abi: erc20Abi,
                                functionName: 'allowance',
                                args: [walletAddress, spender.address]
                            });

                            walletReadableAmount = formatUnits(walletAllowance, token.decimals);
                            walletIsUnlimited = walletAllowance > 10n**50n;
                            walletIsSufficient = walletAllowance > 0n;
                        } catch (walletError) {
                            logger.warn(`Failed to check wallet allowance for ${token.name} -> ${spender.name}`, {
                                error: walletError.message
                            });
                        }
                    }

                    // For flash loan provider, highlight if it has insufficient allowance
                    const isFlashLoanProvider = spender.name === "Flash Loan Provider";
                    const isFlashLoanReady = isFlashLoanProvider ? contractIsSufficient : true;

                    allowances.push({
                        token: token.name,
                        tokenAddress: token.address,
                        spender: spender.name,
                        spenderAddress: spender.address,
                        contractAddress: contractAddress,
                        contractAllowance: contractReadableAmount,
                        contractIsUnlimited: contractIsUnlimited,
                        contractIsSufficient: contractIsSufficient,
                        isFlashLoanProvider: isFlashLoanProvider,
                        isFlashLoanReady: isFlashLoanReady,
                        walletAddress: walletAddress || "Not available",
                        walletAllowance: walletReadableAmount,
                        walletIsUnlimited: walletIsUnlimited,
                        walletIsSufficient: walletIsSufficient,
                        decimals: token.decimals
                    });
                } catch (error) {
                    logger.error(`Failed to check allowance for ${token.name} -> ${spender.name}`, {
                        error: error.message
                    });
                }
            }

            // NEW SECTION: Check wallet-to-contract allowances
            if (walletAddress) {
                try {
                    const walletToContractAllowance = await publicClient.readContract({
                        address: token.address,
                        abi: erc20Abi,
                        functionName: 'allowance',
                        args: [walletAddress, contractAddress]
                    });

                    const walletToContractReadableAmount = formatUnits(walletToContractAllowance, token.decimals);
                    const walletToContractIsUnlimited = walletToContractAllowance > 10n**50n;
                    const walletToContractIsSufficient = walletToContractAllowance > 0n;

                    // Minimum recommended allowance for test mode
                    const recommendedAllowance = formatUnits(parseUnits('10', token.decimals), token.decimals);

                    allowances.push({
                        token: token.name,
                        tokenAddress: token.address,
                        spender: "Contract (for test mode)",
                        spenderAddress: contractAddress,
                        contractAddress: contractAddress,
                        contractAllowance: "N/A",  // Not applicable for this relationship
                        contractIsUnlimited: false,
                        contractIsSufficient: false,
                        isFlashLoanProvider: false,
                        isFlashLoanReady: false,
                        walletAddress: walletAddress,
                        walletAllowance: walletToContractReadableAmount,
                        walletIsUnlimited: walletToContractIsUnlimited,
                        walletIsSufficient: walletToContractIsSufficient,
                        isTestModeApproval: true,
                        recommendedAllowance: recommendedAllowance,
                        testModeReady: walletToContractAllowance >= parseUnits('10', token.decimals),
                        decimals: token.decimals
                    });
                } catch (error) {
                    logger.error(`Failed to check wallet-to-contract allowance for ${token.name}`, {
                        error: error.message
                    });
                }
            }
        }

        // Restructure data for better presentation - create two tables

        // First - Wallet allowances
        const walletAllowances = allowances.map(a => ({
            Token: a.token,
            Spender: a.spender,
            Address: a.spenderAddress.slice(0, 10) + '...',
            Allowance: a.walletAllowance,
            Unlimited: a.walletIsUnlimited ? 'Yes' : 'No',
            Sufficient: a.walletIsSufficient ? 'Yes' : 'No',
            TestMode: a.isTestModeApproval ? 'Yes' : 'No',
            Ready: a.isTestModeApproval ? (a.testModeReady ? 'Yes' : 'No') : 'N/A'
        }));

        // Second - Contract allowances
        const contractAllowances = allowances.map(a => {
            if (a.isTestModeApproval) return null; // Skip test mode entries for contract table
            return {
                Token: a.token,
                Spender: a.spender,
                Address: a.spenderAddress.slice(0, 10) + '...',
                Allowance: a.contractAllowance,
                Unlimited: a.contractIsUnlimited ? 'Yes' : 'No',
                Sufficient: a.contractIsSufficient ? 'Yes' : 'No',
                IsFlashLoanProvider: a.isFlashLoanProvider ? 'Yes' : 'No',
                FlashLoanReady: a.isFlashLoanReady ? 'Yes' : 'No'
            };
        }).filter(a => a !== null);

        // Log wallet allowances
        logger.info('Wallet Allowance Summary:');
        console.table(walletAllowances);

        // Log contract allowances
        logger.info('Contract Allowance Summary:');
        console.table(contractAllowances);

        // Check if flash loan approvals are sufficient
        const flashLoanApprovals = allowances.filter(a => a.isFlashLoanProvider);
        const missingFlashLoanApprovals = flashLoanApprovals.filter(a => !a.contractIsSufficient);

        if (missingFlashLoanApprovals.length > 0) {
            logger.error('⚠️ MISSING FLASH LOAN APPROVALS ⚠️', {
                missing: missingFlashLoanApprovals.map(a => `${a.token} -> ${a.spender}`),
                fixCommand: 'Run the approveFlashLoan.js script to fix this issue'
            });
        } else if (flashLoanApprovals.length > 0) {
            logger.info('✅ Flash loan approvals are sufficient', {
                approvals: flashLoanApprovals.map(a => ({
                    token: a.token,
                    allowance: a.contractAllowance
                }))
            });
        } else {
            logger.warn('⚠️ No flash loan approvals were checked', {
                reason: 'Could not get flash loan provider address'
            });
        }

        // NEW: Check if test mode approvals are sufficient
        const testModeApprovals = allowances.filter(a => a.isTestModeApproval);
        const missingTestModeApprovals = testModeApprovals.filter(a => !a.testModeReady);

        if (missingTestModeApprovals.length > 0) {
            logger.error('⚠️ MISSING TEST MODE APPROVALS ⚠️', {
                missing: missingTestModeApprovals.map(a => `${a.token} -> Contract`),
                explanation: 'These approvals are required for test mode with negative profits',
                fixCommand: 'Run the approveFlashLoan.js script to fix this issue'
            });
        } else if (testModeApprovals.length > 0) {
            logger.info('✅ Test mode approvals are sufficient', {
                approvals: testModeApprovals.map(a => ({
                    token: a.token,
                    allowance: a.walletAllowance,
                    recommended: a.recommendedAllowance
                }))
            });
        } else {
            logger.warn('⚠️ No test mode approvals were checked', {
                reason: 'Wallet address not available'
            });
        }

        // Check DEX Configurations
        try {
            const uniConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getDexConfig',
                args: ['uniswap']
            });

            const tjConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getDexConfig',
                args: ['traderjoe']
            });

            logger.info('DEX Configurations', {
                uniswap: {
                    router: uniConfig[0],
                    defaultFee: uniConfig[1].toString(),
                    maxGasUsage: uniConfig[2].toString(),
                    isEnabled: uniConfig[3]
                },
                traderjoe: {
                    router: tjConfig[0],
                    defaultFee: tjConfig[1].toString(),
                    maxGasUsage: tjConfig[2].toString(),
                    isEnabled: tjConfig[3]
                }
            });
        } catch (error) {
            logger.warn('Could not read DEX configurations', {
                error: error.message
            });
        }

        // Check Pool Configurations - UPDATED to include BTC.b pools
        try {
            const uniPoolConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getPoolConfig',
                args: [ADDRESSES.UNISWAP_V3.POOLS.USDC_WAVAX]
            });

            const tjPoolConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getPoolConfig',
                args: [ADDRESSES.TRADER_JOE.POOLS.USDC_WAVAX]
            });

            // New WBTC pool checks
            const uniBtcPoolConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getPoolConfig',
                args: [ADDRESSES.UNISWAP_V3.POOLS.USDC_WBTC]
            });

            const tjBtcPoolConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getPoolConfig',
                args: [ADDRESSES.TRADER_JOE.POOLS.USDC_WBTC]
            });

            logger.info('Pool Configurations', {
                'Uniswap USDC-WAVAX': {
                    isEnabled: uniPoolConfig[0],
                    fee: uniPoolConfig[1].toString(),
                    minLiquidity: uniPoolConfig[2].toString(),
                    dexRouter: uniPoolConfig[3]
                },
                'TraderJoe USDC-WAVAX': {
                    isEnabled: tjPoolConfig[0],
                    fee: tjPoolConfig[1].toString(),
                    minLiquidity: tjPoolConfig[2].toString(),
                    dexRouter: tjPoolConfig[3]
                },
                'Uniswap USDC-BTC.b': {
                    isEnabled: uniBtcPoolConfig[0],
                    fee: uniBtcPoolConfig[1].toString(),
                    minLiquidity: uniBtcPoolConfig[2].toString(),
                    dexRouter: uniBtcPoolConfig[3]
                },
                'TraderJoe USDC-BTC.b': {
                    isEnabled: tjBtcPoolConfig[0],
                    fee: tjBtcPoolConfig[1].toString(),
                    minLiquidity: tjBtcPoolConfig[2].toString(),
                    dexRouter: tjBtcPoolConfig[3]
                }
            });
        } catch (error) {
            logger.warn('Could not read pool configurations', {
                error: error.message
            });
        }

    } catch (error) {
        logger.error('Check failed', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

// Helper function for parsing units
function parseUnits(value, decimals) {
    // Simple implementation to avoid direct dependency
    let result = BigInt(value);
    for (let i = 0; i < decimals; i++) {
        result = result * 10n;
    }
    return result;
}

// Run as standalone script if directly called
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = { checkAllowances: main };