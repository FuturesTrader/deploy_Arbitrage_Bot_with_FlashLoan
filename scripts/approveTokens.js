// scripts/approveTokens.js

const { createPublicClient, createWalletClient, http, parseUnits, formatUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { TOKEN_CONFIGS, ADDRESSES } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage, sleep } = require('../src/utils.js');  // make sure sleep is exported
const logger = require('../src/logger.js');
const dotenv = require('dotenv');
const { ARBITRAGE_SETTINGS } = require('../src/constants');

dotenv.config();

// Increase your timeouts and retries if you suspect the chain is slow
const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS || 10;
const RETRY_DELAY_MS = ARBITRAGE_SETTINGS.RETRY_DELAY || 2000;
const TRANSACTION_TIMEOUT_MS = ARBITRAGE_SETTINGS.TRANSACTION_TIMEOUT || 60000n;
const ESTIMATED_GAS_LIMIT = ARBITRAGE_SETTINGS.ESTIMATED_GAS_LIMIT || 3000000n;

/**
 * Format allowance amounts for better readability
 */
function formatAllowance(allowance, decimals) {
    const allowanceBigInt = BigInt(allowance);

    // Check for effectively unlimited allowance
    if (allowanceBigInt > (BigInt(2)**BigInt(255) - BigInt(1))) {
        return 'Unlimited';
    }

    try {
        // Use formatUnits to properly format the allowance
        return formatUnits(allowanceBigInt, decimals);
    } catch (error) {
        logger.error('Error formatting allowance:', error);
        return allowance.toString();
    }
}

// --- 1) Create a helper that polls for receipts with extra tolerance ---
async function waitWithRetryForReceipt(publicClient, txHash) {
    let attempt = 0;
    while (attempt < MAX_RETRY_ATTEMPTS) {
        try {
            // Use a shorter internal timeout so each attempt finishes more quickly
            // confirmations=1 ensures we wait for at least one block.
            const receipt = await publicClient.waitForTransactionReceipt({
                hash: txHash,
                confirmations: 1,
                timeout: Number(TRANSACTION_TIMEOUT_MS), // must be a Number, not bigint
                // If your chain is very slow or you want to skip the block confirmation,
                // you can set confirmations: 0 and rely purely on the transaction being mined
            });

            return receipt; // If successful, break out.
        } catch (error) {
            // viem's TransactionReceiptNotFoundError
            if (error.name === 'TransactionReceiptNotFoundError') {
                logger.warn(`Transaction receipt not found yet (attempt ${attempt + 1}). Retrying in ${RETRY_DELAY_MS} ms...`);
                await sleep(RETRY_DELAY_MS);
            } else {
                // Some other error, throw up immediately
                throw error;
            }
        }
        attempt++;
    }
    throw new Error(`Timed out waiting for receipt after ${MAX_RETRY_ATTEMPTS} attempts`);
}

// --- 2) The main approval script with the new helper in use ---
async function main() {
    try {
        if (!process.env.PRIVATE_KEY || !process.env.ARBITRAGE_CONTRACT_ADDRESS) {
            throw new Error('Missing required environment variables');
        }

        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;

        const account = privateKeyToAccount(privateKey);
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
        const walletAddress = account.address;

        logger.info('Starting token approvals for contract and wallet', {
            contractAddress,
            walletAddress
        });

        const transport = http(process.env.AVALANCHE_RPC_URL);
        const publicClient = createPublicClient({
            chain: avalanche,
            transport
        });

        const walletClient = createWalletClient({
            account,
            chain: avalanche,
            transport
        });

        // ERC20 ABI for allowance and approve
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
                inputs: [
                    { name: "spender", type: "address" },
                    { name: "amount", type: "uint256" }
                ],
                name: "approve",
                outputs: [{ name: "", type: "bool" }],
                stateMutability: "nonpayable",
                type: "function"
            }
        ];

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
                name: "BTC.b", // WBTC token (BTC.b on Avalanche)
                address: TOKEN_CONFIGS.WBTC.address,
                decimals: TOKEN_CONFIGS.WBTC.decimals
            }
        ];

        const routers = [
            {
                name: "Uniswap V3 Router",
                address: ADDRESSES.UNISWAP_V3.ROUTER
            },
            {
                name: "Trader Joe Router",
                address: ADDRESSES.TRADER_JOE.ROUTER
            }
        ];

        // Safe maximum value (slightly less than max int256)
        const maxInt256 = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") - 1n;

        // 1. FIRST: Set contract-to-router approvals
        logger.info('===== Setting Contract-to-Router Approvals =====');

        for (const token of tokens) {
            for (const router of routers) {
                // Check current allowance
                const currentAllowance = await publicClient.readContract({
                    address: token.address,
                    abi: erc20Abi,
                    functionName: 'allowance',
                    args: [contractAddress, router.address]
                });

                const readableAllowance = formatAllowance(currentAllowance, token.decimals);
                logger.info(`Current allowance for ${token.name} from contract to ${router.name}`, {
                    token: token.name,
                    tokenAddress: token.address,
                    router: router.name,
                    routerAddress: router.address,
                    contractAddress: contractAddress,
                    currentAllowance: readableAllowance
                });

                // If the allowance is less than a big threshold
                const bigThreshold = parseUnits('1000000000', token.decimals); // 1 billion tokens
                if (currentAllowance < bigThreshold) {
                    logger.info(`Approving unlimited ${token.name} from contract to ${router.name}...`);

                    // Send the approval transaction from your CrossDexArbitrage contract
                    const txHash = await walletClient.writeContract({
                        address: contractAddress,
                        abi: ARBITRAGE_ABI,
                        functionName: 'approveRouter',
                        args: [token.address, router.address, maxInt256],
                        gas: ESTIMATED_GAS_LIMIT
                    });

                    logger.info(`Sent tx for ${token.name} approval on ${router.name}`, { txHash });

                    // Wait for receipt with extra tolerance
                    const receipt = await waitWithRetryForReceipt(publicClient, txHash);

                    logger.info(`Approval transaction successful for ${token.name} from contract to ${router.name}`, {
                        hash: txHash,
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed?.toString()
                    });

                    // Double-check the new allowance
                    const newAllowance = await publicClient.readContract({
                        address: token.address,
                        abi: erc20Abi,
                        functionName: 'allowance',
                        args: [contractAddress, router.address]
                    });

                    const readableNewAllowance = formatAllowance(newAllowance, token.decimals);
                    logger.info(`New allowance for ${token.name} -> ${router.name}`, {
                        allowance: readableNewAllowance
                    });
                } else {
                    logger.info(`Sufficient approval already exists for ${token.name} on ${router.name}`);
                }
            }
        }

        // 2. SECOND: Set wallet-to-router approvals
        logger.info('===== Setting Wallet-to-Router Approvals =====');

        for (const token of tokens) {
            for (const router of routers) {
                // Check current wallet allowance
                const walletAllowance = await publicClient.readContract({
                    address: token.address,
                    abi: erc20Abi,
                    functionName: 'allowance',
                    args: [walletAddress, router.address]
                });

                const readableWalletAllowance = formatAllowance(walletAllowance, token.decimals);
                logger.info(`Current allowance for ${token.name} from wallet to ${router.name}`, {
                    token: token.name,
                    walletAddress: walletAddress,
                    router: router.name,
                    routerAddress: router.address,
                    currentAllowance: readableWalletAllowance
                });

                // Define wallet approval threshold
                const walletThreshold = parseUnits('1000000', token.decimals); // 1 million tokens

                // Determine if wallet approval is needed
                if (walletAllowance < walletThreshold) {
                    logger.info(`Setting wallet approval for ${token.name} to ${router.name}...`);

                    // Send direct approval from wallet
                    const txHash = await walletClient.writeContract({
                        address: token.address,
                        abi: erc20Abi,
                        functionName: 'approve',
                        args: [router.address, maxInt256],
                        gas: BigInt(500000)
                    });

                    logger.info(`Sent wallet approval tx for ${token.name} to ${router.name}`, { txHash });

                    // Wait for receipt
                    const receipt = await waitWithRetryForReceipt(publicClient, txHash);

                    logger.info(`Wallet approval transaction successful for ${token.name} to ${router.name}`, {
                        hash: txHash,
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed?.toString()
                    });

                    // Verify the new wallet allowance
                    const newWalletAllowance = await publicClient.readContract({
                        address: token.address,
                        abi: erc20Abi,
                        functionName: 'allowance',
                        args: [walletAddress, router.address]
                    });

                    const readableNewWalletAllowance = formatAllowance(newWalletAllowance, token.decimals);
                    logger.info(`New wallet allowance for ${token.name} -> ${router.name}`, {
                        allowance: readableNewWalletAllowance
                    });
                } else {
                    logger.info(`Sufficient wallet approval already exists for ${token.name} on ${router.name}`);
                }
            }
        }

        logger.info('All contract and wallet token approvals set successfully');
    } catch (error) {
        logger.error('Failed to set token approvals', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);