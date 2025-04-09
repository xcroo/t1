const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const SEPOLIA_RPC = 'https://ethereum-sepolia.publicnode.com';
const T1_RPC = 'https://rpc.v006.t1protocol.com';
const SEPOLIA_CHAIN_ID = 11155111;
const T1_CHAIN_ID = 299792;

const minAmount = 0.0002;
const maxAmount = 0.01;
const MAX_BRIDGES_PER_DAY = 5;
const MIN_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DELAY_MS = 25 * 60 * 1000; // 25 minutes
const CYCLE_DELAY_MS = 20 * 60 * 60 * 1000; // 20 hours

const SEPOLIA_TO_T1_BRIDGE = '0xAFdF5cb097D6FB2EB8B1FFbAB180e667458e18F4';
const T1_TO_SEPOLIA_BRIDGE = '0x627B3692969b7330b8Faed2A8836A41EB4aC1918';

// Load accounts from file
function loadAccounts() {
  try {
    const data = fs.readFileSync('accounts.txt', 'utf8');
    const accounts = [];
    
    data.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      
      const [address, privateKey] = line.split(',');
      if (address && privateKey) {
        const wallet = new ethers.Wallet(privateKey.trim());
        if (wallet.address.toLowerCase() !== address.trim().toLowerCase()) {
          console.warn(`Warning: Address ${address} doesn't match private key`);
        }
        
        accounts.push({
          ADDRESS: wallet.address,
          PRIVATE_KEY: privateKey.trim(),
          bridgeCount: 0,
          lastReset: null
        });
      }
    });
    
    return accounts;
  } catch (error) {
    console.error(`Error reading accounts.txt: ${error.message}`);
    return [];
  }
}

const ACCOUNTS = loadAccounts();

// Stats tracking
let stats = {
  sepoliaToT1: { attempts: 0, successes: 0, failures: 0, totalBridged: 0 },
  t1ToSepolia: { attempts: 0, successes: 0, failures: 0, totalBridged: 0 },
  startTime: new Date()
};

const logStream = fs.createWriteStream('bridge_log.txt', { flags: 'a' });

// Enhanced logging function
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const coloredMessage = type === 'error' ? `\x1b[31m${message}\x1b[0m` : 
                         type === 'success' ? `\x1b[32m${message}\x1b[0m` :
                         type === 'warning' ? `\x1b[33m${message}\x1b[0m` :
                         type === 'highlight' ? `\x1b[36m${message}\x1b[0m` :
                         message;
  console.log(`[${timestamp}] ${coloredMessage}`);
  logStream.write(`[${timestamp}] ${message}\n`);
}

// Utility functions
async function getBalance(provider, address) {
  const balance = await provider.getBalance(address);
  return ethers.utils.formatEther(balance);
}

function getRandomAmount(min = minAmount, max = maxAmount) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(6));
}

function getRandomDelay(min = MIN_DELAY_MS, max = MAX_DELAY_MS) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function displayStats() {
  const duration = Math.floor((new Date() - stats.startTime) / 1000);
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  log(`🔄 BRIDGE BOT STATISTICS - Running for ${hours}h ${minutes}m ${seconds}s`, 'highlight');
  log(`Sepolia → T1: ${stats.sepoliaToT1.successes}/${stats.sepoliaToT1.attempts}`, 'info');
  log(`T1 → Sepolia: ${stats.t1ToSepolia.successes}/${stats.t1ToSepolia.attempts}`, 'info');
  log(`Total ETH bridged: ${stats.sepoliaToT1.totalBridged.toFixed(4)}`, 'info');
}

// Check and reset bridge count
function checkAndResetBridgeCount(account) {
  const now = new Date();
  if (!account.lastReset || (now - account.lastReset) >= 24 * 60 * 60 * 1000) {
    account.bridgeCount = 0;
    account.lastReset = now;
  }
  return account.bridgeCount < MAX_BRIDGES_PER_DAY;
}

// Bridge functions
async function bridgeSepoliaToT1(account, amountETH) {
  stats.sepoliaToT1.attempts++;
  try {
    const sepoliaProvider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
    const wallet = new ethers.Wallet(account.PRIVATE_KEY, sepoliaProvider);
    
    const amountWei = ethers.utils.parseEther(amountETH.toString());
    const txValueWei = amountWei.add(ethers.utils.parseEther("0.0001"));
    
    const bridgeInterface = new ethers.utils.Interface([
      "function sendMessage(address _to, uint256 _value, bytes _message, uint256 _gasLimit, uint64 _destChainId, address _callbackAddress)"
    ]);
    
    const txData = bridgeInterface.encodeFunctionData("sendMessage", [
      account.ADDRESS,
      amountWei,
      "0x",
      168000,
      T1_CHAIN_ID,
      account.ADDRESS
    ]);
    
    const tx = await wallet.sendTransaction({
      to: SEPOLIA_TO_T1_BRIDGE,
      value: txValueWei,
      data: txData,
      gasLimit: 300000,
      type: 2
    });
    
    const receipt = await tx.wait(1);
    if (receipt.status === 1) {
      stats.sepoliaToT1.successes++;
      stats.sepoliaToT1.totalBridged += parseFloat(amountETH);
      log(`✅ Sepolia→T1 Success: ${tx.hash}`, 'success');
      return true;
    }
    return false;
  } catch (error) {
    stats.sepoliaToT1.failures++;
    log(`❌ Sepolia→T1 Error: ${error.message}`, 'error');
    return false;
  }
}

async function bridgeT1ToSepolia(account, amountETH) {
  stats.t1ToSepolia.attempts++;
  try {
    const t1Provider = new ethers.providers.JsonRpcProvider(T1_RPC);
    const wallet = new ethers.Wallet(account.PRIVATE_KEY, t1Provider);
    
    const amountWei = ethers.utils.parseEther(amountETH.toString());
    
    const bridgeInterface = new ethers.utils.Interface([
      "function sendMessage(address _to, uint256 _value, bytes _message, uint256 _gasLimit, uint64 _destChainId, address _callbackAddress)"
    ]);
    
    const txData = bridgeInterface.encodeFunctionData("sendMessage", [
      account.ADDRESS,
      amountWei,
      "0x",
      0,
      SEPOLIA_CHAIN_ID,
      account.ADDRESS
    ]);
    
    const tx = await wallet.sendTransaction({
      to: T1_TO_SEPOLIA_BRIDGE,
      value: amountWei,
      data: txData,
      gasLimit: 300000
    });
    
    const receipt = await tx.wait(1);
    if (receipt.status === 1) {
      stats.t1ToSepolia.successes++;
      stats.t1ToSepolia.totalBridged += parseFloat(amountETH);
      log(`✅ T1→Sepolia Success: ${tx.hash}`, 'success');
      return true;
    }
    return false;
  } catch (error) {
    stats.t1ToSepolia.failures++;
    log(`❌ T1→Sepolia Error: ${error.message}`, 'error');
    return false;
  }
}

// Main multi-account bridge loop
async function multiAccountBridge() {
  if (ACCOUNTS.length === 0) {
    log('No accounts found in accounts.txt', 'error');
    return;
  }
  
  log(`🤖 Starting multi-account bridge bot with ${ACCOUNTS.length} accounts`, 'highlight');
  
  while (true) {
    for (let account of ACCOUNTS) {
      log(`🔄 Processing account: ${account.ADDRESS}`, 'highlight');

      if (!checkAndResetBridgeCount(account)) {
        log(`⏳ Account ${account.ADDRESS} reached daily limit of ${MAX_BRIDGES_PER_DAY} bridges`, 'warning');
        continue;
      }

      for (let i = 0; i < MAX_BRIDGES_PER_DAY && account.bridgeCount < MAX_BRIDGES_PER_DAY; i++) {
        const amount = getRandomAmount();
        
        // Sepolia to T1
        const sepoliaSuccess = await bridgeSepoliaToT1(account, amount);
        if (sepoliaSuccess) account.bridgeCount++;
        
        const delay1 = getRandomDelay();
        log(`⏱️ Waiting ${delay1/60000} minutes before next transaction...`);
        await sleep(delay1);

        // T1 to Sepolia
        const t1Success = await bridgeT1ToSepolia(account, amount);
        if (t1Success) account.bridgeCount++;

        if (i < MAX_BRIDGES_PER_DAY - 1 || account !== ACCOUNTS[ACCOUNTS.length - 1]) {
          const delay2 = getRandomDelay();
          log(`⏱️ Waiting ${delay2/60000} minutes before next bridge...`);
          await sleep(delay2);
        }
      }

      log(`✅ Completed bridges for account ${account.ADDRESS}. Total today: ${account.bridgeCount}`, 'success');
    }

    // Wait 20 hours before next cycle
    log(`⏱️ All accounts processed. Waiting ${CYCLE_DELAY_MS/(60*60*1000)} hours before next cycle...`, 'highlight');
    await sleep(CYCLE_DELAY_MS);
    displayStats();
  }
}

// Start the bridge
if (require.main === module) {
  multiAccountBridge().catch(error => {
    log(`🔴 Fatal error: ${error.message}`, 'error');
    process.exit(1);
  });
}

module.exports = {
  bridgeSepoliaToT1,
  bridgeT1ToSepolia,
  multiAccountBridge,
  getBalance,
  stats
};
