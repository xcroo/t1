const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const SEPOLIA_RPC = 'https://ethereum-sepolia.publicnode.com';
const T1_RPC = 'https://rpc.v006.t1protocol.com';
const SEPOLIA_CHAIN_ID = 11155111;
const T1_CHAIN_ID = 299792;


const minAmount = 0.0002
const maxAmount = 0.01

const RECEIVER_ADDRESS = 'YOUR RECEIVER';

const CONFIG = {
  PRIVATE_KEY: "YOUR PK",
  DELAY_SECONDS: 5   // Delay between bridge operations
};

const SEPOLIA_TO_T1_BRIDGE = '0xAFdF5cb097D6FB2EB8B1FFbAB180e667458e18F4';
const T1_TO_SEPOLIA_BRIDGE = '0x627B3692969b7330b8Faed2A8836A41EB4aC1918';

// Stats tracking
let stats = {
  sepoliaToT1: { attempts: 0, successes: 0, failures: 0, totalBridged: 0 },
  t1ToSepolia: { attempts: 0, successes: 0, failures: 0, totalBridged: 0 },
  startTime: new Date()
};

// Create log file stream
const logStream = fs.createWriteStream('bridge_log.txt', { flags: 'a' });

// Enhanced logging function
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const coloredMessage = type === 'error' ? `\x1b[31m${message}\x1b[0m` : 
                         type === 'success' ? `\x1b[32m${message}\x1b[0m` :
                         type === 'warning' ? `\x1b[33m${message}\x1b[0m` :
                         type === 'highlight' ? `\x1b[36m${message}\x1b[0m` :
                         message;
  
  // Console output with color
  console.log(`[${timestamp}] ${coloredMessage}`);
  
  // File output without color codes
  logStream.write(`[${timestamp}] ${message}\n`);
}

// Function to get account balance
async function getBalance(provider, address) {
  const balance = await provider.getBalance(address);
  return ethers.utils.formatEther(balance);
}

// Display stats function
function displayStats() {
  const duration = Math.floor((new Date() - stats.startTime) / 1000);
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  const timeRunning = `${hours}h ${minutes}m ${seconds}s`;
  
  log('='.repeat(20), 'highlight');
  log(`🔄 BRIDGE BOT STATISTICS - Running for ${timeRunning}`, 'highlight');
  log('='.repeat(20), 'highlight');
  log(`Sepolia → T1: ${stats.sepoliaToT1.successes}/${stats.sepoliaToT1.attempts} successful (${stats.sepoliaToT1.failures} failed)`, stats.sepoliaToT1.failures > 0 ? 'warning' : 'info');
  log(`T1 → Sepolia: ${stats.t1ToSepolia.successes}/${stats.t1ToSepolia.attempts} successful (${stats.t1ToSepolia.failures} failed)`, stats.t1ToSepolia.failures > 0 ? 'warning' : 'info');
  log(`Total ETH bridged: ${stats.sepoliaToT1.totalBridged.toFixed(4)} (Sepolia→T1), ${stats.t1ToSepolia.totalBridged.toFixed(4)} (T1→Sepolia)`, 'info');
  log('='.repeat(20), 'highlight');
}

// Bridge from Sepolia to T1Protocol
async function bridgeSepoliaToT1(privateKey, amountETH) {
  stats.sepoliaToT1.attempts++;
  const attemptNum = stats.sepoliaToT1.attempts;
  
  try {
    log(`🚀 [Attempt #${attemptNum}] Bridging ${amountETH} ETH from Sepolia to T1Protocol...`, 'highlight');
    
    // Connect to Sepolia network
    const sepoliaProvider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
    const wallet = new ethers.Wallet(privateKey, sepoliaProvider);
    
    // Get and log current balance
    const startBalance = await getBalance(sepoliaProvider, wallet.address);
    log(`💰 Current Sepolia balance: ${startBalance} ETH`);
    
    // Convert amount to Wei
    const amountWei = ethers.utils.parseEther(amountETH.toString());
    
    // Keep the _value and tx.value exactly the same
    const txValueWei = amountWei.add(ethers.utils.parseEther("0.0001"));

    
    // Create the ABI interface for the bridge contract
    const bridgeInterface = new ethers.utils.Interface([
      "function sendMessage(address _to, uint256 _value, bytes _message, uint256 _gasLimit, uint64 _destChainId, address _callbackAddress)"
    ]);
    
  // Encode the function call
  const txData = bridgeInterface.encodeFunctionData("sendMessage", [
    RECEIVER_ADDRESS,
    amountWei,  // Amount to bridge
    "0x",       // Empty message
    168000,     // Gas limit as per example
    T1_CHAIN_ID,// T1 chain ID
    RECEIVER_ADDRESS // Callback address
  ]);
    
    log(`📤 Preparing transaction with: Amount=${ethers.utils.formatEther(amountWei)} ETH`);
    
    // Set gas prices
    const feeData = await sepoliaProvider.getFeeData();
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('3.5', 'gwei');
    const maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits('4', 'gwei');
    
    // Send transaction
    log(`🔧 Using gas: Max fee=${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei, Priority=${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
    
      // Send transaction
      const tx = await wallet.sendTransaction({
        to: SEPOLIA_TO_T1_BRIDGE,
        value: txValueWei,  // Send slightly more than the bridge amount
        data: txData,
        gasLimit: 300000,
        maxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        type: 2 // EIP-1559 transaction
      });
    
    log(`📤 Transaction sent: ${tx.hash}`);
    log(`🔍 Check status: https://sepolia.etherscan.io/tx/${tx.hash}`);
    log(`⏳ Waiting for confirmation...`);
    
    // Wait for confirmation with timeout
    try {
      const receipt = await Promise.race([
        tx.wait(1),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Transaction confirmation timeout")), 120000))
      ]);
      
      if (receipt.status === 1) {
        stats.sepoliaToT1.successes++;
        stats.sepoliaToT1.totalBridged += parseFloat(amountETH);
        
        const endBalance = await getBalance(sepoliaProvider, wallet.address);
        const gasCost = parseFloat(startBalance) - parseFloat(endBalance) - parseFloat(amountETH);
        
        log(`✅ Transaction confirmed in block ${receipt.blockNumber}!`, 'success');
        log(`💸 Gas cost: ${gasCost.toFixed(6)} ETH`);
        log(`📊 New Sepolia balance: ${endBalance} ETH`);
        displayStats();
      } else {
        stats.sepoliaToT1.failures++;
        log(`❌ Transaction failed. Status code: ${receipt.status}`, 'error');
        displayStats();
      }
    } catch (waitError) {
      stats.sepoliaToT1.failures++;
      log(`⚠️ Error waiting for transaction: ${waitError.message}`, 'error');
      log(`🔍 Please check the transaction status manually.`);
      displayStats();
    }
    
    return amountETH;
  } catch (error) {
    stats.sepoliaToT1.failures++;
    log(`❌ Error bridging from Sepolia to T1:`, 'error');
    log(error.message, 'error');
    
    if (error.transaction) {
      log('Failed transaction details:', 'error');
      log(`Hash: ${error.transactionHash}`, 'error');
      log(`To: ${error.transaction.to}`, 'error');
      log(`Value: ${ethers.utils.formatEther(error.transaction.value)} ETH`, 'error');
      log(`Gas Limit: ${error.transaction.gasLimit.toString()}`, 'error');
    }
    displayStats();
    throw error;
  }
}

// Bridge from T1Protocol back to Sepolia
async function bridgeT1ToSepolia(privateKey, amountETH) {
  stats.t1ToSepolia.attempts++;
  const attemptNum = stats.t1ToSepolia.attempts;
  
  try {
    log(`🚀 [Attempt #${attemptNum}] Bridging ${amountETH} ETH from T1Protocol to Sepolia...`, 'highlight');
    
    // Connect to T1 network
    const t1Provider = new ethers.providers.JsonRpcProvider(T1_RPC);
    const wallet = new ethers.Wallet(privateKey, t1Provider);
    
    // Get and log current balance
    const startBalance = await getBalance(t1Provider, wallet.address);
    log(`💰 Current T1 balance: ${startBalance} ETH`);
    
    // Convert amount to Wei
    const amountWei = ethers.utils.parseEther(amountETH.toString());
    
    // Create the ABI interface for the bridge contract
    const bridgeInterface = new ethers.utils.Interface([
      "function sendMessage(address _to, uint256 _value, bytes _message, uint256 _gasLimit, uint64 _destChainId, address _callbackAddress)"
    ]);
    
    // Encode the function call for T1 to Sepolia
    const txData = bridgeInterface.encodeFunctionData("sendMessage", [
      RECEIVER_ADDRESS,
      amountWei,        // Amount to bridge
      "0x",             // Empty message
      0,                // Gas limit (0 for T1 to Sepolia)
      SEPOLIA_CHAIN_ID, // Sepolia chain ID
      RECEIVER_ADDRESS  // Callback address
    ]);
    
    log(`📤 Preparing transaction with: Amount=${ethers.utils.formatEther(amountWei)} ETH`);
    
    // Get latest gas price
    const gasPrice = await t1Provider.getGasPrice();
    log(`🔧 Using gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
    
    // Send transaction
    const tx = await wallet.sendTransaction({
      to: T1_TO_SEPOLIA_BRIDGE,
      value: amountWei,  // Same as parameter value - no extra fee needed
      data: txData,
      gasLimit: 300000,
      gasPrice: gasPrice
    });
    
    log(`📤 Transaction sent: ${tx.hash}`);
    log(`⏳ Waiting for confirmation...`);
    
    // Wait for confirmation with timeout
    try {
      const receipt = await Promise.race([
        tx.wait(1),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Transaction confirmation timeout")), 120000))
      ]);
      
      if (receipt.status === 1) {
        stats.t1ToSepolia.successes++;
        stats.t1ToSepolia.totalBridged += parseFloat(amountETH);
        
        const endBalance = await getBalance(t1Provider, wallet.address);
        const gasCost = parseFloat(startBalance) - parseFloat(endBalance) - parseFloat(amountETH);
        
        log(`✅ Transaction confirmed in block ${receipt.blockNumber}!`, 'success');
        log(`💸 Gas cost: ${gasCost.toFixed(6)} ETH`);
        log(`📊 New T1 balance: ${endBalance} ETH`);
        displayStats();
      } else {
        stats.t1ToSepolia.failures++;
        log(`❌ Transaction failed. Status code: ${receipt.status}`, 'error');
        displayStats();
      }
    } catch (waitError) {
      stats.t1ToSepolia.failures++;
      log(`⚠️ Error waiting for transaction: ${waitError.message}`, 'error');
      log(`🔍 Please check the transaction status manually.`);
      displayStats();
    }
    
    return amountETH;
  } catch (error) {
    stats.t1ToSepolia.failures++;
    log(`❌ Error bridging from T1 to Sepolia:`, 'error');
    log(error.message, 'error');
    
    if (error.transaction) {
      log('Failed transaction details:', 'error');
      log(`Hash: ${error.transactionHash}`, 'error');
      log(`To: ${error.transaction.to}`, 'error');
      log(`Value: ${ethers.utils.formatEther(error.transaction.value)} ETH`, 'error');
      log(`Gas Limit: ${error.transaction.gasLimit.toString()}`, 'error');
    }
    displayStats();
    throw error;
  }
}

// Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Infinite bridge loop
async function infiniteBridge(privateKey, delaySeconds = 60) {
    function getRandomAmount(min = minAmount, max = maxAmount) {
      return parseFloat((Math.random() * (max - min) + min).toFixed(6));
    }
  
    // Check if args are provided
    if (!privateKey) {
      log('No private key provided. Please set your private key.', 'error');
      return;
    }
  
    // Create wallet instances
    const sepoliaProvider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
    const t1Provider = new ethers.providers.JsonRpcProvider(T1_RPC);
    const sepoliaWallet = new ethers.Wallet(privateKey, sepoliaProvider);
    const t1Wallet = new ethers.Wallet(privateKey, t1Provider);
  
    log(`🤖 Starting infinite bridge bot for address: ${sepoliaWallet.address}`, 'highlight');
    log(`  - Delay between cycles: ${delaySeconds} seconds`, 'info');
    displayStats();
  
    // Start infinite loop
    while (true) {
      try {
        // Get fresh random amounts for this cycle
        const sepoliaAmount = getRandomAmount();
        const t1Amount = getRandomAmount();
  
        log(`🔄 Bridge parameters:`, 'highlight');
        log(`  - Sepolia → T1: ${sepoliaAmount} ETH`, 'info');
        log(`  - T1 → Sepolia: ${t1Amount} ETH`, 'info');
        log(`  - Minimum required balances: ${sepoliaAmount * 1.1} ETH (Sepolia), ${t1Amount * 1.1} ETH (T1)`, 'info');
  
        // Check balances
        const sepoliaBalance = await getBalance(sepoliaProvider, sepoliaWallet.address);
        const t1Balance = await getBalance(t1Provider, t1Wallet.address);
  
        log(`📊 Current balances: ${sepoliaBalance} ETH (Sepolia), ${t1Balance} ETH (T1)`);
  
        // Sepolia → T1 bridge
        if (parseFloat(sepoliaBalance) >= sepoliaAmount * 1.1) {
          await bridgeSepoliaToT1(privateKey, sepoliaAmount);
        } else {
          log(`⚠️ Insufficient funds on Sepolia (${sepoliaBalance} ETH). Skipping Sepolia→T1 bridge.`, 'warning');
        }
  
        // Wait between bridges
        log(`⏱️ Waiting ${delaySeconds} seconds before next bridge...`);
        await sleep(delaySeconds * 1000);
  
        // T1 → Sepolia bridge
        if (parseFloat(t1Balance) >= t1Amount * 1.1) {
          await bridgeT1ToSepolia(privateKey, t1Amount);
        } else {
          log(`⚠️ Insufficient funds on T1 (${t1Balance} ETH). Skipping T1→Sepolia bridge.`, 'warning');
        }
  
        // Wait before next cycle
        log(`⏱️ Waiting ${delaySeconds} seconds before next cycle...`);
        await sleep(delaySeconds * 1000);
  
      } catch (error) {
        log(`🔴 Error in bridge cycle: ${error.message}`, 'error');
        log(`⏱️ Waiting ${delaySeconds * 2} seconds before retrying...`, 'warning');
        await sleep(delaySeconds * 2000);
      }
    }
  }
  



// Start the infinite bridge if this file is run directly
if (require.main === module) {
  infiniteBridge(
    CONFIG.PRIVATE_KEY,
    CONFIG.DELAY_SECONDS
  );
}

// Export functions for potential use in other scripts
module.exports = {
  bridgeSepoliaToT1,
  bridgeT1ToSepolia,
  infiniteBridge,
  getBalance,
  stats
};
