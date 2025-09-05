// scripts/extractBytecode.js - CommonJS version
const fs = require('fs');
const path = require('path');
const { artifacts } = require('hardhat');

async function main() {
    // Get the compiled contract artifact
    const CrossDexArbitrageArtifact = await artifacts.readArtifact('CrossDexArbitrage');

    // Get the bytecode
    const bytecode = CrossDexArbitrageArtifact.bytecode;

    // Format it for use in our JS file with proper exports
    const formattedBytecode = `// src/services/constants/bytecode.js

/**
 * Compiled bytecode for CrossDexArbitrage contract
 * Generated using extractByteCode.js
 */
const ARBITRAGE_BYTECODE = "${bytecode}";

// Export for CommonJS
module.exports = {
    ARBITRAGE_BYTECODE
};`;

    // Write to a file
    const outputPath = path.join(__dirname, '../src/services/constants/bytecode.js');
    fs.writeFileSync(outputPath, formattedBytecode);

    console.log(`Bytecode written to ${outputPath}`);
    console.log(`Bytecode length: ${bytecode.length} bytes`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});