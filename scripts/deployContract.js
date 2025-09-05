// scripts/deployContract.js
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { ARBITRAGE_ABI, ARBITRAGE_BYTECODE } = require('../src/services/constants/arbitrageAbi.js');
const { ARBITRAGE_SETTINGS } = require('../src/constants.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');
dotenv.config();

async function deployContract() {
    try {
        if (!process.env.PRIVATE_KEY || !process.env.AVALANCHE_RPC_URL) {
            throw new Error('Missing required environment variables: PRIVATE_KEY or AVALANCHE_RPC_URL');
        }

        const deploymentStartTime = performance.now();
        logger.info('Starting CrossDexArbitrage contract deployment');

        // Setup account and clients
        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;
        const account = privateKeyToAccount(privateKey);

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

        // Calculate minimum profit in basis points
        // Convert percentage to basis points (multiply by 100 to go from decimal to percent, then by 100 again for basis points)
        const minProfitBps = Math.max(1, Math.floor(Math.abs(ARBITRAGE_SETTINGS.MIN_PROFIT_THRESHOLD * 10000)));

        logger.info(`Using minimum profit threshold of ${minProfitBps} basis points (${minProfitBps/100}%)`);

        // Deploy contract
        logger.info(`Deploying contract with ${minProfitBps} basis points minimum profit`);

        const hash = await walletClient.deployContract({
            abi: ARBITRAGE_ABI,
            bytecode: ARBITRAGE_BYTECODE,
            args: [BigInt(minProfitBps)]
        });

        const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            confirmations: 2
        });

        if (!receipt.contractAddress) {
            throw new Error('Contract deployment failed - no contract address');
        }

        const deploymentTime = ((performance.now() - deploymentStartTime)/1000).toFixed(2);

        logger.info('Deployment completed successfully', {
            contractAddress: receipt.contractAddress,
            deploymentHash: hash,
            minProfitThreshold: `${minProfitBps/100}%`,
            network: 'Avalanche',
            deploymentTime: `${deploymentTime}s`,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

        // Deployment instructions
        logger.info('Add the following line to your .env file:');
        logger.info(`ARBITRAGE_CONTRACT_ADDRESS=${receipt.contractAddress}`);

        return receipt.contractAddress;

    } catch (error) {
        logger.error('Deployment failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
}

// Run deployment
async function main() {
    try {
        await deployContract();
    } catch (error) {
        process.exit(1);
    }
}

// Run script
main().catch(console.error);