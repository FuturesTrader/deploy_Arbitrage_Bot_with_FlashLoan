// scripts/approveFlashLoan.js
const { createPublicClient, createWalletClient, http, parseUnits, formatUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { TOKEN_CONFIGS, ADDRESSES, ARBITRAGE_SETTINGS } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage, sleep } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

// Use retry and timeout settings from arbitrage settings
const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS || 5;
const RETRY_DELAY_MS = ARBITRAGE_SETTINGS.RETRY_DELAY || 2000;
const TRANSACTION_TIMEOUT_MS = ARBITRAGE_SETTINGS.TRANSACTION_TIMEOUT || 60000;
const FLASH_POOL = ADDRESSES.BALANCER_V2.POOL;

/**
 * Helper function to wait for transaction receipt with retries
 */
async function waitForTransactionReceipt(publicClient, hash) {
    let attempts = 0;

    while (attempts < MAX_RETRY_ATTEMPTS) {
        try {
            const receipt = await publicClient.waitForTransactionReceipt({
                hash,
                confirmations: 1,
                timeout: Number(TRANSACTION_TIMEOUT_MS)
            });
            return receipt;
        } catch (error) {
            attempts++;
            logger.warn(`Waiting for transaction receipt (attempt ${attempts}/${MAX_RETRY_ATTEMPTS})`, {
                hash,
                error: getErrorMessage(error)
            });

            if (attempts >= MAX_RETRY_ATTEMPTS) {
                throw new Error(`Failed to get transaction receipt after ${MAX_RETRY_ATTEMPTS} attempts`);
            }

            await sleep(RETRY_DELAY_MS);
        }
    }
}

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
        console.error('Error formatting allowance:', error);
        return allowance.toString();
    }
}

async function main() {
    try {
        if (!process.env.PRIVATE_KEY || !process.env.ARBITRAGE_CONTRACT_ADDRESS) {
            throw new Error('Missing required environment variables: PRIVATE_KEY, ARBITRAGE_CONTRACT_ADDRESS');
        }

        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;

        const account = privateKeyToAccount(privateKey);
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
        const walletAddress = account.address;

        logger.info('Starting Balancer flash loan vault approval process', {
            contract: contractAddress,
            wallet: walletAddress
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

        // 1. Verify flash loan configuration
        let balancerVaultAddress;

        try {
            const flashLoanConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'verifyFlashLoanConfiguration',
            });

            // Get the vault address from the contract
            const contractVaultAddress = flashLoanConfig[0];

            // Check if this matches our expected Balancer V2 address
            if (contractVaultAddress.toLowerCase() === FLASH_POOL.toLowerCase()) {
                balancerVaultAddress = contractVaultAddress;
                logger.info('Contract is correctly configured for Balancer V2', {
                    vaultAddress: balancerVaultAddress
                });
            } else {
                logger.warn('Contract has different Balancer vault address than expected V2 address', {
                    contractVault: contractVaultAddress,
                    expectedV2Vault: FLASH_POOL
                });
                // Use the V2 address from constants instead of what's in the contract
                balancerVaultAddress = FLASH_POOL;
            }

            const currentFeeBps = flashLoanConfig[1].toString();

            logger.info('Using Balancer V2 flash loan configuration', {
                vaultAddress: balancerVaultAddress,
                feeBps: currentFeeBps
            });

            // Verify it's actually 0 for Balancer
            if (currentFeeBps !== '0') {
                logger.warn('Unexpected fee percentage for Balancer', {
                    feeBps: currentFeeBps
                });
            }
        } catch (error) {
            // Fallback to hardcoded Balancer V2 Vault address
            balancerVaultAddress = FLASH_POOL;

            logger.warn('Using fallback Balancer V2 Vault address', {
                vaultAddress: balancerVaultAddress,
                error: getErrorMessage(error)
            });
        }

        // Validate Balancer Vault address
        if (!balancerVaultAddress || balancerVaultAddress === '0x0000000000000000000000000000000000000000') {
            throw new Error('Invalid Balancer Vault address');
        }

        // 2. Define tokens to approve - Added WBTC (BTC.b)
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
                name: "WBTC",
                address: TOKEN_CONFIGS.WBTC.address,
                decimals: TOKEN_CONFIGS.WBTC.decimals
            }
        ];

        // 3. Check and set approvals for both contract and wallet
        const addresses = [contractAddress, walletAddress];
        const addressLabels = ['Contract', 'Wallet'];

        for (const token of tokens) {
            for (let i = 0; i < addresses.length; i++) {
                const currentAddress = addresses[i];
                const addressLabel = addressLabels[i];

                logger.info(`Checking ${token.name} approval for Balancer Vault (${addressLabel})`);

                // Check current allowance for Balancer Vault
                const currentAllowance = await publicClient.readContract({
                    address: token.address,
                    abi: [{
                        inputs: [
                            { name: "owner", type: "address" },
                            { name: "spender", type: "address" }
                        ],
                        name: "allowance",
                        outputs: [{ name: "", type: "uint256" }],
                        stateMutability: "view",
                        type: "function"
                    }],
                    functionName: 'allowance',
                    args: [currentAddress, balancerVaultAddress]
                });

                const readableAllowance = formatAllowance(currentAllowance, token.decimals);
                logger.info(`Current ${token.name} allowance for Balancer Vault (${addressLabel})`, {
                    token: token.name,
                    address: currentAddress,
                    vaultAddress: balancerVaultAddress,
                    allowance: readableAllowance
                });

                // Define allowance amount - significantly high but not max
                const allowanceAmount = parseUnits('100000', token.decimals);

                // Determine if approval is needed
                if (currentAllowance < allowanceAmount) {
                    logger.info(`Setting ${token.name} approval for Balancer Vault (${addressLabel})`);

                    // Use contract's approveRouter function for contract, direct approve for wallet
                    let hash;
                    if (addressLabel === 'Contract') {
                        hash = await walletClient.writeContract({
                            address: contractAddress,
                            abi: ARBITRAGE_ABI,
                            functionName: 'approveRouter',
                            args: [
                                token.address,
                                balancerVaultAddress,
                                allowanceAmount
                            ],
                            gas: BigInt(500000)
                        });
                    } else {
                        hash = await walletClient.writeContract({
                            address: token.address,
                            abi: [{
                                inputs: [
                                    { name: "spender", type: "address" },
                                    { name: "amount", type: "uint256" }
                                ],
                                name: "approve",
                                outputs: [{ name: "", type: "bool" }],
                                stateMutability: "nonpayable",
                                type: "function"
                            }],
                            functionName: 'approve',
                            args: [
                                balancerVaultAddress,
                                allowanceAmount
                            ],
                            gas: BigInt(500000)
                        });
                    }

                    logger.info(`${token.name} approval transaction sent (${addressLabel})`, { hash });

                    // Wait for receipt
                    const receipt = await waitForTransactionReceipt(publicClient, hash);

                    if (receipt.status !== 'success') {
                        throw new Error(`Approval transaction failed: ${hash}`);
                    }

                    logger.info(`${token.name} approval transaction confirmed (${addressLabel})`, {
                        hash,
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed.toString()
                    });

                    // Verify new allowance
                    const newAllowance = await publicClient.readContract({
                        address: token.address,
                        abi: [{
                            inputs: [
                                { name: "owner", type: "address" },
                                { name: "spender", type: "address" }
                            ],
                            name: "allowance",
                            outputs: [{ name: "", type: "uint256" }],
                            stateMutability: "view",
                            type: "function"
                        }],
                        functionName: 'allowance',
                        args: [currentAddress, balancerVaultAddress]
                    });

                    const readableNewAllowance = formatAllowance(newAllowance, token.decimals);
                    logger.info(`New ${token.name} allowance for Balancer vault (${addressLabel})`, {
                        token: token.name,
                        address: currentAddress,
                        vaultAddress: balancerVaultAddress,
                        allowance: readableNewAllowance
                    });
                } else {
                    logger.info(`${token.name} already has sufficient approval for Balancer Vault (${addressLabel})`);
                }
            }
        }

        // 4. Additional step: verify DEX router approvals
        // This ensures the contract can still execute swaps through DEX routers
        const dexRouters = [
            { name: "Uniswap Router", address: ADDRESSES.UNISWAP_V3.ROUTER },
            { name: "TraderJoe Router", address: ADDRESSES.TRADER_JOE.ROUTER }
        ];

        logger.info('Verifying DEX router approvals for the contract...');

        for (const token of tokens) {
            for (const router of dexRouters) {
                // Only check for the contract, not wallet
                const currentAllowance = await publicClient.readContract({
                    address: token.address,
                    abi: [{
                        inputs: [
                            { name: "owner", type: "address" },
                            { name: "spender", type: "address" }
                        ],
                        name: "allowance",
                        outputs: [{ name: "", type: "uint256" }],
                        stateMutability: "view",
                        type: "function"
                    }],
                    functionName: 'allowance',
                    args: [contractAddress, router.address]
                });

                const readableAllowance = formatAllowance(currentAllowance, token.decimals);
                logger.info(`${token.name} allowance for ${router.name}`, {
                    token: token.name,
                    router: router.name,
                    routerAddress: router.address,
                    allowance: readableAllowance
                });

                // Define allowance amount - significantly high but not max
                const allowanceAmount = parseUnits('100000', token.decimals);

                // Determine if approval is needed
                if (currentAllowance < allowanceAmount) {
                    logger.info(`Setting ${token.name} approval for ${router.name}`);

                    const hash = await walletClient.writeContract({
                        address: contractAddress,
                        abi: ARBITRAGE_ABI,
                        functionName: 'approveRouter',
                        args: [
                            token.address,
                            router.address,
                            allowanceAmount
                        ],
                        gas: BigInt(500000)
                    });

                    logger.info(`${token.name} approval transaction for ${router.name} sent`, { hash });

                    // Wait for receipt
                    const receipt = await waitForTransactionReceipt(publicClient, hash);

                    if (receipt.status !== 'success') {
                        throw new Error(`Approval transaction failed: ${hash}`);
                    }

                    logger.info(`${token.name} approval for ${router.name} confirmed`, {
                        hash,
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed.toString()
                    });
                }
            }
        }

        // NEW SECTION: 5. Set wallet approvals for contract to handle test mode
        logger.info('Setting wallet approvals for contract (needed for test mode with negative profit)');

        for (const token of tokens) {
            // Check current wallet-to-contract allowance
            const walletToContractAllowance = await publicClient.readContract({
                address: token.address,
                abi: [{
                    inputs: [
                        { name: "owner", type: "address" },
                        { name: "spender", type: "address" }
                    ],
                    name: "allowance",
                    outputs: [{ name: "", type: "uint256" }],
                    stateMutability: "view",
                    type: "function"
                }],
                functionName: 'allowance',
                args: [walletAddress, contractAddress]
            });

            const readableWalletAllowance = formatAllowance(walletToContractAllowance, token.decimals);
            logger.info(`Current ${token.name} wallet allowance for contract`, {
                token: token.name,
                wallet: walletAddress,
                contract: contractAddress,
                allowance: readableWalletAllowance
            });

            // Define allowance amount - significantly high but not max
            const allowanceAmount = parseUnits('10000', token.decimals);

            // Determine if approval is needed
            if (walletToContractAllowance < allowanceAmount) {
                logger.info(`Setting ${token.name} wallet approval for contract (needed for test mode)`);

                const hash = await walletClient.writeContract({
                    address: token.address,
                    abi: [{
                        inputs: [
                            { name: "spender", type: "address" },
                            { name: "amount", type: "uint256" }
                        ],
                        name: "approve",
                        outputs: [{ name: "", type: "bool" }],
                        stateMutability: "nonpayable",
                        type: "function"
                    }],
                    functionName: 'approve',
                    args: [
                        contractAddress,  // Wallet approves contract to spend its tokens
                        allowanceAmount
                    ],
                    gas: BigInt(500000)
                });

                logger.info(`${token.name} wallet approval for contract transaction sent`, { hash });

                // Wait for receipt
                const receipt = await waitForTransactionReceipt(publicClient, hash);

                if (receipt.status !== 'success') {
                    throw new Error(`Approval transaction failed: ${hash}`);
                }

                logger.info(`${token.name} wallet approval for contract confirmed`, {
                    hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString()
                });

                // Verify new allowance
                const newWalletAllowance = await publicClient.readContract({
                    address: token.address,
                    abi: [{
                        inputs: [
                            { name: "owner", type: "address" },
                            { name: "spender", type: "address" }
                        ],
                        name: "allowance",
                        outputs: [{ name: "", type: "uint256" }],
                        stateMutability: "view",
                        type: "function"
                    }],
                    functionName: 'allowance',
                    args: [walletAddress, contractAddress]
                });

                const readableNewWalletAllowance = formatAllowance(newWalletAllowance, token.decimals);
                logger.info(`New ${token.name} wallet allowance for contract`, {
                    token: token.name,
                    wallet: walletAddress,
                    contract: contractAddress,
                    allowance: readableNewWalletAllowance
                });
            } else {
                logger.info(`${token.name} wallet already has sufficient approval for contract`);
            }
        }

        logger.info('Balancer flash loan vault approval process completed successfully');

    } catch (error) {
        logger.error('Balancer flash loan vault approval process failed', {
            error: getErrorMessage(error),
            stack: error.stack
        });
        process.exit(1);
    }
}

// Run as standalone script if directly called
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = { approveFlashLoan: main };