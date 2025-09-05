// getBlockNumber.js
const { createPublicClient, http } = require('viem');
const { avalanche } = require('viem/chains');
require('dotenv').config();

async function main() {
    if (!process.env.AVALANCHE_RPC_URL) {
        console.error('Error: AVALANCHE_RPC_URL environment variable is not set');
        process.exit(1);
    }

    try {
        const client = createPublicClient({
            chain: avalanche,
            transport: http(process.env.AVALANCHE_RPC_URL)
        });

        const blockNumber = await client.getBlockNumber();
        console.log('\nCurrent Avalanche C-Chain block number:', blockNumber.toString());
        console.log('\nUpdate your hardhat.config.js with:');
        console.log(`
hardhat: {
    chainId: 43114,
    forking: {
        url: AVALANCHE_RPC_URL,
        blockNumber: ${blockNumber.toString()},
    },
},`);

    } catch (error) {
        console.error('Error fetching block number:', error);
        process.exit(1);
    }
}

main().catch(console.error);