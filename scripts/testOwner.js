// scripts/testOwner.js
const { createPublicClient, http } = require('viem');
const { avalanche } = require('viem/chains');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

// Minimal ABI just for the owner function
const ownerAbi = [
    {
        "inputs": [],
        "name": "owner",
        "outputs": [{ "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    }
];

async function main() {
    try {
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
        if (!contractAddress) {
            throw new Error('ARBITRAGE_CONTRACT_ADDRESS not set in .env file');
        }

        logger.info('Testing owner() function call', { contractAddress });

        // Create public client
        const transport = http(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc');
        const publicClient = createPublicClient({
            chain: avalanche,
            transport
        });

        // Test connection
        const blockNumber = await publicClient.getBlockNumber();
        logger.info('Connected to Avalanche C-Chain', {
            blockNumber: blockNumber.toString()
        });

        // First check if there's bytecode at this address
        const bytecode = await publicClient.getBytecode({
            address: contractAddress
        });

        if (!bytecode || bytecode === '0x') {
            logger.error('No contract found at the specified address', { contractAddress });
            return;
        }

        logger.info('Contract exists at the address', {
            contractAddress,
            bytecodeLength: bytecode.length
        });

        // Try to call owner() with minimal ABI
        const owner = await publicClient.readContract({
            address: contractAddress,
            abi: ownerAbi,
            functionName: 'owner'
        });

        logger.info('Owner function called successfully', { owner });

        // If we reach here, owner() works fine
        logger.info('Test completed successfully');

    } catch (error) {
        logger.error('Test failed', {
            error: error.message,
            stack: error.stack
        });
    }
}

main().catch(console.error);