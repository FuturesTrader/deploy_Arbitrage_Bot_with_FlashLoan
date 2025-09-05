// scripts/diagnosticTest.js
const { createPublicClient, createWalletClient, http, encodeFunctionData } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { TOKEN_CONFIGS, POOL_FEES, ADDRESSES } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

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

        logger.info('Starting comprehensive diagnostic test', {
            contractAddress,
            account: account.address
        });

        // Configure client with extended timeout
        const transport = http(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc', {
            timeout: 30000 // 30 seconds
        });

        const publicClient = createPublicClient({
            chain: avalanche,
            transport
        });

        const walletClient = createWalletClient({
            account,
            chain: avalanche,
            transport
        });

        // 1. Check contract bytecode
        logger.info('Checking contract bytecode...');
        const bytecode = await publicClient.getBytecode({
            address: contractAddress
        });

        if (!bytecode || bytecode === '0x') {
            throw new Error(`No contract found at address ${contractAddress}`);
        }

        logger.info('Contract bytecode found', {
            bytecodeLength: bytecode.length
        });

        // 2. Test each function selector presence in bytecode
        logger.info('Checking function selectors in bytecode...');

        // Function selectors to check
        const functionSelectors = {
            'owner()': '8da5cb5b',
            'configureToken(address,uint256,uint256,uint256,uint256)': 'f8c74d0d',
            'configurePool(address,uint256,uint256,string)': '6c80e00b',
            'configureDex(string,address,uint256,uint256,uint256[])': '73d8d58e',
            'paused()': '5c975abb'
        };

        for (const [funcName, selector] of Object.entries(functionSelectors)) {
            const selectorPresent = bytecode.includes(selector.toLowerCase());
            logger.info(`Function selector check: ${funcName}`, {
                selector: `0x${selector}`,
                present: selectorPresent
            });
        }

        // 3. Try to call a known working function (getTokenConfig)
        logger.info('Trying known working function: getTokenConfig...');
        try {
            const usdcConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getTokenConfig',
                args: [TOKEN_CONFIGS.USDC.address]
            });

            logger.info('getTokenConfig successful', {
                result: {
                    isEnabled: usdcConfig[0],
                    maxAmount: usdcConfig[1].toString(),
                    minAmount: usdcConfig[2].toString(),
                    decimals: usdcConfig[3].toString(),
                    maxSlippage: usdcConfig[4].toString()
                }
            });
        } catch (error) {
            logger.error('getTokenConfig failed', {
                error: error.message
            });
        }

        // 4. Try owner function with different approaches
        logger.info('Trying owner function with different approaches...');

        // 4.1 Try with standard ABI
        try {
            const owner = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'owner'
            });
            logger.info('owner() call succeeded', { owner });
        } catch (error) {
            logger.error('owner() call failed', {
                error: error.message
            });
        }

        // 4.2 Try with minimal ABI
        try {
            const minimalOwnerAbi = [
                {
                    "inputs": [],
                    "name": "owner",
                    "outputs": [{ "name": "", "type": "address" }],
                    "stateMutability": "view",
                    "type": "function"
                }
            ];

            const owner = await publicClient.readContract({
                address: contractAddress,
                abi: minimalOwnerAbi,
                functionName: 'owner'
            });
            logger.info('owner() call with minimal ABI succeeded', { owner });
        } catch (error) {
            logger.error('owner() call with minimal ABI failed', {
                error: error.message
            });
        }

        // 4.3 Try with raw call data
        try {
            const ownerResult = await publicClient.call({
                to: contractAddress,
                data: '0x8da5cb5b' // owner() selector
            });
            logger.info('owner() raw call succeeded', {
                result: ownerResult.data
            });
        } catch (error) {
            logger.error('owner() raw call failed', {
                error: error.message
            });
        }

        // 5. Test a simple write function that's known to work
        logger.info('Testing a working write function: configureToken...');
        try {
            // Use randomness to ensure this isn't cached result
            const randomMaxAmount = BigInt(Math.floor(Math.random() * 1000000) + 1000000);

            logger.info('Preparing configureToken transaction...', {
                token: TOKEN_CONFIGS.USDC.address,
                maxAmount: randomMaxAmount.toString()
            });

            const hash = await walletClient.writeContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'configureToken',
                args: [
                    TOKEN_CONFIGS.USDC.address,
                    randomMaxAmount,
                    BigInt(10000),
                    BigInt(6),
                    BigInt(50)
                ],
                gas: BigInt(500000)
            });

            logger.info('configureToken transaction sent', { hash });

            const receipt = await publicClient.waitForTransactionReceipt({
                hash,
                confirmations: 1,
                timeout: 60000
            });

            logger.info('configureToken transaction confirmed', {
                status: receipt.status,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString()
            });
        } catch (error) {
            logger.error('configureToken transaction failed', {
                error: error.message
            });
        }

        // 6. Now try the problematic configureDex function with similar approach
        logger.info('Testing the problematic configureDex function...');
        try {
            // Prepare parameters
            const dexName = 'uniswap';
            const router = ADDRESSES.UNISWAP_V3.ROUTER;
            const defaultFee = BigInt(POOL_FEES.MEDIUM);
            const maxGasUsage = BigInt(300000);
            const supportedFeeTiers = [
                POOL_FEES.LOWEST,
                POOL_FEES.LOW,
                POOL_FEES.MEDIUM,
                POOL_FEES.HIGH
            ].map(fee => BigInt(fee));

            logger.info('Preparing configureDex transaction...', {
                dexName,
                router,
                defaultFee: defaultFee.toString(),
                supportedFeeTiers: supportedFeeTiers.map(fee => fee.toString())
            });

            // First try to encode without sending to check for errors
            try {
                const encodedData = encodeFunctionData({
                    abi: ARBITRAGE_ABI,
                    functionName: 'configureDex',
                    args: [dexName, router, defaultFee, maxGasUsage, supportedFeeTiers]
                });

                logger.info('Function encoding successful', {
                    encodedData: encodedData.substring(0, 66) + '...' // Truncate for logging
                });
            } catch (encodeError) {
                logger.error('Function encoding failed', {
                    error: encodeError.message
                });
            }

            // Now try to actually send the transaction
            const hash = await walletClient.writeContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'configureDex',
                args: [dexName, router, defaultFee, maxGasUsage, supportedFeeTiers],
                gas: BigInt(500000)
            });

            logger.info('configureDex transaction sent', { hash });

            const receipt = await publicClient.waitForTransactionReceipt({
                hash,
                confirmations: 1,
                timeout: 60000
            });

            logger.info('configureDex transaction confirmed', {
                status: receipt.status,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString()
            });
        } catch (error) {
            logger.error('configureDex transaction failed', {
                error: error.message
            });
        }

        logger.info('Diagnostic test completed');

    } catch (error) {
        logger.error('Diagnostic test failed', {
            error: error.message,
            stack: error.stack
        });
    }
}

main().catch(console.error);