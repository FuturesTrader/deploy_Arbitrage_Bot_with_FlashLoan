// hardhat.config.js
require('dotenv').config();
require("@nomiclabs/hardhat-ethers");
require("hardhat-gas-reporter"); // Better gas reporting
require("hardhat-contract-sizer");
require('hardhat-abi-exporter');

// Configure environment variables
const AVALANCHE_RPC_URL = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Gas settings
const GAS_PRICE = 25000000000; // 25 Gwei

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: '0.8.26',
        settings: {
            optimizer: {
                enabled: true,
                runs: 5,
                details: {
                    constantOptimizer: true, // Additional optimization for constants
                    yulDetails: {
                        stackAllocation: true
                    }
                }
            },
            viaIR: true,
            metadata: {
                bytecodeHash: "none"
            }
        }
    },
    networks: {
        hardhat: {
            chainId: 43114,
            forking: {
                url: AVALANCHE_RPC_URL,
                blockNumber: 59000000
            }
        },
        avalanche: {
            url: AVALANCHE_RPC_URL,
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 43114,
            gasPrice: GAS_PRICE,
            // Avalanche finality is much faster than Ethereum
            timeout: 60000 // 60 seconds
        },
        avaxTestnet: {
            url: 'https://api.avax-test.network/ext/bc/C/rpc',
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 43113,
            gasPrice: GAS_PRICE,
            timeout: 60000
        }
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS === 'true',
        currency: 'USD',
        gasPrice: 25,
        excludeContracts: ['mocks/']
    },
    paths: {
        sources: './contracts',
        tests: './test',
        cache: './cache',
        artifacts: './artifacts'
    },
    abiExporter: {
        path: './data/abi',            // where to put the exported ABIs
        runOnCompile: true,
        clear: true,
        spacing: 2,
        pretty: false,
    },
    mocha: {
        timeout: 60000
    }
};