// Fake injected wallet used by scripts/qa-wallet-flow.mjs (injected before the app runs).
// Loaded as a file so the function is not serialised from another module's scope.
//
// MODES
//  linked  - account already linked, eth_accounts answers immediately
//  delayed - provider exists but the account only shows up a few seconds later
//  cancel  - nothing linked; the user cancels the connect screen (EIP-1193 4001)
//  reject  - nothing linked; eth_requestAccounts is rejected while approve() would succeed
window.__installWallet = function (mode, addr) {
  window.__calls = [];
  var provider = {
    isTrust: true,
    selectedAddress: addr,
    request: async function (payload) {
      var method = payload.method;
      window.__calls.push(method);
      if (method === 'eth_accounts') {
        if (mode === 'linked') return [addr];
        if (mode === 'delayed') {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve([addr]); }, 6000);
          });
        }
        return []; // nothing linked yet
      }
      if (method === 'eth_requestAccounts') {
        if (mode === 'cancel' || mode === 'reject') {
          var err = new Error('User rejected the request.');
          err.code = 4001;
          throw err;
        }
        return [addr];
      }
      if (method === 'eth_chainId') return '0x38';
      // approve() -> pretend a transaction was sent and mined
      if (method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32);
      if (method === 'eth_getTransactionReceipt') {
        return {
          transactionHash: '0x' + 'ab'.repeat(32),
          status: '0x1',
          blockHash: '0x' + 'cd'.repeat(32),
          blockNumber: '0x1',
          index: '0x0',
          from: addr,
          to: '0x55d398326f99059fF775485246999027B3197955',
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          logs: [],
          logsBloom: '0x' + '00'.repeat(256),
          type: '0x0',
          effectiveGasPrice: '0x1',
        };
      }
      if (method === 'eth_blockNumber') return '0x1';
      if (method === 'eth_getBlockByNumber') {
        return { number: '0x1', hash: '0x' + 'cd'.repeat(32), parentHash: '0x' + '00'.repeat(32), timestamp: '0x1', transactions: [] };
      }
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_gasPrice') return '0x1';
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getCode') return '0x';
      if (method === 'net_version') return '56';
      return null;
    },
    on: function () { },
    removeListener: function () { },
  };
  // A wallet browser may expose the object under any of these
  window.ethereum = provider;
  window.trustwallet = { ethereum: provider };
};
